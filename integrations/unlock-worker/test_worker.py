import importlib.util
import json
import io
import urllib.error
import sys
import tempfile
import types
import unittest
from pathlib import Path

if sys.platform=='win32':sys.modules['fcntl']=types.SimpleNamespace()
spec=importlib.util.spec_from_file_location('unlock_worker',Path(__file__).with_name('worker.py'))
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def test_output_fits_utf8_and_wire_limits_even_for_an_old_outbox(self):
        prefix = '中' * (worker.MAX_OUTPUT_BYTES // 3)
        self.assertEqual(worker.decode_output((prefix + '文').encode()), prefix)
        for output in (prefix + '\ufffd', '\x01' * worker.MAX_OUTPUT_BYTES):
            body = {'id': '1', 'lease': 'test', 'exit_code': 0, 'output': output}
            encoded = worker.encode_request(body)
            sent = json.loads(encoded)
            self.assertLessEqual(len(encoded), worker.MAX_REQUEST_BYTES)
            self.assertLessEqual(len(sent['output'].encode()), worker.MAX_OUTPUT_BYTES)
            self.assertTrue(output.startswith(sent['output']))
            self.assertEqual(worker.encode_request(body), encoded)
        self.assertEqual(json.loads(worker.encode_request({'output': prefix}))['output'], prefix)

    def test_missing_old_job_releases_outbox_but_forbidden_response_does_not(self):
        with tempfile.TemporaryDirectory() as temp:
            journal=Path(temp)/'outbox.json'
            saved={'id':'old','lease':'nonce','phase':'report','exit_code':0,'output':'result'}
            def reject(code,reason):
                def transport(*_args):raise urllib.error.HTTPError('https://test.invalid',code,'response',{},io.BytesIO(json.dumps({'code':reason}).encode()))
                return transport
            journal.write_text(json.dumps(saved))
            with self.assertRaises(urllib.error.HTTPError):worker.step({},journal,transport=reject(403,None))
            self.assertTrue(journal.exists())
            worker.step({},journal,transport=reject(409,'task_gone'))
            self.assertFalse(journal.exists())
            self.assertEqual(json.loads((Path(temp)/'last-discarded-task.json').read_text())['reason'],'task_gone')

    def test_failed_upload_replays_saved_output_without_rescanning(self):
        with tempfile.TemporaryDirectory() as temp:
            journal=Path(temp)/'outbox.json';runs=[];reports=[]
            def transport(config,path,body):
                if path.endswith('/poll'):return {'node':{'uuid':'a'},'job':{'id':'1','lease':'nonce','kind':'unlock-test-v1'}}
                reports.append(body)
                if len(reports)==1:raise OSError('offline')
                return {'accepted':True}
            def runner():runs.append(1);return 0,'saved result'
            with self.assertRaises(OSError):worker.step({'uuid':'a','worker_id':'one'},journal,runner,transport)
            worker.step({'uuid':'a','worker_id':'one'},journal,runner,transport)
            self.assertEqual(len(runs),1);self.assertEqual(reports[0],reports[1]);self.assertFalse(journal.exists())

    def test_interrupted_detection_is_reported_not_automatically_rerun(self):
        with tempfile.TemporaryDirectory() as temp:
            journal=Path(temp)/'outbox.json'
            journal.write_text(json.dumps({'id':'1','lease':'nonce','phase':'running'}))
            reports=[]
            worker.step({},journal,lambda:self.fail('must not rescan'),lambda c,p,b:reports.append(b))
            self.assertEqual(reports[0]['exit_code'],125)

    def test_network_payload_cannot_select_arbitrary_commands(self):
        with tempfile.TemporaryDirectory() as temp:
            journal=Path(temp)/'outbox.json'
            def transport(c,p,b):return {'node':{'uuid':'a'},'job':{'id':'1','lease':'nonce','kind':'shell','command':'bad'}}
            with self.assertRaises(RuntimeError):worker.step({'uuid':'a','worker_id':'one'},journal,lambda:self.fail('must not run'),transport)
            self.assertFalse(journal.exists())


if __name__=='__main__':unittest.main()
