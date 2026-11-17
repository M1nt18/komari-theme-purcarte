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
from test_unlock import OUTPUT,WORKER


class Core(BaseHTTPRequestHandler):
    def do_GET(self):
        admin=self.headers.get('Cookie')=='session_token=test-admin'
        payload={'logged_in':admin} if self.path=='/api/me' else {'status':'success','data':[{'uuid':'a','name':'A'}]+([{'uuid':'b','name':'B'}] if admin else [])}
        body=json.dumps(payload).encode();self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def log_message(self,*_args):pass


class HTTPTests(unittest.TestCase):
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
