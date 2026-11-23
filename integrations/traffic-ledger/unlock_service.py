"""Node-bound pull queue. Tasks contain IDs only, never shell commands or URLs."""
import hashlib
import json
import re
import secrets
import sqlite3
import time
import uuid as uuidlib
from contextlib import contextmanager
from pathlib import Path
from ledger import iso_time

REGIONS = {'globe': ('0', '跨国平台'), 'ai': ('11', 'AI 平台')}


def parse_output(output):
    text = re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]', '', output).replace('\r', '')
    region = None
    family = 'auto'
    services = {}
    for line in text.splitlines():
        line = line.strip()
        heading = re.match(r'^\[\s*(Globe|AI)\s*(?:\((IPv4|IPv6|Auto)\))?\s*\]\s*=*$', line, re.I)
        if heading:
            region = REGIONS[heading[1].lower()][0]
            family = {'ipv4': 'ipv4', 'ipv6': 'ipv6'}.get((heading[2] or '').lower(), 'auto')
            continue
        if not region:
            continue
        match = re.match(r'^(.+?)\s{2,}(YES\b.*|NO\b.*|Restricted\b.*|Banned\b.*|ERR\b.*|Failed\b.*|Unexpected\b.*|[A-Za-z0-9_-]{2,12})$', line, re.I)
        if not match:
            continue
        name, raw = match[1].strip(), match[2].strip()
        if len(name) > 120:
            continue
        status = 'UNKNOWN'
        for prefix, value in [('yes', 'YES'), ('no', 'NO'), ('restricted', 'RESTRICTED'), ('banned', 'BANNED'), ('err', 'ERR'), ('failed', 'ERR'), ('unexpected', 'ERR')]:
            if re.match(r'^' + prefix + r'\b', raw, re.I):
                status = value
                break
        location = re.search(r'\(Region:\s*([A-Za-z0-9_-]+)\)', raw, re.I)
        code = location[1].upper() if location else ''
        if status == 'UNKNOWN' and (name.upper().endswith('CDN') or re.fullmatch(r'[A-Z]{2,5}', raw)):
            status, code = 'YES', raw.upper()
        key = (region, name)
        service = services.setdefault(key, {'id': re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-'),
            'name': name, 'displayName': name, 'regionId': region, 'ipv4': None, 'ipv6': None, 'auto': None,
            'unlocked': False, 'region': ''})
        service[family] = {'status': status, 'unlocked': status == 'YES', 'region': code,
                           'info': raw[:500], 'raw': raw[:500]}
        if status == 'YES':
            service['unlocked'] = True
            service['region'] = service['region'] or code
    return list(services.values())[:200]


class UnlockError(Exception):
    def __init__(self, status, message, code=None):
        self.status, self.message, self.code = status, message, code


