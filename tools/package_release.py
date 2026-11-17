"""Build portable, deterministic theme and optional-service release archives."""
import hashlib,json,subprocess,sys,zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def archive(path,files):
    with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as output:
        for name,content in sorted(files.items()):
            item=zipfile.ZipInfo(name,(2026,11,17,0,0,0));item.compress_type=zipfile.ZIP_DEFLATED;item.external_attr=0o100644<<16
            output.writestr(item,content.encode('utf-8') if isinstance(content,str) else content)
def main():
    theme=json.loads((ROOT/'komari-theme.json').read_text(encoding='utf-8'))
    package=json.loads((ROOT/'package.json').read_text())
    if theme['version']!=package['version']:raise RuntimeError('Theme and package versions differ')
    version=theme['version'];out=ROOT/'release';out.mkdir(exist_ok=True)
    if not (ROOT/'dist/index.html').is_file():raise RuntimeError('Run npm run build first')
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    files={p.relative_to(ROOT).as_posix():p.read_bytes() for p in (ROOT/'dist').rglob('*') if p.is_file()}
    files.update({'komari-theme.json':(ROOT/'komari-theme.json').read_bytes(),'preview.png':(ROOT/'preview.png').read_bytes()})
    files['BUILD.json']=json.dumps({'version':version,'commit':commit,'files':{name:hashlib.sha256(content).hexdigest() for name,content in files.items()}},indent=2)
    archive(out/f'komari-theme-purcarte-v{version}.zip',files)
    service={'install.py':(ROOT/'tools/install_services.py').read_bytes(),'README.md':(ROOT/'docs/INSTALL.md').read_bytes()}
    for filename in ['ledger.py','server.py','unlock_service.py']:service['server/'+filename]=(ROOT/'integrations/traffic-ledger'/filename).read_bytes()
    for filename in ['worker.py','install.py','install.sh','UPSTREAM-LICENSE.txt']:service['unlock/'+filename]=(ROOT/'integrations/unlock-worker'/filename).read_bytes()
    manifest=json.loads((ROOT/'integrations/unlock-worker/detector-manifest.json').read_text())
    manifest['worker_sha256']=hashlib.sha256(service['unlock/worker.py']).hexdigest()
    manifest['installer_sha256']=hashlib.sha256(service['unlock/install.py']).hexdigest()
    service['unlock/manifest.json']=json.dumps(manifest,indent=2)
    service['backup/backup.py']=(ROOT/'integrations/release/backup.py').read_bytes()
    service['systemd/komari-traffic-ledger.service']=(ROOT/'integrations/traffic-ledger/komari-traffic-ledger.service').read_bytes()
    for filename in ['komari-custom-backup.service','komari-custom-backup.timer']:service['systemd/'+filename]=(ROOT/'integrations/release'/filename).read_bytes()
    service['nginx/komari-custom.conf.example']=(ROOT/'integrations/traffic-ledger/nginx.conf.example').read_bytes()
    archive(out/f'komari-custom-services-v{version}.zip',service)
    archives=sorted(out.glob(f'*-v{version}.zip'))
    (out/'SHA256SUMS.txt').write_text(''.join(f'{digest(path)}  {path.name}\n' for path in archives),encoding='ascii')
    for path in archives:
        with zipfile.ZipFile(path) as packed:
            if packed.testzip():raise RuntimeError('Corrupt archive')
            assert all('\\' not in name and not name.startswith('/') and '..' not in Path(name).parts for name in packed.namelist())
        print(path.name,path.stat().st_size,digest(path))
if __name__=='__main__':main()
