import json
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
from unlock_service import UnlockService, UnlockError, parse_output

OUTPUT='''[ Globe (IPv4) ] ====================
Netflix                  YES (Region: TW)
Disney+                  Restricted (Originals Only)
[ Globe (IPv6) ] ====================
Netflix                  NO
[ AI (IPv4) ] ====================
OpenAI ChatGPT           YES (Region: US)
'''
WORKER='11111111-1111-4111-8111-111111111111'


class UnlockTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.source=self.root/'core.sqlite';self.state=self.root/'unlock.sqlite'
        db=sqlite3.connect(self.source)
        db.execute('CREATE TABLE clients(uuid TEXT,name TEXT,token TEXT)')
        db.executemany('INSERT INTO clients VALUES(?,?,?)',[('a','A','test-node-token-A'),('b','B','test-node-token-B')])
        db.commit();db.close()
        self.api=UnlockService(self.source,self.state)
        self.a={'uuid':'a','name':'A'};self.b={'uuid':'b','name':'B'}

    def tearDown(self):self.temp.cleanup()

    def finish(self,job,identity=None,code=0,output=OUTPUT,now=105):
        return self.api.report(identity or self.a,dict(id=job['id'],lease=job['lease'],exit_code=code,output=output),now)

    def test_identity_binding_and_parser(self):
        self.assertEqual(self.api.identify('Bearer test-node-token-A'),self.a)
        for bad in ['','Bearer wrong-test-token',"Bearer ' OR 1=1 --"]:
            with self.assertRaises(UnlockError):self.api.identify(bad)
        services=parse_output(OUTPUT)
        self.assertEqual(len(services),3)
        self.assertEqual(services[0]['ipv4']['region'],'TW')
        self.assertEqual(services[0]['ipv6']['status'],'NO')
        self.assertEqual(services[1]['ipv4']['status'],'RESTRICTED')

    def test_initial_once_manual_only_after_success_and_restart(self):
        job=self.api.poll(self.a,WORKER,100)['job']
        self.assertEqual(self.api.poll(self.a,WORKER,101)['job'],job)
        self.finish(job)
        self.api=UnlockService(self.source,self.state)
        self.assertIsNone(self.api.poll(self.a,WORKER,200)['job'])
        self.assertEqual(self.api.trigger('a',True,201)['reason'],'saved_result')
        self.assertTrue(self.api.trigger('a',False,201)['triggered'])
        self.assertEqual(self.api.trigger('a',False,202)['reason'],'already_running')
        self.assertIsNotNone(self.api.poll(self.a,WORKER,203)['job'])

    def test_cross_node_and_nonce_replay_rejected_report_retry_idempotent(self):
        job=self.api.poll(self.a,WORKER,100)['job']
        with self.assertRaises(UnlockError):self.finish(job,self.b)
        with self.assertRaises(UnlockError):self.finish({**job,'lease':'wrong'})
        self.finish(job);self.finish(job)
        with self.assertRaises(UnlockError):self.finish(job,output=OUTPUT+'changed')

    def test_failure_keeps_success_and_timeout_never_autoscans(self):
        job=self.api.poll(self.a,WORKER,100)['job'];self.finish(job)
        self.api.poll(self.a,WORKER,200);self.api.trigger('a',False,200)
        failed=self.api.poll(self.a,WORKER,201)['job'];self.finish(failed,code=1,output='',now=205)
        node=self.api.snapshot([self.a],206)['nodes']['a']
        self.assertEqual(node['firstSuccessAt'],'1970-01-01T00:01:45Z')
        self.assertEqual(len(node['services']),3)
        self.assertTrue(node['error'])
        self.assertIsNone(self.api.poll(self.a,WORKER,300)['job'])
        self.api.trigger('a',False,301);self.api.poll(self.a,WORKER,302)
        self.assertIsNone(self.api.poll(self.a,WORKER,800)['job'])

    def test_registration_does_not_allow_duplicate_installation_and_visibility_filters(self):
        self.api.poll(self.a,WORKER,100)
        with self.assertRaises(UnlockError):self.api.poll(self.a,'22222222-2222-4222-8222-222222222222',101)
        self.assertEqual(self.api.snapshot([self.b],102)['nodes'].keys(),{'b'})
        self.assertIsNone(self.api.snapshot([self.b],102)['activeTask'])

    def test_visible_snapshot_batches_queries_and_excludes_hidden_jobs(self):
        self.api.poll(self.a, WORKER, 100)
        self.api.poll(self.b, WORKER, 100)
        nodes = [self.a] + [{'uuid': str(i)} for i in range(1000)]
        statements = []
        original_db = self.api.db

        @contextmanager
        def traced_db():
            with original_db() as db:
                db.set_trace_callback(statements.append)
                yield db

        with patch.object(self.api, 'db', traced_db):
            snapshot = self.api.snapshot(nodes, 101)
        self.assertEqual(list(snapshot['nodes']), [node['uuid'] for node in nodes])
        self.assertEqual(snapshot['activeTask']['clients'], ['a'])
        self.assertEqual(sum('WITH visible' in sql for sql in statements), 3)
        self.assertFalse(snapshot['nodes']['999']['workerInstalled'])

    def test_offline_and_cooldown_checks(self):
        job=self.api.poll(self.a,WORKER,100)['job'];self.finish(job)
        with self.assertRaises(UnlockError):self.api.trigger('a',False,110)
        with self.assertRaises(UnlockError):self.api.trigger('a',False,300)

    def test_report_after_retention_returns_terminal_409_compatible_with_v1_workers(self):
        job=self.api.poll(self.a,WORKER,100)['job']
        self.api.maintain(100+9*86400)
        with self.assertRaises(UnlockError) as caught:self.finish(job,now=100+9*86400)
        self.assertEqual((caught.exception.status,caught.exception.code),(409,'task_gone'))
        self.assertIsNone(self.api.poll(self.a,WORKER,100+9*86400)['job'])

    def test_snapshot_is_read_only_and_does_not_clean_or_change_worker_state(self):
        self.api.poll(self.a,WORKER,100)
        before=self.state.read_bytes()
        self.api.snapshot([self.a],1000)
        self.assertEqual(self.state.read_bytes(),before)

    def test_rebind_refuses_online_and_preserves_saved_results(self):
        job=self.api.poll(self.a,WORKER,100)['job'];self.finish(job)
        replacement='22222222-2222-4222-8222-222222222222'
        with self.assertRaises(UnlockError):self.api.rebind(self.a,replacement,110)
        self.assertTrue(self.api.rebind(self.a,replacement,300)['rebound'])
        self.assertIsNone(self.api.poll(self.a,replacement,301)['job'])
        self.assertEqual(len(self.api.snapshot([self.a],302)['nodes']['a']['services']),3)


if __name__=='__main__':unittest.main()
