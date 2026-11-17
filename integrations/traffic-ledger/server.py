import argparse
import datetime as dt
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ledger import TrafficLedger
from unlock_service import UnlockService, UnlockError


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--state', required=True)
    parser.add_argument('--port', type=int, default=25776)
    parser.add_argument('--core', default='http://127.0.0.1:25774')
    parser.add_argument('--public-origin', default=os.environ.get('KOMARI_PUBLIC_ORIGIN',''))
    args = parser.parse_args()
    ledger = TrafficLedger(args.source, args.state)
    unlock = UnlockService(args.source, Path(args.state).parent / 'unlock.sqlite')
    stop = threading.Event()

    def collect():
        first = True
        while not stop.is_set():
            try:
                count = ledger.sync()
                if first:
                    logging.info('Traffic history imported for %s nodes', count)
                    first = False
            except Exception:
                logging.exception('Traffic sync failed; persisted totals retained')
            try:
                unlock.maintain()
            except Exception:
                logging.exception('Unlock maintenance failed')
            stop.wait(15)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == '/_health':
                try:
                    snapshot = ledger.snapshot(set())
                    age = time.time() - dt.datetime.fromisoformat(snapshot['last_sync'].replace('Z', '+00:00')).timestamp()
                    self.send_json(200 if age < 120 else 503, {'ready': age < 120, 'last_sync': snapshot['last_sync']})
                except Exception:
                    self.send_json(503, {'ready': False})
                return
            path = self.path.split('?')[0]
            if path == '/api/plugin/unlock-test/worker/identify':
                try:
                    self.send_json(200, {'status':'success','data':unlock.identify(self.headers.get('Authorization',''))})
                except UnlockError as error:
                    self.send_json(error.status, {'status':'error','message':error.message})
                return
            if path not in ('/api/purcarte/traffic', '/api/plugin/net-forecast/overview', '/api/plugin/unlock-test/snapshot'):
                self.send_json(404, {'status': 'error'})
                return
            try:
                # Delegate visibility and private-site authorization to Komari.
                headers = {key: self.headers[key] for key in ('Cookie', 'Authorization') if self.headers.get(key)}
                request = urllib.request.Request(args.core + '/api/nodes', headers=headers)
                with urllib.request.urlopen(request, timeout=5) as response:
                    core = json.load(response)
                if core.get('status') != 'success' or not isinstance(core.get('data'), list):
                    raise RuntimeError('Core node visibility unavailable')
                visible = {node['uuid'] for node in core['data']}
                if path == '/api/plugin/net-forecast/overview':
                    self.send_json(200, ledger.forecast_input(visible))
                elif path == '/api/plugin/unlock-test/snapshot':
                    self.send_json(200, {'status':'success','data':unlock.snapshot(core['data'])})
                else:
                    self.send_json(200, {'status': 'success', 'data': ledger.snapshot(visible)})
            except urllib.error.HTTPError as error:
                self.send_json(error.code if error.code in (401, 403) else 503, {'status': 'error', 'message': 'Traffic snapshot unavailable'})
            except Exception:
                logging.exception('Traffic snapshot request failed')
                self.send_json(503, {'status': 'error', 'message': 'Traffic snapshot unavailable'})

        def do_POST(self):
            path = self.path.split('?')[0]
            if path not in ('/api/plugin/unlock-test/probe','/api/plugin/unlock-test/worker/poll','/api/plugin/unlock-test/worker/report','/api/plugin/unlock-test/worker/rebind'):
                self.send_json(404, {'status':'error'})
                return
            try:
                self.connection.settimeout(15)
                size = int(self.headers.get('Content-Length','0'))
                if not 0 < size <= 300000 or self.headers.get('Content-Type','').split(';')[0] != 'application/json':
                    raise UnlockError(400, '需要有效的 JSON 请求')
                data = json.loads(self.rfile.read(size))
                if not isinstance(data,dict):raise UnlockError(400,'请求格式无效')
                if path.endswith('/probe'):
                    origin = self.headers.get('Origin')
                    if origin and origin != args.public_origin.rstrip('/'):
                        raise UnlockError(403,'请求来源无效')
                    if self.headers.get('Sec-Fetch-Site') == 'cross-site':raise UnlockError(403,'请求来源无效')
                    headers = {k:self.headers[k] for k in ('Cookie','Authorization') if self.headers.get(k)}
                    with urllib.request.urlopen(urllib.request.Request(args.core+'/api/me',headers=headers),timeout=5) as response:
                        me = json.load(response)
                    if not me.get('logged_in'):raise UnlockError(403,'请以管理员身份登录后检测')
                    clients = data.get('clients')
                    if not isinstance(clients,list) or len(clients)!=1 or not isinstance(clients[0],str):
                        raise UnlockError(400,'请选择一台机器进行检测')
                    with urllib.request.urlopen(urllib.request.Request(args.core+'/api/nodes',headers=headers),timeout=5) as response:
                        visible = {n['uuid'] for n in json.load(response)['data']}
                    if clients[0] not in visible:raise UnlockError(404,'节点不存在')
                    result = unlock.trigger(clients[0],data.get('onlyIfMissing') is True)
                else:
                    identity = unlock.identify(self.headers.get('Authorization',''))
                    if path.endswith('/poll'):
                        result = unlock.poll(identity,data.get('worker_id'))
                    elif path.endswith('/rebind'):
                        result = unlock.rebind(identity,data.get('worker_id'))
                    else:
                        if not isinstance(data.get('id'),str):raise UnlockError(400,'任务标识无效')
                        result = unlock.report(identity,data)
                self.send_json(200,{'status':'success','data':result})
            except UnlockError as error:
                self.send_json(error.status,{'status':'error','message':error.message,'code':error.code})
            except (ValueError,UnicodeDecodeError):
                self.send_json(400,{'status':'error','message':'请求格式无效'})
            except Exception:
                logging.exception('Unlock request failed')
                self.send_json(503,{'status':'error','message':'检测服务暂不可用'})

        def send_json(self, status, payload):
            body = json.dumps(payload, ensure_ascii=False).encode()
            try:
                self.send_response(status)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError,ConnectionResetError):
                # A closed tab/request is a normal cancellation, not a service failure.
                self.close_connection = True

        def log_message(self, *_args):
            pass

    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    worker = threading.Thread(target=collect, daemon=True)
    worker.start()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    try:
        server.serve_forever()
    finally:
        stop.set()
        server.server_close()


if __name__ == '__main__':
    main()
