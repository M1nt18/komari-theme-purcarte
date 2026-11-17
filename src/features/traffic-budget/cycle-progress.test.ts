import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycleProgress, cycleDate } from './cycle-progress.ts';

const quota = {limit_bytes:1000,used_bytes:1,period_start:'2026-10-24T16:00:00Z',period_end:'2026-11-24T16:00:00Z'};
test('continuous fraction does not round a small usage up to one 5% segment',()=>{
  const value=cycleProgress(quota,Date.parse('2026-11-17T00:00:00Z'));
  assert.equal(value.fill,.1);assert.ok(value.elapsed!>70&&value.elapsed!<80);
  assert.equal(cycleDate(quota.period_end),'11/25');
});
test('period boundaries and month length use server timestamps; old period is unavailable at reset',()=>{
  assert.equal(cycleProgress(quota,Date.parse(quota.period_start)).elapsed,0);
  assert.equal(cycleProgress(quota,Date.parse(quota.period_end)).current,false);
  const feb={...quota,period_start:'2028-01-30T16:00:00Z',period_end:'2028-02-28T16:00:00Z'};
  assert.equal(cycleProgress(feb,Date.parse('2028-02-14T04:00:00Z')).elapsed,50);
});
test('unlimited, invalid and over-quota values do not create an invented marker or overflowing fill',()=>{
  const now=Date.parse('2026-11-17T00:00:00Z');
  assert.equal(cycleProgress({...quota,limit_bytes:0},now).usage,null);
  assert.equal(cycleProgress({...quota,used_bytes:1200},now).fill,100);
  assert.equal(cycleProgress({...quota,used_bytes:1200},now).usage,120);
  assert.equal(cycleProgress({...quota,period_end:'invalid'},now).elapsed,null);
  assert.equal(cycleProgress({...quota,used_bytes:NaN},now).current,false);
});

test('usage changes to warning exactly when its progress passes the time marker',()=>{
  const half=Date.parse(quota.period_start)+(Date.parse(quota.period_end)-Date.parse(quota.period_start))/2;
  assert.equal(cycleProgress({...quota,used_bytes:500},half).tone,'normal');
  assert.equal(cycleProgress({...quota,used_bytes:501},half).tone,'warning');
  const late=Date.parse(quota.period_start)+(Date.parse(quota.period_end)-Date.parse(quota.period_start))*.98;
  assert.equal(cycleProgress({...quota,used_bytes:950},late).tone,'normal');
  assert.equal(cycleProgress({...quota,used_bytes:1000},late).tone,'exhausted');
});
