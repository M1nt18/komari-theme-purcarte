"""Durable billing-cycle totals built from Komari's per-direction traffic deltas."""

import calendar
import datetime as dt
import math
import sqlite3
import time
from pathlib import Path
from contextlib import contextmanager

UTC = dt.timezone.utc
BILLING_TZ = dt.timezone(dt.timedelta(hours=8))
BUCKET_SECONDS = 15 * 60


def timestamp(value):
    parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.timestamp()


def sql_time(seconds):
    return dt.datetime.fromtimestamp(seconds, UTC).strftime("%Y-%m-%d %H:%M:%S.%f")


def iso_time(seconds):
    return dt.datetime.fromtimestamp(seconds, UTC).isoformat().replace("+00:00", "Z")


def cycle_bounds(now, reset_day):
    day = max(1, min(31, int(reset_day or 1)))
    local = dt.datetime.fromtimestamp(now, BILLING_TZ)
    year, month = local.year, local.month

    def boundary(y, m):
        return dt.datetime(y, m, min(day, calendar.monthrange(y, m)[1]), tzinfo=BILLING_TZ)

    start = boundary(year, month)
    if local < start:
        year, month = (year - 1, 12) if month == 1 else (year, month - 1)
        start = boundary(year, month)
    next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
    return int(start.timestamp()), int(boundary(next_year, next_month).timestamp())


def billable(upload, download, mode):
    if mode in ("up", "upload"):
        return upload
    if mode in ("down", "download"):
        return download
    if mode == "sum":
        return upload + download
    if mode == "min":
        return min(upload, download)
    return max(upload, download)


def nonnegative(value):
    number = float(value or 0)
    if not math.isfinite(number) or number < 0:
        raise ValueError("Invalid traffic delta")
    return int(number)


