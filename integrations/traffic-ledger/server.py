import argparse
import datetime as dt
import http.client
import json
import logging
import os
import queue
import socket
import threading
import time
import urllib.error
import urllib.parse
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ledger import TrafficLedger
from unlock_service import UnlockService, UnlockError

BILLING_PATH = '/api/purcarte/billing'


class CoreClient:
    """Direct connections to the configured core; credentials are per request."""
    def __init__(self, url):
        target = urllib.parse.urlsplit(url)
        if target.scheme not in ('http', 'https') or not target.hostname or target.query or target.fragment:
            raise ValueError('--core must be an HTTP(S) base URL')
        self.connection_type = http.client.HTTPSConnection if target.scheme == 'https' else http.client.HTTPConnection
        self.host, self.port = target.hostname, target.port
        self.base_path = target.path.rstrip('/')
        self.idle = queue.LifoQueue(maxsize=8)
        self.visibility_lock = threading.Lock()
        self.public_nodes = []
        self.expires = 0

    def get(self, path, headers):
        try:
            conn = self.idle.get_nowait()
        except queue.Empty:
            conn = None
        # An idle connection may have been closed by the core. Only retry that
        # case, and only these read-only GETs, on one fresh connection.
        for _ in range(2):
            reused = conn is not None
            if not reused:
                conn = self.connection_type(self.host, self.port, timeout=5)
            try:
                conn.request('GET', self.base_path + path, headers=headers)
                with conn.getresponse() as response:
                    if not 200 <= response.status < 300:
                        raise urllib.error.HTTPError(path, response.status, response.reason, response.headers, None)
                    payload = json.load(response)
            except (ConnectionError, http.client.IncompleteRead):
                if not reused:
                    raise
            else:
                if conn.sock is not None:
                    try:
                        self.idle.put_nowait(conn)
                        conn = None
                    except queue.Full:
                        pass
                return payload
            finally:
                if conn is not None:
                    conn.close()
                    conn = None

    def _nodes(self, headers):
        core = self.get('/api/nodes', headers)
        if core.get('status') != 'success' or not isinstance(core.get('data'), list):
            raise RuntimeError('Core node visibility unavailable')
        return [{'uuid': node['uuid'], 'name': node.get('name', node['uuid'])} for node in core['data']]

    def visible_nodes(self, headers):
        if headers:
            return self._nodes(headers)
        # Coalesce anonymous misses. Always ask the core again after expiry,
        # including when refreshing fails or the site becomes private.
        if not self.visibility_lock.acquire(timeout=5):
            raise TimeoutError('Core visibility lookup timed out')
        try:
            if time.monotonic() >= self.expires:
                self.public_nodes = self._nodes({})
                self.expires = time.monotonic() + 5
            return self.public_nodes
        finally:
            self.visibility_lock.release()

    def close(self):
        while True:
            try:
                self.idle.get_nowait().close()
            except queue.Empty:
                return


