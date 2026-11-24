from contextlib import closing
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

from ledger import TrafficLedger, timestamp


CLI = Path(__file__).resolve().parents[2] / "tools" / "manage_billing.py"


class BillingCliTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.source = Path(temp.name) / "core #1.db"
        with closing(sqlite3.connect(self.source)) as db, db:
            db.executescript("""
                CREATE TABLE clients(uuid TEXT PRIMARY KEY COLLATE NOCASE, name TEXT,
                    traffic_limit INTEGER, traffic_limit_type TEXT, traffic_reset_day INTEGER,
                    traffic_baseline_usage REAL, token TEXT);
                INSERT INTO clients VALUES('first','Node A',1048576,'sum',15,NULL,'private-test-value');
                INSERT INTO clients VALUES('other','Node B',9000,'down',5,3,'private-test-value');
                CREATE TABLE records(client TEXT,time TEXT,traffic_up INTEGER,traffic_down INTEGER);
                CREATE TABLE records_long_term(client TEXT,time TEXT,traffic_up INTEGER,traffic_down INTEGER);
            """)

    def invoke(self, *options, uuid="first", success=True, source=None):
        call = subprocess.run(
            [sys.executable, "-B", str(CLI), "--source", str(source or self.source), "--uuid", uuid, *options],
            capture_output=True, text=True, encoding="utf-8",
        )
        self.assertNotIn("private-test-value", call.stdout + call.stderr)
        if success:
            self.assertEqual(call.returncode, 0, call.stderr)
            return json.loads(call.stdout)
        self.assertNotEqual(call.returncode, 0)
        self.assertFalse(call.stdout)

    def test_read_only_and_exact_match(self):
        original = self.source.read_bytes()
        self.assertEqual(self.invoke()["node"], {"uuid": "first", "name": "Node A",
                         "traffic_reset_day": 15, "traffic_baseline_usage": None})
        for unknown in ["FIRST", "first' OR 1=1 --"]:
            self.invoke("--reset-day", "2", uuid=unknown, success=False)
        self.assertEqual(self.source.read_bytes(), original)
        absent = self.source.parent / "absent.db"
        self.invoke(source=absent, success=False)
        self.invoke("--baseline-gib", "1", source=absent, success=False)
        self.assertFalse(absent.exists())

    def test_edits_follow_ledger_calibration_semantics(self):
        ledger = TrafficLedger(self.source, self.source.parent / "ledger.db")
        now = timestamp("2026-11-24T02:00:00Z")
        ledger.sync(now)
        other = self.invoke(uuid="other")
        changes = self.invoke("--reset-day", "13", "--baseline-gib", "1.25")["changed"]
        self.assertEqual(changes["traffic_reset_day"], {"from": 15, "to": 13})
        self.assertEqual(changes["traffic_baseline_usage"], {"from": None, "to": 1.25})
        self.assertEqual(self.invoke("--baseline-gib", "1.25")["changed"], {})
        ledger.sync(now + 15)
        quota = ledger.snapshot(now=now + 15)["nodes"]["first"]
        self.assertEqual((quota["reset_day"], quota["used_bytes"]), (13, 1342177280))
        self.invoke("--clear-baseline")
        ledger.sync(now + 30)
        self.assertFalse(ledger.snapshot(now=now + 30)["nodes"]["first"]["calibrated"])
        self.assertEqual(self.invoke(uuid="other"), other)

    def test_invalid_values_and_aborted_update_leave_both_fields_intact(self):
        before = self.invoke()
        for option, value in [("--reset-day", "32"), ("--reset-day", "0"),
                              ("--baseline-gib", "nan"), ("--baseline-gib", "-1"),
                              ("--baseline-gib", str(2**33))]:
            self.invoke(option, value, success=False)
        with closing(sqlite3.connect(self.source)) as db, db:
            db.execute("""CREATE TRIGGER reject_change AFTER UPDATE ON clients
                          BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END""")
        self.invoke("--reset-day", "1", "--baseline-gib", "0", success=False)
        self.assertEqual(self.invoke(), before)