class TrafficLedger:
    def __init__(self, source_path, state_path):
        self.source_path = Path(source_path).resolve()
        self.state_path = Path(state_path).resolve()
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS clients (
                    uuid TEXT PRIMARY KEY, name TEXT NOT NULL, quota INTEGER NOT NULL,
                    mode TEXT NOT NULL, reset_day INTEGER NOT NULL, baseline REAL
                );
                CREATE TABLE IF NOT EXISTS observations (
                    uuid TEXT NOT NULL, sample_time TEXT NOT NULL, bucket INTEGER NOT NULL,
                    upload INTEGER NOT NULL, download INTEGER NOT NULL,
                    PRIMARY KEY(uuid, sample_time)
                );
                CREATE INDEX IF NOT EXISTS observations_bucket ON observations(bucket);
                CREATE INDEX IF NOT EXISTS observations_client_bucket ON observations(uuid,bucket);
                CREATE TABLE IF NOT EXISTS buckets (
                    uuid TEXT NOT NULL, bucket INTEGER NOT NULL,
                    upload INTEGER NOT NULL, download INTEGER NOT NULL,
                    source TEXT NOT NULL, sample_at REAL NOT NULL,
                    PRIMARY KEY(uuid, bucket)
                );
                CREATE TABLE IF NOT EXISTS calibrations (
                    uuid TEXT NOT NULL, period_start INTEGER NOT NULL,
                    reset_day INTEGER NOT NULL, mode TEXT NOT NULL,
                    amount INTEGER NOT NULL, upload_anchor INTEGER NOT NULL,
                    download_anchor INTEGER NOT NULL, applied_at REAL NOT NULL,
                    PRIMARY KEY(uuid, period_start)
                );
                CREATE INDEX IF NOT EXISTS buckets_time ON buckets(bucket);
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.state_path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def sync(self, now=None):
        now = time.time() if now is None else now
        source = sqlite3.connect(self.source_path.as_uri() + "?mode=ro", uri=True, timeout=10)
        source.row_factory = sqlite3.Row
        try:
            source.execute('BEGIN')
            with self.connect() as state:
                previous_sync = state.execute("SELECT value FROM meta WHERE key='last_sync'").fetchone()
                last_sync = float(previous_sync[0]) if previous_sync else now - 62 * 86400
                reconcile = state.execute("SELECT value FROM meta WHERE key='last_reconcile'").fetchone()
                broad = not reconcile or now-float(reconcile[0]) >= 900
                window = 86400 if broad else 3600
                coarse_since = max(now - 62 * 86400, min(last_sync - window, now - window))
                fine_since = max(now - 62 * 86400, min(last_sync - 1800, now - 1800))
                cursor = state.execute("SELECT value FROM meta WHERE key='coarse_rowid'").fetchone()
                coarse_rowid = int(cursor[0]) if cursor else 0
                nodes = source.execute("""
                    SELECT uuid,name,traffic_limit,traffic_limit_type,
                           {reset},{baseline} FROM clients
                """.format(
                    reset='traffic_reset_day' if 'traffic_reset_day' in {r[1] for r in source.execute('PRAGMA table_info(clients)')} else '1 AS traffic_reset_day',
                    baseline='traffic_baseline_usage' if 'traffic_baseline_usage' in {r[1] for r in source.execute('PRAGMA table_info(clients)')} else 'NULL AS traffic_baseline_usage',
                )).fetchall()
                previous_nodes = {r['uuid']: dict(r) for r in state.execute('SELECT * FROM clients')}

                # Compacted rows represent completed 15-minute buckets. Repeated
                # compaction rows overwrite a bucket; they are never added again.
                for row in source.execute("""
                    SELECT rowid AS source_rowid,client,time,traffic_up,traffic_down FROM records_long_term
                    WHERE (rowid>? OR time>=?) AND time<=? ORDER BY time,rowid
                """, (coarse_rowid,sql_time(coarse_since), sql_time(now - BUCKET_SECONDS))):
                    coarse_rowid = max(coarse_rowid,row['source_rowid'])
                    observed = timestamp(row['time'])
                    bucket = int(observed // BUCKET_SECONDS) * BUCKET_SECONDS
                    self._put_bucket(state, row['client'], bucket,
                                     nonnegative(row['traffic_up']), nonnegative(row['traffic_down']),
                                     'coarse', bucket + BUCKET_SECONDS)

                touched = set()
                for row in source.execute("""
                    SELECT client,time,traffic_up,traffic_down FROM records
                    WHERE time>=? AND time<=? ORDER BY time,rowid
                """, (sql_time(fine_since), sql_time(now))):
                    observed = timestamp(row['time'])
                    bucket = int(observed // BUCKET_SECONDS) * BUCKET_SECONDS
                    state.execute("""
                        INSERT INTO observations VALUES(?,?,?,?,?)
                        ON CONFLICT(uuid,sample_time) DO UPDATE SET
                          upload=excluded.upload,download=excluded.download
                        WHERE observations.upload!=excluded.upload OR observations.download!=excluded.download
                    """, (row['client'], row['time'], bucket,
                          nonnegative(row['traffic_up']), nonnegative(row['traffic_down'])))
                    touched.add((row['client'], bucket))
                for uuid, bucket in touched:
                    coarse = state.execute("SELECT source FROM buckets WHERE uuid=? AND bucket=?", (uuid, bucket)).fetchone()
                    if coarse and coarse[0] == 'coarse':
                        continue
                    aggregate = state.execute("""
                        SELECT SUM(upload),SUM(download),MAX(sample_time)
                        FROM observations WHERE uuid=? AND bucket=?
                    """, (uuid, bucket)).fetchone()
                    self._put_bucket(state, uuid, bucket, aggregate[0], aggregate[1],
                                     'fine', timestamp(aggregate[2]))

                for node in nodes:
                    uuid = node['uuid']
                    quota = nonnegative(node['traffic_limit'])
                    mode = node['traffic_limit_type'] or 'max'
                    day = max(1, min(31, int(node['traffic_reset_day'] or 1)))
                    baseline = node['traffic_baseline_usage']
                    previous = previous_nodes.get(uuid)
                    # Existing legacy baselines have no timestamp and are not
                    # reapplied during migration. A later explicit edit is a
                    # calibration for this cycle only.
                    if previous and previous['baseline'] != baseline:
                        start, end = cycle_bounds(now, day)
                        if baseline is None:
                            state.execute('DELETE FROM calibrations WHERE uuid=? AND period_start=?', (uuid, start))
                        else:
                            upload, download = self._totals(state, uuid, start, end)
                            state.execute('INSERT OR REPLACE INTO calibrations VALUES(?,?,?,?,?,?,?,?)',
                                          (uuid, start, day, mode, nonnegative(float(baseline) * 1024 ** 3), upload, download, now))
                    state.execute('''INSERT INTO clients VALUES(?,?,?,?,?,?) ON CONFLICT(uuid) DO UPDATE SET
                        name=excluded.name,quota=excluded.quota,mode=excluded.mode,reset_day=excluded.reset_day,baseline=excluded.baseline
                        WHERE clients.name!=excluded.name OR clients.quota!=excluded.quota OR clients.mode!=excluded.mode
                           OR clients.reset_day!=excluded.reset_day OR clients.baseline IS NOT excluded.baseline''',
                                  (uuid, node['name'], quota, mode, day, baseline))
                active_ids = {node['uuid'] for node in nodes}
                for uuid in set(previous_nodes) - active_ids:
                    state.execute('DELETE FROM clients WHERE uuid=?', (uuid,))
                state.execute('DELETE FROM observations WHERE bucket<?', (now - 2 * 86400,))
                state.execute('DELETE FROM buckets WHERE bucket<?', (now - 400 * 86400,))
                state.execute('DELETE FROM calibrations WHERE period_start<?', (now - 400 * 86400,))
                state.execute("INSERT OR REPLACE INTO meta VALUES('last_sync',?)", (str(now),))
                state.execute("INSERT OR REPLACE INTO meta VALUES('coarse_rowid',?)",(str(coarse_rowid),))
                if broad:state.execute("INSERT OR REPLACE INTO meta VALUES('last_reconcile',?)",(str(now),))
                return len(nodes)
        finally:
            source.close()

    @staticmethod
    def _put_bucket(db, uuid, bucket, upload, download, source, sample_at):
        db.execute("""
            INSERT INTO buckets VALUES(?,?,?,?,?,?)
            ON CONFLICT(uuid,bucket) DO UPDATE SET
              upload=excluded.upload,
              download=excluded.download,
              source=excluded.source,sample_at=MAX(buckets.sample_at,excluded.sample_at)
            WHERE buckets.upload!=excluded.upload OR buckets.download!=excluded.download
               OR buckets.source!=excluded.source OR buckets.sample_at<excluded.sample_at
        """, (uuid, bucket, upload, download, source, sample_at))

    @staticmethod
    def _totals(db, uuid, start, end):
        row = db.execute("""
            SELECT COALESCE(SUM(upload),0),COALESCE(SUM(download),0)
            FROM buckets WHERE uuid=? AND bucket>=? AND bucket<?
        """, (uuid, start, end)).fetchone()
        return row[0], row[1]

    def snapshot(self, visible_ids=None, now=None):
        now = time.time() if now is None else now
        with self.connect() as db:
            db.execute('BEGIN')
            last_sync = db.execute("SELECT value FROM meta WHERE key='last_sync'").fetchone()
            if not last_sync:
                raise RuntimeError('Initial traffic history import is still running')
            result = {}
            for node in db.execute('SELECT * FROM clients'):
                uuid = node['uuid']
                if visible_ids is not None and uuid not in visible_ids:
                    continue
                start, end = cycle_bounds(now, node['reset_day'])
                upload, download = self._totals(db, uuid, start, end)
                mode = node['mode'] if node['quota'] > 0 else 'sum'
                used = billable(upload, download, mode)
                calibration = db.execute('SELECT * FROM calibrations WHERE uuid=? AND period_start=?', (uuid, start)).fetchone()
                calibrated = bool(calibration and calibration['mode'] == node['mode'] and calibration['reset_day'] == node['reset_day'])
                if calibrated:
                    used = calibration['amount'] + billable(max(0, upload-calibration['upload_anchor']), max(0, download-calibration['download_anchor']), mode)
                coverage = db.execute('SELECT MIN(bucket),MAX(sample_at) FROM buckets WHERE uuid=?', (uuid,)).fetchone()
                expected_buckets = max(0, (int(now)//BUCKET_SECONDS*BUCKET_SECONDS-start)//BUCKET_SECONDS)
                actual_buckets = db.execute('SELECT COUNT(*) FROM buckets WHERE uuid=? AND bucket>=? AND bucket<?',
                    (uuid,start,int(now)//BUCKET_SECONDS*BUCKET_SECONDS)).fetchone()[0]
                quota = node['quota']
                result[uuid] = {
                    'used_bytes': used,
                    'remaining_bytes': max(0, quota-used) if quota else None,
                    'limit_bytes': quota,
                    'upload_bytes': upload, 'download_bytes': download,
                    'billing_mode': mode, 'reset_day': node['reset_day'],
                    'period_start': iso_time(start), 'period_end': iso_time(end),
                    'usage_percent': used/quota*100 if quota else 0,
                    'history_partial': coverage[0] is None or coverage[0] > start,
                    'coverage_start': iso_time(coverage[0]) if coverage[0] is not None else None,
                    'sample_at': iso_time(coverage[1]) if coverage[1] is not None else None,
                    'calibrated': calibrated,
                    'calibration': {'amount':calibration['amount'],'upload_anchor':calibration['upload_anchor'],
                        'download_anchor':calibration['download_anchor']} if calibrated else None,
                    'coverage_ratio': min(1,actual_buckets/expected_buckets) if expected_buckets else 1,
                }
            return {'server_time': iso_time(now), 'timezone': 'Asia/Shanghai',
                    'last_sync': iso_time(float(last_sync[0])), 'nodes': result}

    def forecast_input(self, visible_ids=None, now=None):
        """Return the canonical quota snapshot and daily deltas from the same sync."""
        now = time.time() if now is None else now
        for _ in range(3):
            snapshot = self.snapshot(visible_ids, now)
            nodes = []
            with self.connect() as db:
                db.execute('BEGIN')
                last_sync = db.execute("SELECT value FROM meta WHERE key='last_sync'").fetchone()[0]
                if iso_time(float(last_sync)) != snapshot['last_sync']:
                    continue
                for uuid, quota in snapshot['nodes'].items():
                    meta = db.execute('SELECT name FROM clients WHERE uuid=?', (uuid,)).fetchone()
                    since = timestamp(quota['period_start'])
                    rows = db.execute('''
                        SELECT CAST((bucket+28800)/86400 AS INTEGER)*86400-28800 AS day,
                               SUM(upload) AS upload,SUM(download) AS download,COUNT(*) AS samples
                        FROM buckets WHERE uuid=? AND bucket>=? AND bucket<?
                        GROUP BY day ORDER BY day
                    ''', (uuid, since, timestamp(quota['period_end']))).fetchall()
                    history = [{
                        'date': dt.datetime.fromtimestamp(row['day'], BILLING_TZ).strftime('%Y-%m-%d'),
                        'timestamp': row['day'] * 1000,
                        'out_bytes': row['upload'], 'in_bytes': row['download'],
                        'samples': row['samples'],
                        'coverage_ratio': min(1,row['samples']/96),
                        'complete': row['samples'] >= 96 and row['day']+86400 <= now,
                        'is_today': row['day'] <= now < row['day']+86400,
                    } for row in rows]
                    nodes.append({'uuid': uuid, 'name': meta['name'], 'quota': quota, 'history': history})
            return {'ok': True, 'source': 'persistent-ledger', 'generated_at': snapshot['server_time'],
                    'last_sync': snapshot['last_sync'], 'nodes': nodes}
        raise RuntimeError('Traffic ledger changed during forecast read; retry')
