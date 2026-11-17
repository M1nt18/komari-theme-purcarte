#!/usr/bin/env python3
"""Run locally as root; discovers only this machine's existing Komari identity."""
import argparse
import getpass
import hashlib
import json
import os
import platform
import pwd
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import urllib.parse
import uuid
from pathlib import Path

BASE=''
CODE=Path('/opt/komari-unlock-worker')
CONFIG=Path('/etc/komari-unlock-worker/config.json')
STATE=Path('/var/lib/komari-unlock-worker')


def identity(token):
    request=urllib.request.Request(BASE+'/api/plugin/unlock-test/worker/identify',headers={'Authorization':'Bearer '+token})
    with urllib.request.urlopen(request,timeout=15) as response:return json.load(response)['data']


def discover_tokens():
    tokens=set()
    def config(path):
        try:
            obj=json.loads(Path(path).read_text())
            if isinstance(obj,dict) and isinstance(obj.get('token'),str):tokens.add(obj['token'])
        except (OSError,ValueError):pass
    def args(values):
        for i,value in enumerate(values):
            if value in ('-t','--token') and i+1<len(values):tokens.add(values[i+1])
            if value.startswith('--token='):tokens.add(value.split('=',1)[1])
            if value in ('-c','--config') and i+1<len(values):config(values[i+1])
            if value.startswith('--config='):config(value.split('=',1)[1])
    for proc in Path('/proc').glob('[0-9]*'):
        try:
            argv=proc.joinpath('cmdline').read_bytes().decode().split('\0')
            if not argv or not ('komari-agent' in Path(argv[0]).name or argv[0].endswith('/komari/agent')):continue
            args(argv)
            config(proc/'cwd'/'auto-discovery.json')
            config(Path(argv[0]).parent/'auto-discovery.json')
            for item in proc.joinpath('environ').read_bytes().decode().split('\0'):
                if item.startswith(('KOMARI_TOKEN=','TOKEN=')):tokens.add(item.split('=',1)[1])
        except (OSError,UnicodeDecodeError):pass
    for path in ['/opt/komari/agent/config.json','/etc/komari-agent/config.json','/etc/komari/config.json','/etc/komari-agent.json',
                 '/opt/komari/auto-discovery.json','/etc/komari/auto-discovery.json','/etc/komari-agent/auto-discovery.json']:
        config(path)
    for path in ['/etc/systemd/system/komari-agent.service','/etc/init.d/komari-agent','/etc/config/komari','/etc/config/komari-agent']:
        try:text=Path(path).read_text()
        except OSError:continue
        tokens.update(re.findall(r'(?:--token(?:=|\s+)|-t\s+|option\s+token\s+)[\x22\x27]?([A-Za-z0-9_./+=:-]{12,512})',text))
        for directory in re.findall(r'^WorkingDirectory=(.+)$',text,re.M):config(Path(directory.strip().strip('"'))/'auto-discovery.json')
    return tokens


def download(url,destination,expected):
    with urllib.request.urlopen(url,timeout=90) as response:content=response.read(64*1024*1024)
    if hashlib.sha256(content).hexdigest()!=expected:raise RuntimeError('下载校验失败，未安装：'+destination.name)
    destination.write_bytes(content)
    destination.chmod(0o755)


