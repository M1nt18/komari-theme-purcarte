import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
from ledger import TrafficLedger, billable, cycle_bounds, timestamp, sql_time


@contextmanager
def source_db(path):
    db = sqlite3.connect(path)
    try:
        with db:
            yield db
    finally:
        db.close()


class LedgerTests(unittest.TestCase):
    def native_source(self):
        with source_db(self.source) as db:
            db.executescript('DROP TABLE records; DROP TABLE records_long_term;')
        self.metrics = self.root / 'metrics.db'
        with source_db(self.metrics) as db:
            db.executescript("""
                CREATE TABLE metric_series(id INTEGER PRIMARY KEY, metric_name TEXT, entity_id TEXT, tags TEXT);
                CREATE TABLE metric_resolutions(id INTEGER PRIMARY KEY,resolution_milli INTEGER);
                CREATE TABLE metric_label_sets(id INTEGER PRIMARY KEY,labels TEXT);
                CREATE TABLE metric_rollups(
                    series_id INTEGER,resolution_id INTEGER,label_id INTEGER,bucket_milli INTEGER,
                    count INTEGER,sum REAL,first_val REAL,first_ts_milli INTEGER,last_ts_milli INTEGER,
                    PRIMARY KEY(series_id,resolution_id,label_id,bucket_milli)
                );
                INSERT INTO metric_label_sets VALUES(1,'{}');
            """)
            db.executemany("INSERT INTO metric_series VALUES(?,?,'a','{}')",
                           enumerate(('traffic.up','traffic.down','net.total.up','net.total.down'), 1))
            db.executemany('INSERT INTO metric_resolutions VALUES(?,?)', [(w, w * 1000) for w in (60,300,3600,86400)])

    def native_point(self, width, time, values, count=1, first=None, last=None, first_values=None):
        time = int(time)
        bucket = time // width * width
        first = time if first is None else first
        last = time if last is None else last
        with source_db(self.metrics) as db:
            for ident, value in enumerate(values, 1):
                db.execute('INSERT OR REPLACE INTO metric_rollups VALUES(?,?,?,?,?,?,?,?,?)', (
                    ident, width, 1, bucket * 1000, count, value,
                    value if first_values is None else first_values[ident-1], first * 1000, last * 1000,
                ))

    def test_native_cutover_keeps_corrected_legacy_quarter_and_bridges_first_report_once(self):
        self.sample('2026-11-14 04:04:00', 3000, 5000, raw=(1000,2000))
        self.ledger.sync(self.now)
        with self.ledger.connect() as db:
            db.execute("INSERT INTO bucket_corrections VALUES('a',?,100,200,'verified legacy')",
                       (self.now // 900 * 900,))
        self.native_source()
        # P95 representative copied into native minute and coarser tiers.
        hour = self.now // 3600 * 3600
        for width in (60,300,3600):
            self.native_point(width, hour, [60000,55000])
        self.native_point(60, self.now + 2, [3,905,2030,4040], count=2, last=self.now + 5,
                          first_values=[0,900,1010,2015])
        self.ledger = TrafficLedger(self.source, self.state, metrics_start=self.now)
        self.ledger.sync(self.now + 10)
        self.assertEqual((self.node()['upload_bytes'], self.node()['download_bytes']), (113,220))
        with self.ledger.connect() as db:
            self.assertEqual(tuple(db.execute('SELECT upload,download FROM bucket_corrections').fetchone()),(100,200))
        self.ledger = TrafficLedger(self.source,self.state)  # stored boundary survives a restart
        self.native_point(300, self.now + 2, [3,905], count=2,last=self.now+5)
        self.ledger.sync(self.now + 600)
        self.assertEqual(self.node()['used_bytes'],333)
        with source_db(self.source) as core:
            core.execute('ALTER TABLE clients DROP COLUMN traffic_reset_day')
            core.execute('ALTER TABLE clients DROP COLUMN traffic_baseline_usage')
        self.ledger.sync(self.now + 615)
        self.assertEqual(self.node()['reset_day'],13)
        self.assertEqual(self.node()['used_bytes'],333)
        self.assertEqual(sum(day['samples'] for day in self.ledger.forecast_input(now=self.now)['nodes'][0]['history']), 1)

    def test_native_overlapping_resolutions_backfill_partial_retention_across_reset(self):
        self.native_source()
        start = int(timestamp('2026-11-12T15:00:00Z'))
        self.ledger = TrafficLedger(self.source,self.state,metrics_start=start)
        for at, up, down in [(start+2,2,4),(start+62,3,4),(start+902,7,9),(start+3602,17,18)]:
            self.native_point(60,at,[up,down])
        # The parent includes an additional minute removed by retention.
        self.native_point(300,start+2,[10,12],count=3,last=start+122)
        self.native_point(3600,start+2,[37,40],count=5,last=start+2102)
        self.ledger.sync(start+4000)
        forecast=self.ledger.forecast_input(now=start+4000)['nodes'][0]
        self.assertEqual(forecast['quota']['used_bytes'],35)
        self.assertEqual([(x['out_bytes'],x['in_bytes']) for x in forecast['history']],[(37,40),(17,18)])
        with source_db(self.metrics) as db:
            db.execute('DELETE FROM metric_rollups WHERE bucket_milli<? AND resolution_id IN (60,300)',((start+3600)*1000,))
        self.ledger = TrafficLedger(self.source,self.state)
        self.ledger.sync(start+4100)
        self.assertEqual(forecast, self.ledger.forecast_input(now=start+4100)['nodes'][0])

    def test_native_wrong_or_missing_boundary_and_incomplete_pair_roll_back(self):
        self.sample('2026-11-14 04:04:00',10,20)
        self.ledger.sync(self.now)
        self.native_source()
        with self.assertRaisesRegex(ValueError,'KOMARI_METRICS_START'):
            self.ledger.sync(self.now + 15)
        for start in [self.now-120,self.now+1]:
            with self.assertRaises(ValueError):
                TrafficLedger(self.source,self.state,metrics_start=start).sync(self.now+20)
        self.ledger=TrafficLedger(self.source,self.state,metrics_start=self.now)
        self.native_point(60,self.now+5,[123])
        with self.assertRaisesRegex(ValueError,'Incomplete'):
            self.ledger.sync(self.now+20)
        with self.ledger.connect() as db:
            self.assertIsNone(db.execute("SELECT value FROM meta WHERE key='metrics_start'").fetchone())
        self.assertEqual(self.node()['used_bytes'],30)
        self.native_point(60,self.now+5,[123,321])
        self.ledger.sync(self.now+20)
        with self.assertRaisesRegex(ValueError,'differs'):
            TrafficLedger(self.source,self.state,metrics_start=self.now-60).sync(self.now+20)

    def test_uncaptured_utc_daily_only_traffic_is_not_assigned_to_wrong_billing_date(self):
        self.native_source()
        start=int(timestamp('2026-11-01T00:00:00Z'))
        self.ledger=TrafficLedger(self.source,self.state,metrics_start=start)
        self.native_point(86400,start+1,[10000,20000],count=100,last=start+86399)
        with self.assertRaisesRegex(ValueError,'daily traffic'):
            self.ledger.sync(start+3*86400)

    def test_requests_share_precomputed_data_but_filter_nodes_and_isolate_outputs(self):
        with source_db(self.source) as db:
            db.execute("INSERT INTO clients VALUES('b','private',0,'sum',1,NULL)")
        self.sample('2026-11-14 04:01:00', 10, 20)
        self.ledger.sync(self.now)
        # No reader should open SQLite again within the current sync and time window.
        with patch.object(self.ledger, 'connect', side_effect=AssertionError('unexpected read')):
            def read(uuid):
                visible = {uuid}
                forecast = self.ledger.forecast_input(visible, self.now + 5)
                self.assertEqual([node['uuid'] for node in forecast['nodes']], [uuid])
                node = forecast['nodes'][0]
                node['quota']['used_bytes'] = -1
                if node['history']:
                    node['history'][0]['samples'] = -1
                snapshot = self.ledger.snapshot(visible, self.now + 6)
                self.assertEqual(set(snapshot['nodes']), visible)
                return snapshot['nodes'][uuid]['used_bytes']
            with ThreadPoolExecutor(max_workers=8) as workers:
                self.assertEqual(list(workers.map(read, ['b', 'a'] * 12)), [0, 30] * 12)
            self.assertEqual(self.ledger.forecast_input({'a'}, self.now)['nodes'][0]['history'][0]['samples'], 1)
        with source_db(self.source) as db:
            db.execute("DELETE FROM clients WHERE uuid='b'")
        self.ledger.sync(self.now + 15)
        self.assertEqual(self.ledger.forecast_input({'b'}, self.now + 15)['nodes'], [])

    def test_failed_sync_retains_last_commit_and_rolls_over_without_new_samples(self):
        before_reset = timestamp('2026-11-12T15:59:59Z')
        self.sample('2026-11-12 15:58:00', 10, 20)
        self.ledger.sync(before_reset)
        old = self.ledger.snapshot({'a'}, before_reset)
        self.assertEqual(old['nodes']['a']['used_bytes'], 30)
        self.sample('2026-11-12 15:59:00', -1, 10)
        with self.assertRaises(ValueError):
            self.ledger.sync(before_reset + 1)
        forecast = self.ledger.forecast_input({'a'}, before_reset + 1)
        self.assertEqual(forecast['last_sync'], old['last_sync'])
        self.assertEqual(forecast['nodes'][0]['quota']['used_bytes'], 0)
        day = forecast['nodes'][0]['history'][0]
        self.assertFalse(day['is_today'])
        self.assertEqual(day['out_bytes'] + day['in_bytes'], 30)

    def test_existing_view_migrates_preserving_manual_and_counter_corrections(self):
        self.sample('2026-11-14 03:01:00', 100, 100)
        self.sample('2026-11-14 03:16:00', 100, 100)
        self.ledger.sync(self.now)
        bucket = timestamp('2026-11-14T03:00:00Z')
        with self.ledger.connect() as db:
            db.executescript("""
                DROP VIEW verified_buckets;
                CREATE VIEW verified_buckets AS SELECT uuid,bucket,upload,download FROM buckets;
            """)
            db.executemany('INSERT INTO counter_overcounts VALUES(?,?,?,?,?)', [
                ('a', bucket, 's1', 70, 20), ('a', bucket, 's2', 80, 30),
                ('a', bucket + 900, 's3', 50, 50),
            ])
            db.execute('INSERT INTO bucket_corrections VALUES(?,?,?,?,?)',
                       ('a', bucket + 900, 10, 20, 'manual audit'))
        self.ledger = TrafficLedger(self.source, self.state)
        self.assertEqual(self.node()['upload_bytes'], 10)
        self.assertEqual(self.node()['download_bytes'], 70)

    def test_standard_clients_without_custom_billing_columns_use_calendar_month(self):
        with source_db(self.source) as db:
            db.execute('ALTER TABLE clients DROP COLUMN traffic_reset_day')
            db.execute('ALTER TABLE clients DROP COLUMN traffic_baseline_usage')
        self.sample('2026-11-14 01:00:00',10,20)
        self.ledger.sync(self.now)
        self.assertEqual(self.node()['used_bytes'],30)
        self.assertEqual(self.node()['reset_day'],1)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'core.sqlite'
        self.state = self.root / 'ledger.sqlite'
        self.now = timestamp('2026-11-14T04:05:00Z')
        with source_db(self.source) as db:
            db.executescript('''
                CREATE TABLE clients(uuid TEXT,name TEXT,traffic_limit INTEGER,
                  traffic_limit_type TEXT,traffic_reset_day INTEGER,traffic_baseline_usage REAL);
                CREATE TABLE records(client TEXT,time TEXT,traffic_up INTEGER,traffic_down INTEGER,
                  net_total_up INTEGER,net_total_down INTEGER);
                CREATE TABLE records_long_term(client TEXT,time TEXT,traffic_up INTEGER,traffic_down INTEGER);
                INSERT INTO clients VALUES('a','test',107374182400,'sum',13,36.1);
            ''')
        self.ledger = TrafficLedger(self.source, self.state)

    def tearDown(self):
        self.temp.cleanup()

    def sample(self, when, up, down, coarse=False, raw=(0, 0)):
        with source_db(self.source) as db:
            if coarse:
                db.execute('INSERT INTO records_long_term VALUES(?,?,?,?)', ('a', when, up, down))
            else:
                db.execute('INSERT INTO records VALUES(?,?,?,?,?,?)', ('a', when, up, down, *raw))

    def node(self, now=None):
        return self.ledger.snapshot(now=self.now if now is None else now)['nodes']['a']

    def test_reboot_duplicates_overlap_and_restart(self):
        for _ in range(3):
            self.sample('2026-11-13 00:00:00', 100, 200, coarse=True)
        self.sample('2026-11-13 00:01:00', 30, 40)
        self.sample('2026-11-14 04:01:00', 50, 60, raw=(100000, 200000))
        # Native interval delta contains traffic since reboot, even when raw counters fall.
        self.sample('2026-11-14 04:02:00', 7, 8, raw=(7, 8))
        self.sample('2026-11-14 04:02:00', 7, 8, raw=(7, 8))
        self.ledger.sync(self.now)
        self.assertEqual(self.node()['used_bytes'], 425)
        self.ledger = TrafficLedger(self.source, self.state)
        self.ledger.sync(self.now + 15)
        self.assertEqual(self.node()['used_bytes'], 425)
        # Once core retention removes old rows the independent ledger retains them.
        with source_db(self.source) as db:
            db.execute('DELETE FROM records_long_term')
        self.ledger.sync(self.now + 30)
        self.assertEqual(self.node()['used_bytes'], 425)

    def test_fine_bucket_replaced_by_coarse_without_double_count(self):
        self.sample('2026-11-14 03:01:00', 20, 30)
        self.ledger.sync(self.now)
        self.sample('2026-11-14 03:00:00', 80, 90, coarse=True)
        self.ledger.sync(self.now + 15)
        self.assertEqual(self.node()['used_bytes'], 170)

    def test_modes_use_period_totals(self):
        self.sample('2026-11-14 01:01:00', 100, 5)
        self.sample('2026-11-14 02:01:00', 5, 100)
        for mode, expected in [('sum', 210), ('max', 105), ('min', 105), ('up', 105), ('down', 105)]:
            with source_db(self.source) as db:
                db.execute('UPDATE clients SET traffic_limit_type=?', (mode,))
            self.ledger.sync(self.now)
            self.assertEqual(self.node()['used_bytes'], expected)

    def test_lifetime_counter_replay_is_corrected_and_normal_traffic_is_kept(self):
        gib = 2 ** 30
        start = 429 * gib
        self.sample('2026-11-14 03:59:00', 100, 200, raw=(start, start))
        # The cached report may contain the lifetime total plus a small delta.
        self.sample('2026-11-14 04:01:00', start + 2_000_000, start + 1_020_000,
                    raw=(start + 1_000_000, start + 1_000_000))
        self.sample('2026-11-14 04:02:00', gib, 300, raw=(start + 1_000_000 + gib, start + 1_000_300))
        self.sample('2026-11-14 04:03:00', 300, 400, raw=(300, 400))
        self.ledger.sync(self.now)
        expected = gib + 2_001_300
        self.assertEqual(self.node()['used_bytes'], expected)

        self.sample('2026-11-14 04:00:00', start + 2_000_000 + gib + 300,
                    start + 1_020_000 + 700, coarse=True)
        self.ledger = TrafficLedger(self.source, self.state)
        later = self.now + 1800
        self.ledger.sync(later)
        node = self.ledger.forecast_input({'a'}, later)['nodes'][0]
        self.assertEqual(node['quota']['used_bytes'], expected)
        self.assertEqual(node['history'][0]['out_bytes'] + node['history'][0]['in_bytes'], expected)
        with self.ledger.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM counter_overcounts').fetchone()[0], 1)

    def test_verified_bucket_correction_survives_reaggregation(self):
        self.sample('2026-11-14 03:01:00', 5000, 7000)
        self.sample('2026-11-14 04:01:00', 15, 25)
        self.ledger.sync(self.now)
        bucket = timestamp('2026-11-14T03:00:00Z')
        with self.ledger.connect() as db:
            db.execute('INSERT INTO bucket_corrections VALUES(?,?,?,?,?)',
                       ('a', bucket, 10, 20, 'verified counter error'))
        self.assertEqual(self.node()['used_bytes'], 70)

        self.sample('2026-11-14 03:00:00', 5000, 7000, coarse=True)
        self.ledger = TrafficLedger(self.source, self.state)
        self.ledger.sync(self.now + 15)
        node = self.ledger.forecast_input({'a'}, self.now + 15)['nodes'][0]
        self.assertEqual(node['quota']['used_bytes'], 70)
        self.assertEqual(node['history'][0]['out_bytes'], 25)
        self.assertEqual(node['history'][0]['in_bytes'], 45)
        self.assertEqual(node['history'][0]['samples'], 2)
        with self.ledger.connect() as db:
            original = db.execute('SELECT upload,download,source FROM buckets WHERE uuid=? AND bucket=?',
                                  ('a', bucket)).fetchone()
        self.assertEqual(tuple(original), (5000, 7000, 'coarse'))

    def test_reset_without_new_samples_and_legacy_baseline_ignored(self):
        self.sample('2026-11-12 15:59:00', 999, 999)
        self.sample('2026-11-12 16:00:00', 10, 20)
        self.ledger.sync(self.now)
        self.assertEqual(self.node()['used_bytes'], 30)
        self.assertEqual(self.node()['period_start'], '2026-11-12T16:00:00Z')
        self.assertFalse(self.node()['history_partial'])
        self.assertEqual(self.node(timestamp('2026-12-12T16:00:00Z'))['used_bytes'], 0)

    def test_new_manual_calibration_expires_at_boundary(self):
        self.sample('2026-11-14 01:00:00', 10, 20)
        self.ledger.sync(self.now)
        with source_db(self.source) as db:
            db.execute('UPDATE clients SET traffic_baseline_usage=1')
        self.ledger.sync(self.now + 15)
        self.sample('2026-11-14 04:04:00', 5, 6)
        self.ledger.sync(self.now + 30)
        self.assertEqual(self.node()['used_bytes'], 1024 ** 3 + 11)
        self.assertTrue(self.node()['calibrated'])
        next_cycle = self.node(timestamp('2026-12-12T16:00:00Z'))
        self.assertEqual(next_cycle['used_bytes'], 0)
        self.assertFalse(next_cycle['calibrated'])

    def test_dashboard_billing_persists_and_calibration_expires(self):
        self.sample('2026-11-14 01:00:00', 10, 20)
        self.ledger.sync(self.now)
        before = self.ledger.billing_settings('a', now=self.now)
        self.assertIsNone(before['calibrated_gib'])
        edit = {'period_start': before['period_start'], 'reset_day': 14, 'used_gib': 1}
        saved = self.ledger.billing_settings('a', edit, self.now)
        self.assertEqual(saved['reset_day'], 14)
        self.assertEqual(self.node()['used_bytes'], 1024 ** 3)
        self.sample('2026-11-14 04:04:00', 5, 6)
        self.ledger = TrafficLedger(self.source, self.state)
        self.ledger.sync(self.now + 30)
        self.assertEqual(self.node()['used_bytes'], 1024 ** 3 + 11)
        self.assertEqual(self.node()['reset_day'], 14)
        rollover = timestamp('2026-12-13T16:00:00Z')
        self.assertIsNone(self.ledger.billing_settings('a', now=rollover)['calibrated_gib'])
        with self.assertRaisesRegex(ValueError, '账期已变化'):
            self.ledger.billing_settings('a', {'period_start': saved['period_start'], 'used_gib': 1}, rollover)
        with source_db(self.source) as db:
            db.execute('UPDATE clients SET traffic_reset_day=15')
        self.ledger.sync(self.now + 45)
        self.assertEqual(self.node()['reset_day'], 15)

    def test_visibility_partial_history_and_no_core_mutation(self):
        before = self.source.read_bytes()
        self.sample('2026-11-14 01:00:00', 10, 20)
        before = self.source.read_bytes()
        self.ledger.sync(self.now)
        self.assertEqual(self.source.read_bytes(), before)
        self.assertTrue(self.node()['history_partial'])
        self.assertEqual(self.ledger.snapshot(set(), self.now)['nodes'], {})

    def test_recovery_after_multi_day_downtime(self):
        self.ledger.sync(self.now)
        self.sample('2026-11-15 01:00:00', 100, 200, coarse=True)
        self.ledger.sync(self.now + 4 * 86400)
        self.assertEqual(self.node(self.now + 4 * 86400)['used_bytes'], 300)

    def test_forecast_daily_history_uses_shanghai_midnight_and_visibility(self):
        self.sample('2026-11-13 15:45:00', 10, 20, coarse=True)
        self.sample('2026-11-13 16:00:00', 30, 40, coarse=True)
        self.sample('2026-11-14 04:01:00', 50, 60)
        self.ledger.sync(self.now)
        result = self.ledger.forecast_input({'a'}, self.now)
        node = result['nodes'][0]
        self.assertEqual(node['quota']['used_bytes'], 210)
        self.assertEqual([r['date'] for r in node['history']], ['2026-11-13', '2026-11-14'])
        self.assertEqual([r['out_bytes'] for r in node['history']], [10, 80])
        self.assertEqual([r['is_today'] for r in node['history']], [False, True])
        self.assertEqual(self.ledger.forecast_input(set(), self.now)['nodes'], [])

    def test_forecast_on_reset_day_includes_previous_week_but_quota_starts_fresh(self):
        previous = timestamp('2026-11-12T15:45:00Z')
        self.sample('2026-11-12 15:45:00', 100, 200, coarse=True)
        self.sample('2026-11-12 16:00:00', 30, 40, coarse=True)
        today = previous + 3600
        self.ledger.sync(today)
        node = self.ledger.forecast_input({'a'}, today)['nodes'][0]
        self.assertEqual(node['quota']['used_bytes'], 70)
        self.assertEqual([row['date'] for row in node['history']], ['2026-11-12', '2026-11-13'])
        self.assertEqual([row['out_bytes'] for row in node['history']], [100, 30])


class CalendarTests(unittest.TestCase):
    def test_month_end_leap_year_and_utc8(self):
        for current, day, start, end in [
            ('2024-02-29T00:00:00+08:00', 31, '2024-02-29T00:00:00+08:00', '2024-03-31T00:00:00+08:00'),
            ('2026-02-28T00:00:00+08:00', 31, '2026-02-28T00:00:00+08:00', '2026-03-31T00:00:00+08:00'),
            ('2026-01-01T00:00:00+08:00', 1, '2026-01-01T00:00:00+08:00', '2026-02-01T00:00:00+08:00'),
            ('2026-11-12T15:59:59Z', 13, '2026-10-13T00:00:00+08:00', '2026-11-13T00:00:00+08:00'),
        ]:
            self.assertEqual(cycle_bounds(timestamp(current), day), (timestamp(start), timestamp(end)))


if __name__ == '__main__':
    unittest.main()