class BoundedHTTPServer(ThreadingHTTPServer):
    busy_response = (b'HTTP/1.1 503 Service Unavailable\r\nRetry-After: 1\r\n'
                     b'Connection: close\r\nContent-Length: 0\r\nCache-Control: no-store\r\n\r\n')
    busy_timeout = 0.25
    busy_drain_limit = 300000 + 8192

    def __init__(self, address, handler, max_workers=32):
        self.slots = threading.BoundedSemaphore(max_workers)
        self.rejectors = threading.BoundedSemaphore(8)
        super().__init__(address, handler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            # A slow rejected connection must not block the accept loop or
            # create an unbounded number of threads under sustained overload.
            if self.rejectors.acquire(blocking=False):
                try:
                    threading.Thread(target=self.reject_request, args=(request,), daemon=True).start()
                except BaseException:
                    self.rejectors.release()
                    raise
            else:
                self.send_busy(request, timeout=0)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def reject_request(self, request):
        try:
            self.send_busy(request, timeout=self.busy_timeout)
        finally:
            self.rejectors.release()

    def send_busy(self, request, *, timeout):
        deadline = time.monotonic() + timeout
        try:
            request.settimeout(timeout)
            request.sendall(self.busy_response)
            request.shutdown(socket.SHUT_WR)
            # Unread request bytes can turn close() into a TCP reset and
            # discard the response. Bound both total drain time and bytes.
            remaining = self.busy_drain_limit if timeout else 8192
            while remaining:
                left = deadline - time.monotonic()
                if timeout and left <= 0:
                    break
                if timeout:
                    request.settimeout(left)
                data = request.recv(min(65536, remaining))
                if not data:
                    break
                remaining -= len(data)
        except OSError:
            pass
        finally:
            self.shutdown_request(request)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--state', required=True)
    parser.add_argument('--port', type=int, default=25776)
    parser.add_argument('--core', default='http://127.0.0.1:25774')
    parser.add_argument('--public-origin', default=os.environ.get('KOMARI_PUBLIC_ORIGIN',''))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    public_origin = args.public_origin.rstrip('/')
    if not public_origin:
        logging.warning('Browser probes require --public-origin or KOMARI_PUBLIC_ORIGIN to be set to the public HTTPS origin.')
    core = CoreClient(args.core)
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
        # StreamRequestHandler applies this before parsing even the request line.
        timeout = 15

        def auth_headers(self):
            return {key: self.headers[key] for key in ('Cookie', 'Authorization') if self.headers.get(key)}

        def require_admin_session(self):
            cookie = self.headers.get('Cookie')
            if not cookie or core.get('/api/me', {'Cookie': cookie}).get('logged_in') is not True:
                raise UnlockError(403, '请以管理员身份登录后管理流量。')
            return {'Cookie': cookie}

        def require_same_origin(self):
            origins = self.headers.get_all('Origin')
            fetch_site = self.headers.get('Sec-Fetch-Site')
            if not public_origin or origins != [public_origin] or fetch_site in ('cross-site', 'same-site'):
                raise UnlockError(403, '请求来源无效')

        def handle_billing(self, uuid, changes=None):
            headers = self.require_admin_session()
            if not isinstance(uuid, str) or not 1 <= len(uuid) <= 128:
                raise UnlockError(400, '节点标识无效。')
            if not any(node['uuid'] == uuid for node in core.visible_nodes(headers)):
                raise UnlockError(404, '节点不存在。')
            if changes is not None:
                if (not {'period_start'}.issubset(changes)
                        or not set(changes) <= {'period_start', 'reset_day', 'used_gib'}
                        or not ({'reset_day', 'used_gib'} & set(changes))
                        or not isinstance(changes['period_start'], str)):
                    raise UnlockError(400, '流量设置格式无效。')
                if 'reset_day' in changes:
                    day = changes['reset_day']
                    if type(day) is not int or not 1 <= day <= 31:
                        raise UnlockError(400, '重置日须为 1 到 31 的整数。')
                value = changes.get('used_gib')
                if value is not None and (type(value) not in (int, float) or not 0 <= value < 2**33):
                    raise UnlockError(400, '校准值须为有效的非负 GiB 数值。')
            try:
                settings = ledger.billing_settings(uuid, changes)
            except ValueError as error:
                raise UnlockError(409, str(error)) from error
            if settings is None:
                raise UnlockError(409, '节点账本尚未同步，请稍后重试。')
            self.send_json(200, {'status': 'success', 'data': settings})

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
            if path not in (BILLING_PATH, '/api/purcarte/traffic', '/api/plugin/net-forecast/overview', '/api/plugin/unlock-test/snapshot'):
                self.send_json(404, {'status': 'error'})
                return
            try:
                if path == BILLING_PATH:
                    query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                    self.handle_billing(query.get('uuid', [''])[0])
                    return
                # Delegate visibility and private-site authorization to Komari.
                nodes = core.visible_nodes(self.auth_headers())
                if path == '/api/plugin/unlock-test/snapshot':
                    self.send_json(200, {'status':'success','data':unlock.snapshot(nodes)})
                else:
                    visible = {node['uuid'] for node in nodes}
                    if path == '/api/plugin/net-forecast/overview':
                        self.send_json(200, ledger.forecast_input(visible))
                    else:
                        self.send_json(200, {'status': 'success', 'data': ledger.snapshot(visible)})
            except UnlockError as error:
                self.send_json(error.status, {'status': 'error', 'message': error.message})
            except urllib.error.HTTPError as error:
                self.send_json(error.code if error.code in (401, 403) else 503, {'status': 'error', 'message': 'Traffic snapshot unavailable'})
            except Exception:
                logging.exception('Traffic snapshot request failed')
                self.send_json(503, {'status': 'error', 'message': 'Traffic snapshot unavailable'})

        def do_POST(self):
            path = self.path.split('?')[0]
            if path not in (BILLING_PATH, '/api/plugin/unlock-test/probe','/api/plugin/unlock-test/worker/poll','/api/plugin/unlock-test/worker/report','/api/plugin/unlock-test/worker/rebind'):
                self.send_json(404, {'status':'error'})
                return
            try:
                size = int(self.headers.get('Content-Length','0'))
                if not 0 < size <= (4096 if path == BILLING_PATH else 300000) or self.headers.get('Content-Type','').split(';')[0] != 'application/json':
                    raise UnlockError(400, '需要有效的 JSON 请求')
                data = json.loads(self.rfile.read(size))
                if not isinstance(data,dict):raise UnlockError(400,'请求格式无效')
                if path == BILLING_PATH:
                    self.require_same_origin()
                    self.handle_billing(data.pop('uuid', None), data)
                    return
                if path.endswith('/probe'):
                    self.require_same_origin()
                    headers = self.auth_headers()
                    me = core.get('/api/me', headers)
                    if not me.get('logged_in'):raise UnlockError(403,'请以管理员身份登录后检测')
                    clients = data.get('clients')
                    if not isinstance(clients,list) or len(clients)!=1 or not isinstance(clients[0],str):
                        raise UnlockError(400,'请选择一台机器进行检测')
                    visible = {n['uuid'] for n in core.visible_nodes(headers)}
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
            except urllib.error.HTTPError as error:
                if error.code in (401, 403):
                    self.send_json(error.code, {'status': 'error', 'message': '请以管理员身份登录。'})
                else:
                    logging.warning('Core rejected unlock request with HTTP %s', error.code)
                    self.send_json(503, {'status': 'error', 'message': '服务暂不可用'})
            except (ValueError,UnicodeDecodeError):
                self.send_json(400,{'status':'error','message':'请求格式无效'})
            except Exception:
                logging.exception('Unlock request failed')
                self.send_json(503,{'status':'error','message':'服务暂不可用'})

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

    worker = threading.Thread(target=collect, daemon=True)
    worker.start()
    server = BoundedHTTPServer(('127.0.0.1', args.port), Handler)
    try:
        server.serve_forever()
    finally:
        stop.set()
        server.server_close()
        core.close()


if __name__ == '__main__':
    main()
