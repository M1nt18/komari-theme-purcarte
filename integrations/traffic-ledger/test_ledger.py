import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
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
