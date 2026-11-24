"""Consistent SQLite backups, private local retention, and isolated restore checks."""
import argparse,datetime as dt,hashlib,json,os,shutil,sqlite3,tempfile
from pathlib import Path

ROOT=Path('/var/backups/komari-custom')
SOURCES={
    'core.sqlite':Path(os.environ.get('KOMARI_SOURCE','/opt/komari/data/komari.db')).resolve(),
    'ledger.sqlite':Path('/var/lib/komari-traffic-ledger/ledger.sqlite'),
    'unlock.sqlite':Path('/var/lib/komari-traffic-ledger/unlock.sqlite'),
}

METRIC_TABLES = {'metric_definitions', 'metric_label_sets', 'metric_resolutions',
                 'metric_rollups', 'metric_series', 'metric_store_state'}

def digest(path):
    sha = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            sha.update(chunk)
    return sha.hexdigest()

def copy_db(source,destination):
    src=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True,timeout=30)
    dst=sqlite3.connect(destination)
    try:src.backup(dst,pages=256,sleep=.01)
    finally:dst.close();src.close()
    os.chmod(destination,0o600)

def inspect(path):
    db=sqlite3.connect(path.as_uri()+'?mode=ro',uri=True)
    try:
        if db.execute('PRAGMA quick_check').fetchone()[0]!='ok':raise RuntimeError('Invalid backup: '+path.name)
        tables={row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if path.name == 'metrics.db':
            if not {'metric_rollups', 'metric_series'}.issubset(tables):
                raise RuntimeError('Configured metrics database is missing its metric tables')
            selected = tables.intersection(METRIC_TABLES)
        else:
            selected=tables.intersection({'clients','buckets','calibrations','workers','results','jobs','ping_tasks'})
        return {name:db.execute('SELECT COUNT(*) FROM '+name).fetchone()[0] for name in sorted(selected)}
    finally:db.close()

def backup():
    os.umask(0o077);ROOT.mkdir(parents=True,exist_ok=True);ROOT.chmod(0o700)
    name=dt.datetime.now(dt.timezone.utc).strftime('backup-%Y%m%dT%H%M%SZ')
    staging=ROOT/(name+'.partial');staging.mkdir()
    manifest={}
    try:
        sources = SOURCES.copy()
        metrics_path = os.environ.get('KOMARI_METRICS_DB')
        if metrics_path:
            sources['metrics.db'] = Path(metrics_path).resolve()
        for filename,source in sources.items():
            dest=staging/filename;copy_db(source,dest)
            manifest[filename]={'sha256':digest(dest),'counts':inspect(dest)}
        config=staging/'config';config.mkdir()
        config_paths = ['/etc/komari-custom.env','/etc/systemd/system/komari-traffic-ledger.service',
                        '/etc/systemd/system/komari-custom-backup.service','/etc/systemd/system/komari-custom-backup.timer']
        config_paths += [value for value in os.environ.get('KOMARI_BACKUP_CONFIG','').split(':') if value]
        for index, filename in enumerate(config_paths):
            source=Path(filename)
            if source.is_file():shutil.copy2(source,config/(str(index)+'-'+source.name))
        (staging/'manifest.json').write_text(json.dumps(manifest,indent=2))
        result=ROOT/name;staging.rename(result)
        cutoff=dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=14)
        for path in ROOT.glob('backup-*'):
            try:created=dt.datetime.strptime(path.name,'backup-%Y%m%dT%H%M%SZ').replace(tzinfo=dt.timezone.utc)
            except ValueError:continue
            if created<cutoff and path!=result and (path/'manifest.json').is_file():shutil.rmtree(path)
        print('Backup verified:',result)
        return result
    except Exception:
        shutil.rmtree(staging);raise

def restore_check(path):
    manifest=json.loads((path/'manifest.json').read_text())
    with tempfile.TemporaryDirectory(prefix='restore-check-',dir=ROOT) as folder:
        for filename,meta in manifest.items():
            source=path/filename
            if digest(source)!=meta['sha256']:raise RuntimeError('Digest mismatch: '+filename)
            restored=Path(folder)/filename;copy_db(source,restored)
            if inspect(restored)!=meta['counts']:raise RuntimeError('Restored row counts differ')
    print('Isolated restore verified:', ', '.join(manifest))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--restore-check',action='store_true');args=parser.parse_args()
    path=backup()
    if args.restore_check:restore_check(path)
