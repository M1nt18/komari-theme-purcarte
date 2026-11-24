"""Durable billing-cycle totals built from Komari's per-direction traffic deltas."""

import calendar
import datetime as dt
import math
import os
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from contextlib import closing, contextmanager

UTC = dt.timezone.utc
BILLING_TZ = dt.timezone(dt.timedelta(hours=8))
BUCKET_SECONDS = 15 * 60
COUNTER_OVERCOUNT_MIN = 64 * 1024 ** 2


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


def counter_overcount(reported, previous, current):
    """Identify a lifetime total mistakenly included in a short interval delta."""
    if previous is None or current is None or not 0 < previous <= current:
        return 0
    increase = current - previous
    excess = reported - increase
    if (excess >= COUNTER_OVERCOUNT_MIN and
            reported * 10 >= current * 9 and reported >= 32 * max(increase, 1)):
        return excess
    return 0


@dataclass(frozen=True)
class _ReadModel:
    bucket: int
    last_sync: str
    nodes: dict


class TrafficLedger:
    def __init__(self, source_path, state_path, metrics_path=None, metrics_start=None):
        self.source_path = Path(source_path).resolve()
        self.metrics_path = Path(metrics_path or os.environ.get('KOMARI_METRICS_DB')
                                 or self.source_path.with_name('metrics.db')).resolve()
        self.metrics_start = metrics_start if metrics_start is not None else os.environ.get('KOMARI_METRICS_START')
        self.state_path = Path(state_path).resolve()
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self._read_lock = threading.Lock()
        self._read_model = None
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
                CREATE TABLE IF NOT EXISTS bucket_corrections (
                    uuid TEXT NOT NULL, bucket INTEGER NOT NULL,
                    upload INTEGER NOT NULL CHECK(upload >= 0),
                    download INTEGER NOT NULL CHECK(download >= 0),
                    reason TEXT NOT NULL,
                    PRIMARY KEY(uuid, bucket)
                );
                CREATE VIEW IF NOT EXISTS effective_buckets AS
                    SELECT b.uuid, b.bucket,
                           COALESCE(c.upload, b.upload) AS upload,
                           COALESCE(c.download, b.download) AS download
                    FROM buckets b
                    LEFT JOIN bucket_corrections c ON c.uuid=b.uuid AND c.bucket=b.bucket;
                CREATE TABLE IF NOT EXISTS counter_overcounts (
                    uuid TEXT NOT NULL, bucket INTEGER NOT NULL, sample_time TEXT NOT NULL,
                    upload INTEGER NOT NULL CHECK(upload >= 0),
                    download INTEGER NOT NULL CHECK(download >= 0),
                    PRIMARY KEY(uuid, bucket, sample_time)
                );
                CREATE INDEX IF NOT EXISTS counter_overcounts_time ON counter_overcounts(bucket);
                CREATE INDEX IF NOT EXISTS buckets_client_sample ON buckets(uuid,sample_at);
                CREATE TABLE IF NOT EXISTS legacy_counters (
                    uuid TEXT PRIMARY KEY, sample_at REAL NOT NULL, upload INTEGER, download INTEGER
                );
                CREATE TABLE IF NOT EXISTS metric_bridge (
                    uuid TEXT PRIMARY KEY, bucket INTEGER NOT NULL, upload INTEGER NOT NULL, download INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS metric_parts (
                    uuid TEXT NOT NULL, bucket INTEGER NOT NULL, width INTEGER NOT NULL,
                    samples INTEGER NOT NULL, upload INTEGER NOT NULL, download INTEGER NOT NULL,
                    sample_at REAL NOT NULL, PRIMARY KEY(uuid, bucket, width)
                );
                CREATE INDEX IF NOT EXISTS metric_parts_time ON metric_parts(bucket);
                CREATE TABLE IF NOT EXISTS metric_tail (
                    uuid TEXT PRIMARY KEY, bucket INTEGER NOT NULL, upload INTEGER NOT NULL, download INTEGER NOT NULL
                );
                -- Replace the view atomically for both existing and new ledgers.
                BEGIN IMMEDIATE;
                DROP VIEW IF EXISTS verified_buckets;
                CREATE VIEW verified_buckets AS
                    SELECT b.uuid, b.bucket,
                           COALESCE(c.upload, MAX(0, b.upload - COALESCE(d.upload, 0))) + COALESCE(t.upload, 0) AS upload,
                           COALESCE(c.download, MAX(0, b.download - COALESCE(d.download, 0))) + COALESCE(t.download, 0) AS download
                    FROM buckets b
                    LEFT JOIN bucket_corrections c ON c.uuid=b.uuid AND c.bucket=b.bucket
                    LEFT JOIN metric_tail t ON t.uuid=b.uuid AND t.bucket=b.bucket
                    LEFT JOIN (
                        SELECT uuid,bucket,SUM(upload) AS upload,SUM(download) AS download
                        FROM counter_overcounts GROUP BY uuid,bucket
                    ) d ON d.uuid=b.uuid AND d.bucket=b.bucket;
                COMMIT;
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.state_path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
            if db.total_changes:
                # Invalidate only after a successful commit, including manual corrections.
                with self._read_lock:
                    self._read_model = None
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
                tables = {row[0] for row in source.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('records','records_long_term')"
                )}
                native_start = state.execute("SELECT value FROM meta WHERE key='metrics_start'").fetchone()
                if tables == {'records', 'records_long_term'} and native_start is None:
                    self._sync_legacy(source, state, now, last_sync)
                elif not tables:
                    self._sync_metrics(state, now, native_start, last_sync)
                else:
                    raise RuntimeError('Inconsistent traffic source; verify migration or restore the matching ledger')
                columns = {r[1] for r in source.execute('PRAGMA table_info(clients)')}
                nodes = source.execute('SELECT uuid,name,traffic_limit,traffic_limit_type'
                    + (',traffic_reset_day' if 'traffic_reset_day' in columns else '')
                    + (',traffic_baseline_usage' if 'traffic_baseline_usage' in columns else '')
                    + ' FROM clients').fetchall()
                previous_nodes = {r['uuid']: dict(r) for r in state.execute('SELECT * FROM clients')}
                for node in nodes:
                    uuid = node['uuid']
                    quota = nonnegative(node['traffic_limit'])
                    mode = node['traffic_limit_type'] or 'max'
                    previous = previous_nodes.get(uuid, {})
                    reset_day = node['traffic_reset_day'] if 'traffic_reset_day' in columns else previous.get('reset_day')
                    day = max(1, min(31, int(reset_day or 1)))
                    baseline = node['traffic_baseline_usage'] if 'traffic_baseline_usage' in columns else previous.get('baseline')
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
                state.execute('DELETE FROM counter_overcounts WHERE bucket<?', (now - 400 * 86400,))
                state.execute('DELETE FROM calibrations WHERE period_start<?', (now - 400 * 86400,))
                state.execute("INSERT OR REPLACE INTO meta VALUES('last_sync',?)", (str(now),))
        finally:
            source.close()
        self._read_at(now)
        return len(nodes)

    def _sync_metrics(self, state, now, stored_start, last_sync):
        # v1.6 imports old records as hourly P95 representatives. Even its
        # minute tier contains those synthetic points; only native reports
        # following the recorded handover are usable as byte deltas.
        configured = None if self.metrics_start in (None, '') else int(self.metrics_start)
        start = int(stored_start[0]) if stored_start else configured
        if start is None or start <= 0 or start % 60 or start > now:
            raise ValueError('KOMARI_METRICS_START must be the UTC Unix second of the first native reporting minute')
        if configured is not None and configured != start:
            raise ValueError('KOMARI_METRICS_START differs from the persisted ledger handover')
        if not stored_start:
            # A coarse sample is timestamped at the exclusive end of the
            # previous quarter. A fine sample is timestamped at the actual report.
            overlap = state.execute("""
                SELECT 1 FROM buckets WHERE sample_at>? OR (sample_at=? AND source='fine') LIMIT 1
            """, (start, start)).fetchone()
            if overlap:
                raise ValueError('Native metrics handover overlaps imported legacy traffic')
            state.execute("INSERT INTO meta VALUES('metrics_start',?)", (str(start),))
        since = max(start, (int(last_sync) - 900) // 3600 * 3600) if stored_start else start
        recover_days = now - since > 86400
        if recover_days:
            since = max(start, since // 86400 * 86400)
        scan_interval = 86400 if recover_days else 3600
        scan_from = since // scan_interval * scan_interval
        uri = self.metrics_path.as_uri() + '?mode=ro'
        with closing(sqlite3.connect(uri, uri=True, timeout=10)) as metrics:
            metrics.row_factory = sqlite3.Row
            metrics.execute('BEGIN')
            # The old database retained hourly representatives even after
            # compaction; exclude any parent straddling the handover unless
            # its actual first observation is native.
            rows = metrics.execute("""
                SELECT s.entity_id AS uuid, r.bucket_milli / 1000 AS bucket,
                       d.resolution_milli / 1000 AS width,
                       MIN(r.count) AS samples, MAX(r.count) AS max_samples,
                       COUNT(*) AS directions, MAX(r.last_ts_milli)/1000.0 AS sample_at,
                       MAX(CASE WHEN s.metric_name='traffic.up' THEN r.sum END) AS upload,
                       MAX(CASE WHEN s.metric_name='traffic.down' THEN r.sum END) AS download
                FROM metric_rollups r JOIN metric_resolutions d ON d.id=r.resolution_id
                JOIN metric_series s ON s.id=r.series_id JOIN metric_label_sets l ON l.id=r.label_id
                WHERE s.metric_name IN ('traffic.up','traffic.down') AND s.tags='{}' AND l.labels='{}'
                  AND r.bucket_milli>=? AND r.bucket_milli<=?
                  AND r.first_ts_milli>=? AND r.last_ts_milli<=?
                  AND d.resolution_milli IN (60000,300000,3600000,86400000)
                GROUP BY s.entity_id,d.resolution_milli,r.bucket_milli
            """, (scan_from * 1000, int(now * 1000), start * 1000, int(now * 1000)))
            changed_hours = set()
            daily_checks = []
            for row in rows:
                width, bucket = row['width'], row['bucket']
                if bucket + width <= since:
                    continue
                if row['directions'] != 2 or row['samples'] != row['max_samples'] or row['samples'] <= 0:
                    raise ValueError('Incomplete paired native traffic rollup')
                if width == 86400:
                    daily_checks.append(row)
                    continue
                changed = state.execute("""
                    INSERT INTO metric_parts VALUES(?,?,?,?,?,?,?)
                    ON CONFLICT(uuid,bucket,width) DO UPDATE SET samples=excluded.samples,
                      upload=excluded.upload,download=excluded.download,sample_at=excluded.sample_at
                    WHERE metric_parts.samples!=excluded.samples OR metric_parts.upload!=excluded.upload
                       OR metric_parts.download!=excluded.download OR metric_parts.sample_at!=excluded.sample_at
                """, (row['uuid'], bucket, width, row['samples'], nonnegative(row['upload']),
                      nonnegative(row['download']), row['sample_at']))
                if changed.rowcount:
                    changed_hours.add((row['uuid'], bucket // 3600 * 3600))
            self._bridge_counters(metrics, state, start, now, changed_hours)
        # Recovery older than hourly retention: a UTC day straddles local
        # billing dates. Never silently treat its total as one local day.
        for row in daily_checks:
            if not recover_days or row['bucket'] + 86400 <= since or row['bucket'] + 86400 > now:
                continue
            covered = state.execute("""
                SELECT SUM(samples) FROM metric_parts WHERE uuid=? AND width=3600 AND bucket>=? AND bucket<?
            """, (row['uuid'], row['bucket'], row['bucket'] + 86400)).fetchone()[0]
            if (covered or 0) < row['samples']:
                # Some installations only materialize minute/5-minute parents.
                # Those finer parts also prove that the entire day is present.
                n = 0
                for hour in range(row['bucket'], row['bucket'] + 86400, 3600):
                    n += sum(part[0] for part in self._native_quarters(state, row['uuid'], hour).values())
                if n < row['samples']:
                    raise ValueError('UTC daily traffic survives without enough finer history; restore the archived metrics.db')
        for uuid, hour in changed_hours:
            bridge = state.execute('SELECT * FROM metric_bridge WHERE uuid=?', (uuid,)).fetchone()
            quarters = self._native_quarters(state, uuid, hour)
            # Finer observations may arrive after a stored hour-only estimate.
            # Remove superseded quarter assignments within this rebuilt hour.
            for old in state.execute("""
                SELECT bucket FROM buckets WHERE uuid=? AND source='metric' AND bucket>=? AND bucket<?
            """, (uuid, hour, hour + 3600)).fetchall():
                if old['bucket'] not in quarters:
                    state.execute("DELETE FROM buckets WHERE uuid=? AND bucket=?", (uuid, old['bucket']))
            for bucket, (_, upload, download, sample_at) in quarters.items():
                if bridge and bridge['bucket'] == bucket:
                    upload += bridge['upload']
                    download += bridge['download']
                if min(upload, download) < 0:
                    raise ValueError('Native report baseline exceeds the accumulated traffic')
                if bucket == start // BUCKET_SECONDS * BUCKET_SECONDS:
                    legacy = state.execute("SELECT 1 FROM buckets WHERE uuid=? AND bucket=? AND source!='metric'",
                                           (uuid, bucket)).fetchone()
                    if legacy:
                        # A legacy bucket may have a manual or automatic correction.
                        # Its native tail is added after applying that correction.
                        state.execute('INSERT OR REPLACE INTO metric_tail VALUES(?,?,?,?)',
                                      (uuid, bucket, upload, download))
                        state.execute('UPDATE buckets SET sample_at=MAX(sample_at,?) WHERE uuid=? AND bucket=?',
                                      (sample_at, uuid, bucket))
                        continue
                self._put_bucket(state, uuid, bucket, upload, download, 'metric', sample_at)
        state.execute('DELETE FROM metric_parts WHERE bucket<?', (int(now) // 86400 * 86400 - 2 * 86400,))

    @staticmethod
    def _native_quarters(state, uuid, hour):
        """Use each sample once even when multiple retained tiers describe it."""
        totals = {}  # values are [sample count, uploaded bytes, downloaded bytes, latest sample]
        rows = state.execute("""
            SELECT * FROM metric_parts WHERE uuid=? AND bucket>=? AND bucket<?
            ORDER BY width,bucket
        """, (uuid, hour, hour + 3600))
        # The persisted minute tier can expire partway through a five-minute
        # parent. A parent contributes only the samples absent from finer tiers.
        for row in rows:
            first, end = row['bucket'], row['bucket'] + row['width']
            count, up, down = row['samples'], row['upload'], row['download']
            if row['width'] > 60:
                children = [value for at, value in totals.items() if first <= at < end]
                count -= sum(value[0] for value in children)
                if count <= 0:
                    continue
                up -= sum(value[1] for value in children)
                down -= sum(value[2] for value in children)
                if min(up, down) < 0:
                    raise ValueError('Inconsistent overlapping native traffic rollups')
            at = int(row['sample_at']) // 60 * 60
            dest = totals.setdefault(at, [0, 0, 0, 0])
            dest[0] += count
            dest[1] += up
            dest[2] += down
            dest[3] = max(dest[3], row['sample_at'])
        quarters = {}
        for at, (count, up, down, latest) in totals.items():
            bucket = at // BUCKET_SECONDS * BUCKET_SECONDS
            dest = quarters.setdefault(bucket, [0, 0, 0, 0])
            dest[0] += count
            dest[1] += up
            dest[2] += down
            dest[3] = max(dest[3], latest)
        return quarters

    @staticmethod
    def _bridge_counters(metrics, state, start, now, changed_hours):
        # Upstream may restore a P95 counter, or initialize the first new
        # interval to zero. Bridge the two actual counters when both endpoints
        # fall in one billing cycle within the core's 15-minute gap limit.
        for old in state.execute("""
            SELECT l.*,c.reset_day FROM legacy_counters l JOIN clients c ON c.uuid=l.uuid
            LEFT JOIN metric_bridge m ON m.uuid=l.uuid
            WHERE m.uuid IS NULL AND l.sample_at>=?
        """, (start - BUCKET_SECONDS,)):
            points = metrics.execute("""
                SELECT s.metric_name,r.first_ts_milli,r.first_val FROM metric_series s
                JOIN metric_rollups r ON r.series_id=s.id
                JOIN metric_resolutions d ON d.id=r.resolution_id JOIN metric_label_sets l ON l.id=r.label_id
                WHERE s.entity_id=? AND s.tags='{}' AND l.labels='{}' AND d.resolution_milli=60000
                  AND s.metric_name IN ('net.total.up','net.total.down','traffic.up','traffic.down')
                  AND r.bucket_milli>=? AND r.bucket_milli<=? AND r.first_ts_milli<=?
                ORDER BY r.bucket_milli,s.metric_name LIMIT 4
            """, (old['uuid'], start * 1000, int((old['sample_at'] + BUCKET_SECONDS) * 1000), int(now * 1000))).fetchall()
            if len(points) != 4 or len({r['first_ts_milli'] for r in points}) != 1:
                continue
            at = points[0]['first_ts_milli'] / 1000
            if at - old['sample_at'] > BUCKET_SECONDS or cycle_bounds(at, old['reset_day'])[0] > old['sample_at']:
                continue
            values = {r['metric_name']: nonnegative(r['first_val']) for r in points}
            adjustments = []
            for direction, field in [('up', 'upload'), ('down', 'download')]:
                previous, current = old[field], values['net.total.' + direction]
                if previous is None or previous < 0:
                    adjustments.append(0)
                else:
                    delta = current - previous if current >= previous else (current if current <= 64 << 30 else 0)
                    adjustments.append(delta - values['traffic.' + direction])
            bucket = int(at) // BUCKET_SECONDS * BUCKET_SECONDS
            state.execute('INSERT INTO metric_bridge VALUES(?,?,?,?)', (old['uuid'], bucket, *adjustments))
            changed_hours.add((old['uuid'], bucket // 3600 * 3600))

    def _sync_legacy(self, source, state, now, last_sync):
        reconcile = state.execute("SELECT value FROM meta WHERE key='last_reconcile'").fetchone()
        broad = not reconcile or now-float(reconcile[0]) >= 900
        window = 86400 if broad else 3600
        coarse_since = max(now - 62 * 86400, min(last_sync - window, now - window))
        fine_since = max(now - 62 * 86400, min(last_sync - 1800, now - 1800))
        counter_guard_active = state.execute(
            "SELECT 1 FROM meta WHERE key='counter_guard_active'"
        ).fetchone()
        if not counter_guard_active:
            fine_since = min(fine_since, now - 5 * 3600)
        cursor = state.execute("SELECT value FROM meta WHERE key='coarse_rowid'").fetchone()
        coarse_rowid = int(cursor[0]) if cursor else 0
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
        has_counters = {'net_total_up', 'net_total_down'}.issubset(
            column[1] for column in source.execute('PRAGMA table_info(records)')
        )
        counters = ',net_total_up,net_total_down' if has_counters else ''
        previous_samples = {}
        for row in source.execute("""
            SELECT client,time,traffic_up,traffic_down{counters} FROM records
            WHERE time>=? AND time<=? ORDER BY time,rowid
        """.format(counters=counters), (sql_time(fine_since), sql_time(now))):
            observed = timestamp(row['time'])
            bucket = int(observed // BUCKET_SECONDS) * BUCKET_SECONDS
            upload = nonnegative(row['traffic_up'])
            download = nonnegative(row['traffic_down'])
            if has_counters:
                uuid = row['client']
                if uuid not in previous_samples:
                    previous_samples[uuid] = source.execute("""
                        SELECT time,net_total_up,net_total_down FROM records
                        WHERE client=? AND time>=? AND time<?
                        ORDER BY time DESC,rowid DESC LIMIT 1
                    """, (uuid, sql_time(fine_since - BUCKET_SECONDS),
                          sql_time(fine_since))).fetchone()
                previous = previous_samples[uuid]
                if previous and 0 < observed - timestamp(previous['time']) <= BUCKET_SECONDS:
                    excess_up = counter_overcount(upload, previous['net_total_up'], row['net_total_up'])
                    excess_down = counter_overcount(download, previous['net_total_down'], row['net_total_down'])
                    self._record_counter_overcount(
                        state, uuid, bucket, row['time'], excess_up, excess_down,
                    )
                previous_samples[uuid] = row
            state.execute("""
                INSERT INTO observations VALUES(?,?,?,?,?)
                ON CONFLICT(uuid,sample_time) DO UPDATE SET
                  upload=excluded.upload,download=excluded.download
                WHERE observations.upload!=excluded.upload OR observations.download!=excluded.download
            """, (row['client'], row['time'], bucket,
                  upload, download))
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

        state.execute("INSERT OR REPLACE INTO meta VALUES('coarse_rowid',?)",(str(coarse_rowid),))
        if not counter_guard_active:
            state.execute("INSERT INTO meta VALUES('counter_guard_active','1')")
        if broad:state.execute("INSERT OR REPLACE INTO meta VALUES('last_reconcile',?)",(str(now),))
        state.executemany(
            'INSERT OR REPLACE INTO legacy_counters VALUES(?,?,?,?)',
            ((uuid, timestamp(row['time']), row['net_total_up'], row['net_total_down'])
             for uuid, row in previous_samples.items() if row is not None),
        )

    @staticmethod
    def _record_counter_overcount(db, uuid, bucket, sample_time, upload, download):
        if upload or download:
            db.execute("""
                INSERT INTO counter_overcounts VALUES(?,?,?,?,?)
                ON CONFLICT(uuid,bucket,sample_time) DO UPDATE SET upload=excluded.upload,download=excluded.download
                WHERE counter_overcounts.upload!=excluded.upload OR counter_overcounts.download!=excluded.download
            """, (uuid, bucket, sample_time, upload, download))
        else:
            db.execute('DELETE FROM counter_overcounts WHERE uuid=? AND bucket=? AND sample_time=?',
                       (uuid, bucket, sample_time))

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
            FROM verified_buckets WHERE uuid=? AND bucket>=? AND bucket<?
        """, (uuid, start, end)).fetchone()
        return row[0], row[1]

    def _read_at(self, now):
        # All fields other than the response clock change at sync, or at a
        # 15-minute boundary (coverage counts, local midnight and reset days).
        bucket = int(now // BUCKET_SECONDS) * BUCKET_SECONDS
        with self._read_lock:
            if self._read_model is None or self._read_model.bucket != bucket:
                with self.connect() as db:
                    db.execute('BEGIN')
                    self._read_model = self._build_read_model(db, bucket)
            return self._read_model

    @staticmethod
    def _build_read_model(db, bucket):
        last_sync = db.execute("SELECT value FROM meta WHERE key='last_sync'").fetchone()
        if not last_sync:
            raise RuntimeError('Initial traffic history import is still running')
        # Both scalar lookups seek to an end of a covering index, including for
        # nodes whose first sample predates the bounded daily history query.
        clients = db.execute("""
            SELECT c.*,
                   (SELECT MIN(b.bucket) FROM buckets b WHERE b.uuid=c.uuid) AS first_bucket,
                   (SELECT MAX(b.sample_at) FROM buckets b WHERE b.uuid=c.uuid) AS last_sample
            FROM clients c
        """).fetchall()
        model = _ReadModel(bucket, iso_time(float(last_sync[0])), {})
        if not clients:
            return model
        periods = {c['uuid']: cycle_bounds(bucket, c['reset_day']) for c in clients}
        first_period = min(start for start, _ in periods.values())
        last_end = max(end for _, end in periods.values())
        calibrations = {(r['uuid'], r['period_start']): r for r in db.execute(
            'SELECT * FROM calibrations WHERE period_start>=? AND period_start<?',
            (first_period, last_end),
        )}
        today = int(dt.datetime.fromtimestamp(bucket, BILLING_TZ).replace(
            hour=0, minute=0, second=0, microsecond=0).timestamp())
        forecast_start = today - 7 * 86400
        daily = {}
        for row in db.execute("""
            SELECT uuid, CAST((bucket+28800)/86400 AS INTEGER)*86400-28800 AS day,
                   SUM(upload) AS upload, SUM(download) AS download,
                   COUNT(*) AS samples, SUM(bucket < ?) AS finished
            FROM verified_buckets WHERE bucket>=? AND bucket<?
            GROUP BY day, uuid ORDER BY day, uuid
        """, (bucket, min(first_period, forecast_start), last_end)):
            daily.setdefault(row['uuid'], []).append(row)
        for client in clients:
            uuid = client['uuid']
            start, end = periods[uuid]
            upload = download = actual_buckets = 0
            history = []
            for row in daily.get(uuid, ()):
                day = row['day']
                if not min(start, forecast_start) <= day < end:
                    continue
                if day >= start:
                    upload += row['upload']
                    download += row['download']
                    actual_buckets += row['finished']
                history.append({
                    'date': dt.datetime.fromtimestamp(day, BILLING_TZ).date().isoformat(),
                    'timestamp': day * 1000,
                    'out_bytes': row['upload'], 'in_bytes': row['download'],
                    'samples': row['samples'], 'coverage_ratio': min(1, row['samples'] / 96),
                    'complete': row['samples'] >= 96 and day < today,
                    'is_today': day == today,
                })

            limit = client['quota']
            mode = client['mode'] if limit > 0 else 'sum'
            used = billable(upload, download, mode)
            calibration = calibrations.get((uuid, start))
            adjustment = None
            if (calibration and calibration['mode'] == client['mode']
                    and calibration['reset_day'] == client['reset_day']):
                adjustment = {key: calibration[key] for key in ('amount', 'upload_anchor', 'download_anchor')}
                used = adjustment['amount'] + billable(max(0, upload - adjustment['upload_anchor']),
                                                       max(0, download - adjustment['download_anchor']), mode)
            first, latest = client['first_bucket'], client['last_sample']
            expected = max(0, (bucket - start) // BUCKET_SECONDS)
            quota = {
                'used_bytes': used, 'remaining_bytes': max(0, limit - used) if limit else None,
                'limit_bytes': limit, 'upload_bytes': upload, 'download_bytes': download,
                'billing_mode': mode, 'reset_day': client['reset_day'],
                'period_start': iso_time(start), 'period_end': iso_time(end),
                'usage_percent': used / limit * 100 if limit else 0,
                'history_partial': first is None or first > start,
                'coverage_start': iso_time(first) if first is not None else None,
                'sample_at': iso_time(latest) if latest is not None else None,
                'calibrated': adjustment is not None, 'calibration': adjustment,
                'coverage_ratio': min(1, actual_buckets / expected) if expected else 1,
            }
            model.nodes[uuid] = {'uuid': uuid, 'name': client['name'], 'quota': quota, 'history': history}
        return model

    @staticmethod
    def _visible(model, visible_ids):
        return (node for uuid, node in model.nodes.items() if visible_ids is None or uuid in visible_ids)

    @staticmethod
    def _copy_quota(node):
        quota = node['quota'].copy()
        if quota['calibration'] is not None:
            quota['calibration'] = quota['calibration'].copy()
        return quota

    def snapshot(self, visible_ids=None, now=None):
        now = time.time() if now is None else now
        model = self._read_at(now)
        nodes = {node['uuid']: self._copy_quota(node) for node in self._visible(model, visible_ids)}
        return {'server_time': iso_time(now), 'timezone': 'Asia/Shanghai',
                'last_sync': model.last_sync, 'nodes': nodes}

    def forecast_input(self, visible_ids=None, now=None):
        """Return cycle totals and history from the same committed ledger snapshot."""
        now = time.time() if now is None else now
        model = self._read_at(now)
        nodes = [{
            **node, 'quota': self._copy_quota(node), 'history': [day.copy() for day in node['history']],
        } for node in self._visible(model, visible_ids)]
        return {'ok': True, 'source': 'persistent-ledger', 'generated_at': iso_time(now),
                'last_sync': model.last_sync, 'nodes': nodes}
