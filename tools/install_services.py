#!/usr/bin/env python3
"""Install the optional services from an extracted companion archive."""
import argparse
from contextlib import closing
import json
import os
import re
import shlex
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

ENV_FILE = Path('/etc/komari-custom.env')
STATE_FILE = Path('/var/lib/komari-traffic-ledger/ledger.sqlite')
ASSIGNMENT = re.compile(r'^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$')
CORE_COLUMNS = {'uuid', 'name', 'traffic_limit', 'traffic_limit_type', 'token'}
LEGACY_COLUMNS = {'client', 'time', 'traffic_up', 'traffic_down'}
METRIC_COLUMNS = {
    'metric_rollups': {'series_id', 'resolution_id', 'label_id', 'bucket_milli',
                       'first_ts_milli', 'last_ts_milli', 'count', 'sum', 'first_val'},
    'metric_resolutions': {'id', 'resolution_milli'},
    'metric_series': {'id', 'entity_id', 'metric_name', 'tags'},
    'metric_label_sets': {'id', 'labels'},
}


def columns(db, table):
    return {row[1] for row in db.execute('PRAGMA table_info(' + table + ')')}


def require_columns(db, table, required):
    missing = required - columns(db, table)
    if missing:
        raise RuntimeError('Unsupported Komari data schema: ' + table + ' missing ' + ', '.join(sorted(missing)))


def read_setting(content, key):
    for line in reversed(content.splitlines()):
        match = ASSIGNMENT.match(line)
        if match and match[1] == key:
            values = shlex.split(match[2])
            return values[0] if len(values) == 1 else match[2].strip()
    return ''


