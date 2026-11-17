#!/usr/bin/env python3
"""Install the optional services from an extracted companion archive."""
import argparse,json,os,shutil,sqlite3,subprocess,sys,time,urllib.parse,urllib.request
from pathlib import Path

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True,help='Existing Komari SQLite database')
    parser.add_argument('--origin',required=True,help='Public HTTPS origin, for example https://monitor.example.com')
    parser.add_argument('--core',default='http://127.0.0.1:25774')
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args();source=Path(args.source).resolve()
    url=urllib.parse.urlsplit(args.origin)
    if url.scheme!='https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('','/'):
        raise RuntimeError('--origin must be a public HTTPS origin without a path')
    root=Path(__file__).resolve().parent
    db=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)
    required={'clients':{'uuid','name','traffic_limit','traffic_limit_type','token'},'records':{'client','time','traffic_up','traffic_down'},'records_long_term':{'client','time','traffic_up','traffic_down'}}
    try:
        for table,columns in required.items():
            found={r[1] for r in db.execute('PRAGMA table_info('+table+')')}
            if not columns<=found:raise RuntimeError('Unsupported Komari data schema: '+table+' missing '+', '.join(sorted(columns-found)))
    finally:db.close()
    if args.check:print('Source database and service origin verified; no files changed');return
    if sys.platform!='linux' or os.geteuid()!=0:raise RuntimeError('Installation requires root on a systemd Linux host')
    if not Path('/run/systemd/system').exists():raise RuntimeError('This server installer requires systemd')
    paths={'server':Path('/opt/komari-traffic-ledger'),'unlock':Path('/opt/komari-unlock-release'),'backup':Path('/opt/komari-maintenance')}
    for kind,destination in paths.items():
        destination.mkdir(parents=True,exist_ok=True)
        for file in (root/kind).iterdir():
            if file.is_file():shutil.copy2(file,destination/file.name)
    config=Path('/etc/komari-custom.env')
    config.write_text('KOMARI_SOURCE='+json.dumps(str(source))+'\nKOMARI_PUBLIC_ORIGIN='+json.dumps(args.origin.rstrip('/'))+'\nKOMARI_CORE='+json.dumps(args.core)+'\n')
    config.chmod(0o600)
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
