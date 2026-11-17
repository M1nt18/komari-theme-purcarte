import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistoryCache } from './historyCache.ts';

test('identical requests share one fetch while other requests respect the concurrency limit', async () => {
  const cache = createHistoryCache<number>(2);
  let calls = 0;
  const finish: Array<() => void> = [];
  const fetcher = () => { calls++; return new Promise<number>(resolve => finish.push(() => resolve(calls))); };
  const first = cache.load('a', fetcher);
  assert.equal(cache.load('a', fetcher), first);
  const second = cache.load('b', fetcher);
  const third = cache.load('c', fetcher);
  await Promise.resolve();
  assert.equal(calls, 2);
  finish.shift()!();
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 3);
  finish.forEach(resolve => resolve());
  await Promise.all([second, third]);
});

test('cached history expires and evicts the least recently used node', async () => {
  let time = 0;
  const cache = createHistoryCache<number>(2, 2, 100, () => time);
  await cache.load('a', async () => 1);
  await cache.load('b', async () => 2);
  assert.equal(cache.peek('a'), 1);
  await cache.load('c', async () => 3);
  assert.equal(cache.peek('b'), undefined);
  time = 101;
  assert.equal(cache.peek('a'), undefined);
  assert.equal(await cache.load('a', async () => 4), 4);
});

test('failed or empty history is retryable and does not block the queue', async () => {
  const cache = createHistoryCache<number | null>(1);
  await assert.rejects(cache.load('a', async () => { throw new Error('offline'); }));
  assert.equal(await cache.load('b', async () => null), null);
  assert.equal(await cache.load('a', async () => 5), 5);
  assert.equal(await cache.load('b', async () => 6), 6);
});
