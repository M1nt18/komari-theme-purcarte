import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
from install_services import native_settings, read_setting, write_settings


class InstallerTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.core = self.root / 'core.db'
        self.metrics = self.root / 'metrics.db'
        self.state = self.root / 'state.db'
        self.start = 1795488600
        self.now = self.start + 77
        self.executes(self.core, '''
            CREATE TABLE clients(uuid, name, traffic_limit, traffic_limit_type, token);
            CREATE TABLE configs(key, value);
        ''')

    @staticmethod
    def executes(file, script):
        with closing(sqlite3.connect(file)) as connection:
            connection.executescript(script)

    def create_metrics(self):
        self.executes(self.metrics, '''
            CREATE TABLE metric_rollups(series_id, resolution_id, label_id, bucket_milli,
                                        first_ts_milli, last_ts_milli, count, sum, first_val);
            CREATE TABLE metric_resolutions(id, resolution_milli);
            CREATE TABLE metric_series(id, entity_id, metric_name, tags);
            CREATE TABLE metric_label_sets(id, labels);
        ''')

    def settings(self, start=None):
        return native_settings(self.core, self.state, self.metrics, start, self.now)

    def test_legacy_core_preflight_and_new_native_setup(self):
        self.executes(self.core, '''
            CREATE TABLE records(client, time, traffic_up, traffic_down);
            CREATE TABLE records_long_term(client, time, traffic_up, traffic_down);
        ''')
        self.assertEqual(self.settings(), {})
        self.executes(self.core, 'DROP TABLE records; DROP TABLE records_long_term;')
        self.create_metrics()
        self.assertEqual(self.settings(), {
            'KOMARI_METRICS_DB': str(self.metrics), 'KOMARI_METRICS_START': str(self.start + 60),
        })
        self.assertFalse(self.state.exists())

    def test_migrated_core_requires_cutover_and_keeps_existing_handover(self):
        self.create_metrics()
        self.executes(self.core, '''
            INSERT INTO configs VALUES('migration_legacy_monitoring_to_metric_store_done', 'true');
        ''')
        with self.assertRaisesRegex(RuntimeError, 'recorded cutover'):
            self.settings()
        self.assertEqual(self.settings(self.start)['KOMARI_METRICS_START'], str(self.start))
        self.executes(self.state, f'''
            CREATE TABLE meta(key, value);
            INSERT INTO meta VALUES('metrics_start', '{self.start}');
        ''')
        self.assertEqual(self.settings()['KOMARI_METRICS_START'], str(self.start))
        with self.assertRaisesRegex(ValueError, 'persisted ledger handover'):
            self.settings(self.start + 60)

    def test_reinstall_preserves_custom_settings(self):
        path = self.root / 'komari-custom.env'
        original = "# Site paths\nKOMARI_BACKUP_CONFIG='/path with space/nginx.conf'\n"
        path.write_text(original, encoding='utf-8')
        value = str(self.root / 'my metrics.db')
        update = {'KOMARI_METRICS_DB': value, 'KOMARI_METRICS_START': str(self.start)}
        write_settings(path, update)
        first = path.read_bytes()
        write_settings(path, update)
        self.assertEqual(path.read_bytes(), first)
        content = path.read_text(encoding='utf-8')
        self.assertTrue(content.startswith(original))
        self.assertEqual(read_setting(content, 'KOMARI_METRICS_DB'), value)
        self.assertEqual(read_setting(content, 'KOMARI_METRICS_START'), str(self.start))
