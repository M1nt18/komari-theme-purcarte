import importlib.util
import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch


script = Path(__file__).resolve().parents[1] / 'release' / 'backup.py'
spec = importlib.util.spec_from_file_location('komari_backup', script)
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.backups = self.root / 'backups'
        self.sources = {}
        for filename, table in [('core.sqlite', 'clients'), ('ledger.sqlite', 'buckets'),
                                ('unlock.sqlite', 'workers')]:
            source = self.root / filename
            with closing(sqlite3.connect(source)) as db:
                db.execute(f'CREATE TABLE {table}(id INTEGER)')
            self.sources[filename] = source
        for scope in (patch.object(backup, 'ROOT', self.backups),
                      patch.object(backup, 'SOURCES', self.sources),
                      patch.dict(os.environ, {'KOMARI_METRICS_DB': '', 'KOMARI_BACKUP_CONFIG': ''})):
            scope.start()
            self.addCleanup(scope.stop)
        self.addCleanup(os.umask, os.umask(0o077))

    def test_legacy_three_database_backup_and_restore(self):
        folder = backup.backup()
        manifest = json.loads((folder / 'manifest.json').read_text())
        self.assertEqual(set(manifest), set(self.sources))
        backup.restore_check(folder)

    def test_configured_metrics_includes_uncheckpointed_rows_and_checks_digest(self):
        metrics = self.root / 'active metrics.db'
        os.environ['KOMARI_METRICS_DB'] = str(metrics)
        with closing(sqlite3.connect(metrics)) as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA wal_autocheckpoint=0')
            db.executescript('CREATE TABLE metric_series(id INTEGER); CREATE TABLE metric_rollups(value INTEGER);')
            db.execute('INSERT INTO metric_rollups VALUES(7)')
            db.commit()
            folder = backup.backup()
            db.execute('INSERT INTO metric_rollups VALUES(9)')
            db.commit()
            manifest = json.loads((folder / 'manifest.json').read_text())
            self.assertEqual(manifest['metrics.db']['counts'], {'metric_series': 0, 'metric_rollups': 1})
            backup.restore_check(folder)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM metric_rollups').fetchone()[0], 2)
        with (folder / 'metrics.db').open('ab') as stream:
            stream.write(b'corrupt')
        with self.assertRaisesRegex(RuntimeError, 'Digest mismatch: metrics.db'):
            backup.restore_check(folder)

    def test_misconfigured_metrics_fails_without_publishing_partial_backup(self):
        for path in (self.root / 'missing.db', self.sources['core.sqlite']):
            with self.subTest(path=path.name):
                os.environ['KOMARI_METRICS_DB'] = str(path)
                with self.assertRaises((sqlite3.OperationalError, RuntimeError)):
                    backup.backup()
                self.assertEqual(list(self.backups.iterdir()), [])
