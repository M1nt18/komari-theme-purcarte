import json
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from server import BoundedHTTPServer, CoreClient
from test_unlock import OUTPUT,WORKER


class Core(BaseHTTPRequestHandler):
    def do_GET(self):
        admin=self.headers.get('Cookie')=='session_token=test-admin'
        payload={'logged_in':admin} if self.path=='/api/me' else {'status':'success','data':[{'uuid':'a','name':'A'}]+([{'uuid':'b','name':'B'}] if admin else [])}
        body=json.dumps(payload).encode();self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def log_message(self,*_args):pass


class HTTPTests(unittest.TestCase):
    def test_anonymous_cache_expiry_and_authenticated_connection_reuse(self):
        connections = []

        class VisibleCore(Core):
            protocol_version = 'HTTP/1.1'

            def do_GET(self):
                connections.append(self.client_address)
                if self.server.private and not self.headers.get('Cookie'):
                    self.send_error(403)
                else:
                    super().do_GET()

        with ThreadingHTTPServer(('127.0.0.1', 0), VisibleCore) as backend:
            backend.private = False
            thread = threading.Thread(target=backend.serve_forever, daemon=True)
            thread.start()
            client = CoreClient(f'http://127.0.0.1:{backend.server_port}')
            try:
                with ThreadPoolExecutor(max_workers=8) as pool:
                    public = list(pool.map(client.visible_nodes, [{} for _ in range(12)]))
                self.assertTrue(all(nodes == [{'uuid': 'a', 'name': 'A'}] for nodes in public))
                self.assertEqual(len(connections), 1)
                for _ in range(2):
                    self.assertEqual(len(client.visible_nodes({'Cookie': 'session_token=test-admin'})), 2)
                self.assertEqual(len(connections), 3)
                self.assertEqual(len(set(connections)), 1)
                self.assertEqual(len(client.visible_nodes({})), 1)
                backend.private = True
                client.expires = 0
                with self.assertRaises(urllib.error.HTTPError) as failure:
                    client.visible_nodes({})
                self.assertEqual(failure.exception.code, 403)
            finally:
                client.close()
                backend.shutdown()
                thread.join()

    def test_saturated_server_returns_503_and_recovers(self):
        entered, release = threading.Event(), threading.Event()

        class SlowHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                entered.set()
                release.wait(5)
                self.send_response(200)
                self.end_headers()

            def log_message(self, *_args):
                pass

        with BoundedHTTPServer(('127.0.0.1', 0), SlowHandler, max_workers=1) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            url = f'http://127.0.0.1:{server.server_port}'

            def get():
                with urllib.request.urlopen(url, timeout=5) as response:
                    response.read()
                    return response.status

            try:
                with ThreadPoolExecutor(max_workers=1) as pool:
                    first = pool.submit(get)
                    try:
                        self.assertTrue(entered.wait(3))
                        with self.assertRaises(urllib.error.HTTPError) as failure:
                            get()
                        self.assertEqual(failure.exception.code, 503)
                    finally:
                        release.set()
                    self.assertEqual(first.result(timeout=3), 200)
                self.assertTrue(server.slots.acquire(timeout=3))
                server.slots.release()
                self.assertEqual(get(), 200)
            finally:
                release.set()
                server.shutdown()
                thread.join()

    def test_real_http_authorization_queue_report_and_visibility(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'source.sqlite'
            db=sqlite3.connect(source)
            db.executescript('''CREATE TABLE clients(uuid TEXT,name TEXT,token TEXT,traffic_limit INTEGER,traffic_limit_type TEXT,traffic_reset_day INTEGER,traffic_baseline_usage REAL);
                INSERT INTO clients VALUES('a','A','test-node-token-A',1000,'sum',1,NULL);
                INSERT INTO clients VALUES('b','B','test-node-token-B',1000,'sum',1,NULL);
                CREATE TABLE records(client TEXT,time TEXT,traffic_up INTEGER,traffic_down INTEGER);
                CREATE TABLE records_long_term(client TEXT,time TEXT,traffic_up INTEGER,traffic_down INTEGER);''');db.close()
            core=ThreadingHTTPServer(('127.0.0.1',0),Core)
            thread=threading.Thread(target=core.serve_forever,daemon=True);thread.start()
            with socket.socket() as listener:listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
            process=subprocess.Popen([sys.executable,'-B',str(Path(__file__).with_name('server.py')),'--source',str(source),'--state',str(root/'ledger.sqlite'),'--port',str(port),'--core','http://127.0.0.1:'+str(core.server_port),'--public-origin','https://monitor.example.test'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            base='http://127.0.0.1:'+str(port)
            def call(path,body=None,headers=None):
                req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**(headers or {})})
                try:
                    with urllib.request.urlopen(req,timeout=3) as response:return response.status,json.load(response)
                except urllib.error.HTTPError as error:return error.code,json.load(error)
            prefix='/api/plugin/unlock-test'
            try:
                for _ in range(50):
                    try:
                        if call('/_health')[0]==200:break
                    except OSError:pass
                    time.sleep(.1)
                else:self.fail('test server did not start')
                self.assertEqual(call(prefix+'/probe',{'clients':['a']})[0],403)
                admin={'Cookie':'session_token=test-admin','Origin':'https://monitor.example.test'}
                self.assertEqual(call(prefix+'/probe',{'clients':['a']},{**admin,'Origin':'https://other.example'})[0],403)
                self.assertEqual(call(prefix+'/worker/identify')[0],401)
                auth={'Authorization':'Bearer test-node-token-A'}
                self.assertEqual(call(prefix+'/worker/identify',headers=auth)[1]['data']['uuid'],'a')
                job=call(prefix+'/worker/poll',{'worker_id':WORKER},auth)[1]['data']['job']
                self.assertEqual(call(prefix+'/probe',{'clients':['a']},admin)[1]['data']['reason'],'already_running')
                report={'id':job['id'],'lease':job['lease'],'exit_code':0,'output':OUTPUT}
                self.assertEqual(call(prefix+'/worker/report',report,{'Authorization':'Bearer test-node-token-B'})[0],403)
                self.assertEqual(call(prefix+'/worker/report',report,auth)[0],200)
                snapshot=call(prefix+'/snapshot')[1]['data']
                self.assertEqual(set(snapshot['nodes']),{'a'})
                self.assertEqual(len(snapshot['nodes']['a']['services']),3)
                self.assertFalse(snapshot['autoProbe'])
                self.assertIsNone(call(prefix+'/worker/poll',{'worker_id':WORKER},auth)[1]['data']['job'])
            finally:
                process.terminate();process.wait(timeout=10);core.shutdown();core.server_close();thread.join()


if __name__=='__main__':unittest.main()
