#!/usr/bin/env python3
"""View or edit one Komari node's custom monthly reset day and calibration."""

import argparse
from contextlib import closing
import json
import math
from pathlib import Path
import sqlite3
import sys


def reset_day(value):
    day = int(value)
    if not 1 <= day <= 31:
        raise argparse.ArgumentTypeError("reset day must be between 1 and 31")
    return day


def baseline_gib(value):
    amount = float(value)
    if not math.isfinite(amount) or not 0 <= amount < 2**33:
        raise argparse.ArgumentTypeError("enter a nonnegative GiB amount fitting a signed 64-bit byte count")
    return amount


def read_node(db, uuid):
    rows = db.execute("""
        SELECT uuid, name, traffic_reset_day, traffic_baseline_usage
        FROM clients WHERE uuid = ? COLLATE BINARY LIMIT 2
    """, (uuid,)).fetchall()
    if len(rows) != 1:
        raise ValueError("expected exactly one node matching --uuid")
    return dict(rows[0])


def main():
    parser = argparse.ArgumentParser(description=__doc__, epilog=(
        "With only --source and --uuid, open the database read-only. "
        "After the ledger has synced this node at least once, a changed baseline sets its "
        "current-cycle used traffic at the next sync. Identical values do not reapply it. "
        "Changes superseded before the next sync may never reach the ledger."
    ))
    parser.add_argument("--source", required=True, type=Path, help="existing Komari core SQLite file")
    parser.add_argument("--uuid", required=True, help="exact node UUID")
    parser.add_argument("--reset-day", type=reset_day, metavar="DAY", help="monthly reset day (1-31)")
    baseline = parser.add_mutually_exclusive_group()
    baseline.add_argument("--baseline-gib", type=baseline_gib, metavar="GIB",
                          help="current-cycle total used, in GiB (1 GiB = 2^30 bytes)")
    baseline.add_argument("--clear-baseline", action="store_true",
                          help="clear the calibration and use recorded traffic")
    args = parser.parse_args()
    updates = {}
    if args.reset_day is not None:
        updates["traffic_reset_day"] = args.reset_day
    if args.clear_baseline or args.baseline_gib is not None:
        updates["traffic_baseline_usage"] = args.baseline_gib
    mode = "rw" if updates else "ro"
    uri = args.source.resolve().as_uri() + "?mode=" + mode
    with closing(sqlite3.connect(uri, uri=True, timeout=10)) as db, db:
        db.row_factory = sqlite3.Row
        if updates:
            db.execute("BEGIN IMMEDIATE")
        before = read_node(db, args.uuid)
        changed = {key: value for key, value in updates.items() if before[key] != value}
        if changed:
            # Column names come exclusively from the two fixed CLI options above.
            assignments = ", ".join(key + " = ?" for key in changed)
            db.execute(f"UPDATE clients SET {assignments} WHERE uuid = ? COLLATE BINARY",
                       (*changed.values(), args.uuid))
            after = read_node(db, args.uuid)
            if any(after[key] != value for key, value in changed.items()):
                raise ValueError("requested changes were not applied")
        else:
            after = before
    result = {"node": after, "baseline_unit": "GiB"}
    if updates:
        result["changed"] = {key: {"from": before[key], "to": after[key]} for key in changed}
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except (OSError, sqlite3.Error, ValueError) as error:
        sys.exit(str(error))