def main():
    global BASE
    parser=argparse.ArgumentParser();parser.add_argument('--url',default=os.environ.get('KOMARI_URL',''));parser.add_argument('--check',action='store_true');parser.add_argument('--rebind',action='store_true');options=parser.parse_args()
    if os.geteuid()!=0:raise RuntimeError('请使用 root 运行安装命令')
    existing=json.loads(CONFIG.read_text()) if CONFIG.exists() else None
    BASE=options.url or (existing or {}).get('endpoint','')
    url=urllib.parse.urlsplit(BASE)
    if url.scheme!='https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('','/'):
        raise RuntimeError('请通过 --url 或 KOMARI_URL 指定探针的 HTTPS 站点地址')
    BASE=BASE.rstrip('/')
    candidates=({os.environ['KOMARI_TOKEN']} if os.environ.get('KOMARI_TOKEN') else
                {existing['token']} if existing else discover_tokens())
    matched={}
    for token in candidates:
        try:node=identity(token);matched[node['uuid']]=(token,node)
        except urllib.error.HTTPError as error:
            if error.code!=401:raise
    if not matched and not options.check and sys.stdin.isatty():
        token=getpass.getpass('未自动找到本机 Agent Token，请粘贴该节点 Token（不显示输入）: ')
        node=identity(token);matched[node['uuid']]=(token,node)
    if len(matched)!=1:raise RuntimeError('无法唯一识别本机节点，请用 KOMARI_TOKEN 指定本机 Agent Token 后重试；不会修改原探针')
    token,node=next(iter(matched.values()))
    if existing and existing['uuid']!=node['uuid']:raise RuntimeError('已有组件绑定了不同节点，已停止安装')
    architecture={'x86_64':'amd64','amd64':'amd64','aarch64':'arm64','arm64':'arm64','armv7l':'arm7','armv6l':'arm6','i386':'386','i686':'386'}.get(platform.machine())
    if platform.system()!='Linux' or not architecture:raise RuntimeError('当前安装器暂不支持此系统/架构')
    systemd=Path('/run/systemd/system').exists()
    procd=Path('/sbin/procd').exists()
    if not systemd and not procd:raise RuntimeError('需要 systemd 或 OpenWrt procd 才能开机自动运行')
    if options.check:
        print('识别成功：'+node['name']+' ('+node['uuid']+')；'+architecture+'；'+('systemd' if systemd else 'procd'))
        return
    with urllib.request.urlopen(BASE+'/unlock/manifest.json',timeout=20) as response:manifest=json.load(response)
    with tempfile.TemporaryDirectory(prefix='komari-unlock-install-') as temp:
        temp=Path(temp)
        download(BASE+'/unlock/worker.py',temp/'worker.py',manifest['worker_sha256'])
        binary=manifest['binaries'][architecture]
        download(binary['url'],temp/'unlock-test',binary['sha256'])
        # Check compatibility before replacing a working installation.
        result=subprocess.run([str(temp/'unlock-test'),'-h'],capture_output=True,text=True,timeout=15)
        if '-region' not in result.stdout+result.stderr:raise RuntimeError('检测程序不兼容，保留原安装')
        if systemd:subprocess.run(['systemctl','stop','komari-unlock-worker'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        elif Path('/etc/init.d/komari-unlock-worker').exists():subprocess.run(['/etc/init.d/komari-unlock-worker','stop'],check=True)
        CODE.mkdir(parents=True,exist_ok=True);CODE.chmod(0o755)
        CONFIG.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        for name in ['worker.py','unlock-test']:shutil.copy2(temp/name,CODE/name)
    settings={'endpoint':BASE,'uuid':node['uuid'],'token':token,'worker_id':existing['worker_id'] if existing else str(uuid.uuid4())}
    if options.rebind:
        request=urllib.request.Request(BASE+'/api/plugin/unlock-test/worker/rebind',
            data=json.dumps({'worker_id':settings['worker_id']}).encode(),
            headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=15) as response:json.load(response)
    CONFIG.write_text(json.dumps(settings));CONFIG.chmod(0o600)
    python=shutil.which('python3')
    if systemd:
        service='''[Unit]
Description=Komari media unlock worker (fixed detection only)
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
DynamicUser=yes
StateDirectory=komari-unlock-worker
LoadCredential=config:/etc/komari-unlock-worker/config.json
ExecStart=PYTHON -B /opt/komari-unlock-worker/worker.py --config %d/config
Restart=always
RestartSec=15
KillMode=control-group
TimeoutStopSec=10
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
MemoryMax=192M
[Install]
WantedBy=multi-user.target
'''.replace('PYTHON',python)
        Path('/etc/systemd/system/komari-unlock-worker.service').write_text(service)
        subprocess.run(['systemctl','daemon-reload'],check=True)
        subprocess.run(['systemctl','enable','--now','komari-unlock-worker'],check=True)
        subprocess.run(['systemctl','is-active','--quiet','komari-unlock-worker'],check=True)
    else:
        # OpenWrt /var is normally tmpfs: keep the outbox on persistent overlay.
        state=CONFIG.parent/'state'
        nobody=pwd.getpwnam('nobody');state.mkdir(parents=True,exist_ok=True)
        os.chown(state,nobody.pw_uid,nobody.pw_gid);state.chmod(0o700)
        os.chown(CONFIG.parent,nobody.pw_uid,nobody.pw_gid);os.chown(CONFIG,nobody.pw_uid,nobody.pw_gid)
        script='''#!/bin/sh /etc/rc.common
START=99
STOP=10
USE_PROCD=1
start_service() {
    procd_open_instance
    procd_set_param command PYTHON -B /opt/komari-unlock-worker/worker.py --config /etc/komari-unlock-worker/config.json --state /etc/komari-unlock-worker/state
    procd_set_param user nobody
    procd_set_param respawn 3600 15 5
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_close_instance
}
'''.replace('PYTHON',python)
        init=Path('/etc/init.d/komari-unlock-worker');init.write_text(script);init.chmod(0o755)
        subprocess.run([str(init),'enable'],check=True);subprocess.run([str(init),'start'],check=True)
    print('安装完成，已绑定：'+node['name'])
    print('首次检测约需 1～5 分钟，结果将自动显示在机器详情页。以后请管理员登录网页后点击“重新检测”。')


if __name__=='__main__':
    try:main()
    except Exception as error:
        if isinstance(error,urllib.error.HTTPError):print('安装未完成：服务器返回 HTTP '+str(error.code),file=sys.stderr)
        elif isinstance(error,urllib.error.URLError):print('安装未完成：无法通过 HTTPS 连接探针站点',file=sys.stderr)
        else:print('安装未完成：'+str(error),file=sys.stderr)
        sys.exit(1)