class UnlockService:
    def __init__(self, source, state):
        self.source, self.state = Path(source).resolve(), Path(state).resolve()
        with self.db() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS workers(uuid TEXT PRIMARY KEY, worker_id TEXT NOT NULL, last_seen REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS results(uuid TEXT PRIMARY KEY, services TEXT NOT NULL, updated REAL,
                    first_success REAL, error TEXT, last_attempt REAL);
                CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, uuid TEXT NOT NULL, status TEXT NOT NULL,
                    created REAL NOT NULL, deadline REAL NOT NULL, lease TEXT, worker_id TEXT, result_hash TEXT);
                CREATE UNIQUE INDEX IF NOT EXISTS one_active_job ON jobs(uuid) WHERE status IN ('queued','running');
            ''')

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.state, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def identify(self, authorization):
        token = authorization[7:] if authorization.startswith('Bearer ') else ''
        if not 12 <= len(token) <= 512:
            raise UnlockError(401, '节点身份无效')
        db = sqlite3.connect(self.source.as_uri() + '?mode=ro', uri=True, timeout=10)
        try:
            row = db.execute('SELECT uuid,name FROM clients WHERE token=?', (token,)).fetchone()
        finally:
            db.close()
        if not row:
            raise UnlockError(401, '节点身份无效')
        return {'uuid': row[0], 'name': row[1]}

    @staticmethod
    def _expire(db, now):
        for job in db.execute("SELECT * FROM jobs WHERE status IN ('queued','running') AND deadline<?", (now,)).fetchall():
            db.execute("UPDATE jobs SET status='expired' WHERE id=?", (job['id'],))
            db.execute('''INSERT INTO results VALUES(?, '[]', NULL, NULL, ?, ?)
                ON CONFLICT(uuid) DO UPDATE SET error=excluded.error,last_attempt=excluded.last_attempt''',
                (job['uuid'], '检测未完成，请确认组件在线后手动重试', now))
        db.execute("DELETE FROM jobs WHERE status NOT IN ('queued','running') AND created<?", (now-7*86400,))

    @staticmethod
    def _enqueue(db, uuid, now):
        task = secrets.token_hex(16)
        db.execute("INSERT INTO jobs(id,uuid,status,created,deadline) VALUES(?,?,'queued',?,?)", (task,uuid,now,now+600))
        return task

    def poll(self, identity, worker_id, now=None):
        now = time.time() if now is None else now
        try:
            worker_id = str(uuidlib.UUID(worker_id))
        except (ValueError, TypeError, AttributeError):
            raise UnlockError(400, '组件标识无效')
        uuid = identity['uuid']
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            self._expire(db, now)
            prior = db.execute('SELECT * FROM workers WHERE uuid=?', (uuid,)).fetchone()
            if prior and prior['worker_id'] != worker_id:
                raise UnlockError(409, '该节点已绑定另一份组件配置，请保留原 config.json 重新安装')
            db.execute('INSERT OR REPLACE INTO workers VALUES(?,?,?)', (uuid,worker_id,now))
            result = db.execute('SELECT * FROM results WHERE uuid=?', (uuid,)).fetchone()
            active = db.execute("SELECT * FROM jobs WHERE uuid=? AND status IN ('queued','running')", (uuid,)).fetchone()
            # Exactly one initial request, on installation; no scheduled scans.
            if not prior and not result and not active:
                self._enqueue(db, uuid, now)
                active = db.execute("SELECT * FROM jobs WHERE uuid=? AND status='queued'", (uuid,)).fetchone()
            if not active:
                return {'node': identity, 'job': None, 'poll_seconds': 15}
            if active['status'] == 'queued':
                db.execute("UPDATE jobs SET status='running',lease=?,worker_id=?,deadline=? WHERE id=?",
                    (secrets.token_hex(24),worker_id,now+420,active['id']))
                active = db.execute('SELECT * FROM jobs WHERE id=?', (active['id'],)).fetchone()
            return {'node': identity, 'job': {'id': active['id'], 'lease': active['lease'], 'kind': 'unlock-test-v1'}, 'poll_seconds': 15}

    def trigger(self, uuid, only_missing=False, now=None):
        now = time.time() if now is None else now
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            self._expire(db, now)
            worker = db.execute('SELECT * FROM workers WHERE uuid=?', (uuid,)).fetchone()
            if not worker:
                raise UnlockError(409, '请先在该机器安装流媒体检测组件')
            active = db.execute("SELECT id FROM jobs WHERE uuid=? AND status IN ('queued','running')", (uuid,)).fetchone()
            if active:
                return {'triggered': False, 'reason': 'already_running'}
            result = db.execute('SELECT * FROM results WHERE uuid=?', (uuid,)).fetchone()
            if only_missing and result and result['first_success']:
                return {'triggered': False, 'reason': 'saved_result'}
            if now-worker['last_seen'] > 90:
                raise UnlockError(409, '检测组件暂时离线，请检查机器上的 komari-unlock-worker 服务')
            recent = db.execute('SELECT MAX(created) FROM jobs WHERE uuid=?', (uuid,)).fetchone()[0]
            if recent is not None and now-recent < 60:
                raise UnlockError(429, '请间隔一分钟后再检测')
            return {'triggered': True, 'taskId': self._enqueue(db, uuid, now)}

    def report(self, identity, data, now=None):
        now = time.time() if now is None else now
        if not isinstance(data.get('output'), str) or len(data['output'].encode()) > 262144 or type(data.get('exit_code')) is not int:
            raise UnlockError(400, '检测结果格式无效')
        digest = hashlib.sha256(json.dumps([data['exit_code'],data['output']],ensure_ascii=False).encode()).hexdigest()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            job = db.execute('SELECT * FROM jobs WHERE id=?', (data.get('id'),)).fetchone()
            if not job:
                # 409 also releases old v1 workers' outboxes after retention cleanup.
                raise UnlockError(409, '旧任务已清理，组件可继续领取新任务', 'task_gone')
            if job['uuid'] != identity['uuid'] or not isinstance(data.get('lease'),str) or not secrets.compare_digest(job['lease'] or '', data['lease']):
                raise UnlockError(403, '任务与节点不匹配')
            if job['status'] == 'done' and job['result_hash'] == digest:
                return {'accepted': True}
            if job['status'] != 'running' or now > job['deadline']:
                raise UnlockError(409, '任务已经结束，请刷新页面', 'task_terminal')
            services = parse_output(data['output'])
            success = data['exit_code'] == 0 and bool(services)
            error = None if success else '检测超时或未返回完整结果，请手动重试'
            old = db.execute('SELECT * FROM results WHERE uuid=?', (identity['uuid'],)).fetchone()
            db.execute('INSERT OR REPLACE INTO results VALUES(?,?,?,?,?,?)', (identity['uuid'],
                json.dumps(services if success else json.loads(old['services']) if old else [],ensure_ascii=False),
                now if success else old['updated'] if old else None,
                old['first_success'] if old and old['first_success'] else now if success else None,error,now))
            db.execute("UPDATE jobs SET status='done',result_hash=? WHERE id=?", (digest,job['id']))
            db.execute('UPDATE workers SET last_seen=? WHERE uuid=?', (now,identity['uuid']))
        return {'accepted': True}

    def snapshot(self, nodes, now=None):
        now = time.time() if now is None else now
        names = {node['uuid']: node.get('name', node['uuid']) for node in nodes}
        ids = list(names)
        output, running = {}, []
        with self.db() as db:
            db.execute('BEGIN')
            # Stay below the parameter limit on older SQLite builds. All joins
            # use the visible UUID and the existing primary/active-job indexes.
            for offset in range(0, len(ids), 500):
                batch = ids[offset:offset + 500]
                placeholders = ','.join(['(?)'] * len(batch))
                rows = db.execute(f'''
                    WITH visible(uuid) AS (VALUES {placeholders})
                    SELECT v.uuid, r.services, r.updated, r.first_success, r.error,
                           w.last_seen, j.id AS active_job
                    FROM visible v LEFT JOIN results r ON r.uuid=v.uuid
                    LEFT JOIN workers w ON w.uuid=v.uuid
                    LEFT JOIN jobs j ON j.uuid=v.uuid AND j.status IN ('queued','running')
                                    AND j.deadline>=?
                ''', (*batch, now))
                for row in rows:
                    uuid = row['uuid']
                    active = row['active_job'] is not None
                    installed = row['last_seen'] is not None
                    if active:
                        running.append(uuid)
                    output[uuid] = {
                        'uuid': uuid, 'name': names[uuid],
                        'services': json.loads(row['services']) if row['services'] else [],
                        'updatedAt': iso_time(row['updated']) if row['updated'] else None,
                        'firstSuccessAt': iso_time(row['first_success']) if row['first_success'] else None,
                        'error': row['error'], 'workerInstalled': installed,
                        'workerOnline': installed and (active or now - row['last_seen'] < 90),
                    }
        return {'schemaVersion':1,'autoProbe':False,'manualExecutionRequired':False,'updatedAt':iso_time(now),
            'activeTask':{'clients':running,'phase':'running'} if running else None,
            'regionsCatalog':[{'id':v[0],'nameZh':v[1],'nameEn':k} for k,v in REGIONS.items()], 'nodes':output}

    def maintain(self, now=None):
        with self.db() as db:
            self._expire(db, time.time() if now is None else now)

    def rebind(self, identity, worker_id, now=None):
        """Explicit owner action; never evict an active installation or task."""
        now = time.time() if now is None else now
        try:worker_id = str(uuidlib.UUID(worker_id))
        except (ValueError,TypeError,AttributeError):raise UnlockError(400,'组件标识无效')
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE');self._expire(db,now)
            prior=db.execute('SELECT * FROM workers WHERE uuid=?',(identity['uuid'],)).fetchone()
            if prior and prior['worker_id']==worker_id:return {'rebound':True}
            busy=db.execute("SELECT id FROM jobs WHERE uuid=? AND status IN ('queued','running')",(identity['uuid'],)).fetchone()
            if busy or (prior and now-prior['last_seen']<120):
                raise UnlockError(409,'原组件或检测仍在运行，请停止原组件并等待两分钟后重试')
            db.execute('INSERT OR REPLACE INTO workers VALUES(?,?,?)',(identity['uuid'],worker_id,now))
        return {'rebound':True}
