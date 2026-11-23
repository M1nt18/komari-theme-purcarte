#!/usr/bin/env python3
"""A pull-only worker with one fixed executable and fixed arguments."""
import argparse
import fcntl
import json
import os
import signal
import subprocess
import time
import urllib.error
import urllib.request
import urllib.parse
from pathlib import Path

COMMAND = ['/opt/komari-unlock-worker/unlock-test', '-region', '0,11', '-conc', '10', '-show-active=false']
ACTIVE_PROCESS = None
MAX_OUTPUT_BYTES = 262144
MAX_REQUEST_BYTES = 300000


def atomic_json(path, data):
    tmp = path.with_suffix('.tmp')
    with tmp.open('w') as stream:
        os.chmod(tmp, 0o600)
        json.dump(data, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    tmp.replace(path)


def decode_output(raw):
    return raw[:MAX_OUTPUT_BYTES].decode('utf-8', errors='ignore')


def encode_request(body):
    def encode(value):
        return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')

    if 'output' not in body:
        return encode(body)
    # Older outboxes can contain an oversized trailing replacement character.
    output = decode_output(body['output'].encode('utf-8'))
    payload = encode({**body, 'output': output})
    if len(payload) <= MAX_REQUEST_BYTES:
        return payload
    # JSON escapes quotes/control characters, even when the raw output fits.
    # Keep the longest prefix that also fits the HTTP endpoint's body limit.
    low, high = 0, len(output)
    while low < high:
        mid = (low + high + 1) // 2
        if len(encode({**body, 'output': output[:mid]})) <= MAX_REQUEST_BYTES:
            low = mid
        else:
            high = mid - 1
    return encode({**body, 'output': output[:low]})


def request(config, path, body=None):
    req = urllib.request.Request(config['endpoint'] + '/api/plugin/unlock-test/' + path,
        data=encode_request(body) if body is not None else None,
        headers={'Authorization':'Bearer '+config['token'], 'Content-Type':'application/json', 'User-Agent':'Komari-Unlock-Worker/1'})
    with urllib.request.urlopen(req, timeout=20) as response:
        payload = json.load(response)
    if payload.get('status') != 'success':raise RuntimeError('Server rejected request')
    return payload['data']


def stop_process(*_args):
    if ACTIVE_PROCESS is not None and ACTIVE_PROCESS.poll() is None:
        try:os.killpg(ACTIVE_PROCESS.pid,signal.SIGKILL)
        except ProcessLookupError:pass
    raise SystemExit(0)


def run_detection():
    global ACTIVE_PROCESS
    # No command, executable, flags, or URL is accepted from a network response.
    ACTIVE_PROCESS = subprocess.Popen(COMMAND, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True,
        env={**os.environ,'NO_COLOR':'1','TERM':'dumb'})
    try:
        output,_ = ACTIVE_PROCESS.communicate(timeout=300)
        return ACTIVE_PROCESS.returncode, decode_output(output)
    except subprocess.TimeoutExpired:
        os.killpg(ACTIVE_PROCESS.pid,signal.SIGKILL)
        output,_ = ACTIVE_PROCESS.communicate()
        return 124, decode_output(output)
    finally:
        ACTIVE_PROCESS = None


def step(config, journal, runner=run_detection, transport=request):
    saved = json.loads(journal.read_text()) if journal.exists() else None
    if saved:
        if saved.get('phase') == 'running':
            # A crashed scan is not silently rerun after a service restart.
            saved.update(phase='report',exit_code=125,output='Worker interrupted; request a new scan manually')
            atomic_json(journal,saved)
        try:
            transport(config,'worker/report',{k:saved[k] for k in ('id','lease','exit_code','output')})
        except urllib.error.HTTPError as error:
            if error.code != 409:raise
            try:reason=json.load(error).get('code')
            except (ValueError,AttributeError):reason=None
            if reason not in ('task_gone','task_terminal'):raise
            atomic_json(journal.with_name('last-discarded-task.json'),
                {'id':saved['id'],'reason':reason,'time':time.time()})
            journal.unlink(missing_ok=True)
            print('旧任务已结束，继续等待手动检测',flush=True)
            return
        journal.unlink(missing_ok=True)
        print('检测结果已回传',flush=True)
        return
    data = transport(config,'worker/poll',{'worker_id':config['worker_id']})
    if data['node']['uuid'] != config['uuid']:raise RuntimeError('Node identity changed')
    job = data.get('job')
    if not job:return
    if job.get('kind') != 'unlock-test-v1':raise RuntimeError('Unsupported job kind')
    if not all(isinstance(job.get(k),str) for k in ('id','lease')):raise RuntimeError('Invalid job')
    saved = {'id':job['id'],'lease':job['lease'],'phase':'running'}
    atomic_json(journal,saved)
    print('开始流媒体检测',flush=True)
    code,output = runner()
    saved.update(phase='report',exit_code=code,output=output)
    atomic_json(journal,saved)
    # If upload fails, the saved outbox is retried without running detection again.
    transport(config,'worker/report',{k:saved[k] for k in ('id','lease','exit_code','output')})
    journal.unlink(missing_ok=True)
    print('检测完成，结果已回传',flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config',required=True)
    parser.add_argument('--state',default='/var/lib/komari-unlock-worker')
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    endpoint=urllib.parse.urlsplit(config['endpoint'])
    if endpoint.scheme!='https' or not endpoint.hostname or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment or endpoint.path not in ('','/'):
        raise RuntimeError('Worker endpoint must be an HTTPS origin')
    config['endpoint']=config['endpoint'].rstrip('/')
    state = Path(args.state);state.mkdir(parents=True,exist_ok=True)
    lock = (state/'worker.lock').open('a')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    signal.signal(signal.SIGTERM,stop_process);signal.signal(signal.SIGINT,stop_process)
    while True:
        try:step(config,state/'outbox.json')
        except Exception as error:
            # Never log tokens, HTTP headers or response bodies.
            print('连接或回传暂未完成，将重试：'+type(error).__name__,flush=True)
        time.sleep(15)


if __name__ == '__main__':main()