def write_settings(path, updates):
    original = path.read_text(encoding='utf-8') if path.exists() else ''
    # Append the managed values so earlier settings, including their quoting
    # and comments, retain the EnvironmentFile syntax expected by systemd.
    # Remove our previous managed block to keep repeated installs idempotent.
    marker = '# Managed by the PurCarte service installer'
    lines = original.splitlines()
    size = len(lines)
    for index, line in enumerate(lines):
        if line == marker and all(ASSIGNMENT.match(tail) and ASSIGNMENT.match(tail)[1] in updates
                                  for tail in lines[index + 1:]):
            size = index - 1 if index and not lines[index - 1] else index
            break
    result = lines[:size] + ['', marker]
    for key, value in updates.items():
        if any(char in value for char in '\r\n\x00'):
            raise ValueError('Invalid line break or NUL in ' + key)
        quoted = value.replace('\\', '\\\\').replace('"', '\\"')
        result.append(key + '="' + quoted + '"')
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as output:
            output.write('\n'.join(result) + '\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp, path)
    finally:
        Path(temp).unlink(missing_ok=True)


def native_settings(source, state, metrics, configured_start, now):
    with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as db:
        require_columns(db, 'clients', CORE_COLUMNS)
        legacy = [table for table in ('records', 'records_long_term') if columns(db, table)]
        if legacy:
            for table in ('records', 'records_long_term'):
                require_columns(db, table, LEGACY_COLUMNS)
        else:
            migrated = db.execute("SELECT 1 FROM configs WHERE key='migration_legacy_monitoring_to_metric_store_done'"
                                  " AND value='true'").fetchone()

    persisted = None
    has_history = False
    if state.is_file():
        with closing(sqlite3.connect(state.as_uri() + '?mode=ro', uri=True)) as db:
            if columns(db, 'meta'):
                row = db.execute("SELECT value FROM meta WHERE key='metrics_start'").fetchone()
                if row:
                    persisted = int(row[0])
            if columns(db, 'buckets'):
                has_history = db.execute('SELECT 1 FROM buckets LIMIT 1').fetchone() is not None

    if legacy:
        if persisted is not None:
            raise RuntimeError('The ledger already uses native metrics. Restore its matching legacy state before reverting the core.')
        return {}
    if not metrics.is_file():
        raise RuntimeError('Native metrics database is missing. Supply --metrics-db for a custom SQLite path.')
    with closing(sqlite3.connect(metrics.as_uri() + '?mode=ro', uri=True)) as db:
        for table, required in METRIC_COLUMNS.items():
            require_columns(db, table, required)

    start = persisted if configured_start in (None, '') else int(configured_start)
    if start is None:
        if migrated or has_history:
            raise RuntimeError('A migrated core or existing ledger requires the recorded cutover minute via --metrics-start or KOMARI_METRICS_START.')
        start = int(now) // 60 * 60
    if start <= 0 or start % 60 or start > now:
        raise ValueError('--metrics-start must be a UTC Unix second at the start of a minute, at or before now')
    if persisted is not None and persisted != start:
        raise ValueError('--metrics-start differs from the persisted ledger handover')
    if persisted is None and has_history:
        with closing(sqlite3.connect(state.as_uri() + '?mode=ro', uri=True)) as db:
            overlap = db.execute("SELECT 1 FROM buckets WHERE sample_at>? OR (sample_at=? AND source='fine') LIMIT 1",
                                 (start, start)).fetchone()
        if overlap:
            raise ValueError('--metrics-start overlaps imported legacy traffic')
    return {'KOMARI_METRICS_DB': str(metrics), 'KOMARI_METRICS_START': str(start)}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True,help='Existing Komari SQLite database')
    parser.add_argument('--origin',required=True,help='Public HTTPS origin, for example https://monitor.example.com')
    parser.add_argument('--core',default='http://127.0.0.1:25774')
    parser.add_argument('--metrics-db', type=Path, help='Native metrics SQLite path, defaults to metrics.db next to --source')
    parser.add_argument('--metrics-start', type=int, help='Recorded native reporting cutover as a UTC Unix second at a minute boundary')
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args();source=Path(args.source).resolve()
    url=urllib.parse.urlsplit(args.origin)
    if url.scheme!='https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('','/'):
        raise RuntimeError('--origin must be a public HTTPS origin without a path')
    root=Path(__file__).resolve().parent
    existing = ENV_FILE.read_text(encoding='utf-8') if ENV_FILE.exists() else ''
    metrics = args.metrics_db or read_setting(existing, 'KOMARI_METRICS_DB') or source.with_name('metrics.db')
    start = args.metrics_start if args.metrics_start is not None else read_setting(existing, 'KOMARI_METRICS_START')
    updates = {
        'KOMARI_SOURCE': str(source), 'KOMARI_PUBLIC_ORIGIN': args.origin.rstrip('/'), 'KOMARI_CORE': args.core,
        **native_settings(source, STATE_FILE, Path(metrics).resolve(), start, time.time()),
    }
    if args.check:print('Source database and service origin verified; no files changed');return
    if sys.platform!='linux' or os.geteuid()!=0:raise RuntimeError('Installation requires root on a systemd Linux host')
    if not Path('/run/systemd/system').exists():raise RuntimeError('This server installer requires systemd')
    paths={'server':Path('/opt/komari-traffic-ledger'),'unlock':Path('/opt/komari-unlock-release'),'backup':Path('/opt/komari-maintenance')}
    for kind,destination in paths.items():
        destination.mkdir(parents=True,exist_ok=True)
        for file in (root/kind).iterdir():
            if file.is_file():shutil.copy2(file,destination/file.name)
    write_settings(ENV_FILE, updates)
    for name in ['komari-traffic-ledger.service','komari-custom-backup.service','komari-custom-backup.timer']:
        shutil.copy2(root/'systemd'/name,Path('/etc/systemd/system')/name)
    subprocess.run(['systemctl','daemon-reload'],check=True)
    subprocess.run(['systemctl','enable','--now','komari-traffic-ledger.service','komari-custom-backup.timer'],check=True)
    subprocess.run(['systemctl','restart','komari-traffic-ledger.service'],check=True)
    for attempt in range(60):
        try:
            with urllib.request.urlopen('http://127.0.0.1:25776/_health',timeout=2) as response:
                if json.load(response).get('ready'):break
        except (OSError,ValueError):pass
        time.sleep(1)
    else:raise RuntimeError('Service did not become ready; check journalctl -u komari-traffic-ledger and source directory read permissions before enabling Nginx routes')
    print('Services installed. Add nginx/komari-custom.conf.example to your existing HTTPS server block, run nginx -t, then reload Nginx.')
    print('The existing Komari executable, node configuration and source database were not modified.')

if __name__=='__main__':
    try:main()
    except Exception as error:print('Installation stopped: '+str(error),file=sys.stderr);sys.exit(1)
