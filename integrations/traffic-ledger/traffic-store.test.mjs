import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrafficStore } from './traffic-store.mjs';

function fixture() {
  let clock = 0, tick, fail = false;
  const start = Date.parse('2026-11-12T16:00:00Z');
  let snapshot = { server_time: new Date(start + 1000).toISOString(), last_sync: new Date(start).toISOString(),
    nodes: { a: { used_bytes: 42, period_start: new Date(start).toISOString(), period_end: new Date(start + 60000).toISOString() } } };
  const store = createTrafficStore({
    performance: { now: () => clock },
    setTimeout: () => 1, clearTimeout() {}, setInterval: callback => { tick = callback; return 1; }, clearInterval() {},
    async fetch() { if (fail) throw new Error('offline'); return { ok: true, json: async () => ({ status: 'success', data: snapshot }) }; },
  });
  return { store, advance(ms) { clock += ms; tick?.(); }, offline() { fail = true; }, set(value) { snapshot = value; } };
}

test('period boundary invalidates old total and bar even while network is unavailable', async () => {
  const f = fixture(); let notifications = 0;
  const stop = f.store.subscribe(() => notifications++);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.store.get('a').used_bytes, 42);
  f.offline(); f.advance(59000);
  assert.equal(f.store.get('a'), undefined);
  assert.ok(notifications >= 2);
  stop();
});

test('failed initial request never falls back to NIC counters or legacy browser storage', async () => {
  const f = fixture(); f.offline(); await f.store.refresh();
  assert.equal(f.store.get('a'), undefined);
});

test('stale snapshot expires even within a long cycle', async () => {
  const f = fixture();
  f.set({ server_time: '2026-11-14T00:00:00Z', last_sync: '2026-11-14T00:00:00Z',
    nodes: { a: { used_bytes: 88, period_start: '2026-11-12T16:00:00Z', period_end: '2026-12-12T16:00:00Z' } } });
  await f.store.refresh(); f.advance(119000); assert.equal(f.store.get('a').used_bytes, 88);
  f.advance(1001); assert.equal(f.store.get('a'), undefined);
});
