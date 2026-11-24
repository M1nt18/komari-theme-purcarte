import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiService, WebSocketService } from './api.ts';

function setup(t: any) {
  const original = globalThis.WebSocket;
  const sockets: any[] = [];
  class Socket {
    static OPEN = 1;
    static CLOSING = 2;
    readyState = 0;
    onopen: any; onclose: any; onmessage: any; onerror: any;
    messages: string[] = [];
    constructor() { sockets.push(this); }
    close() { this.readyState = 3; }
    send(message: string) { this.messages.push(message); }
    open() { this.readyState = 1; this.onopen?.(); }
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const service = new WebSocketService('ws://test.invalid/api/clients');
  t.after(() => { service.disconnect(); globalThis.WebSocket = original; });
  return { service, sockets };
}

test('disconnect cancels a pending reconnect and late close callbacks', t => {
  const { service, sockets } = setup(t);
  service.connect(); sockets[0].onclose();
  service.disconnect(); t.mock.timers.tick(10000);
  assert.equal(sockets.length, 1);
  sockets[0].onclose(); t.mock.timers.tick(10000);
  assert.equal(sockets.length, 1);
});

test('changing RPC mode reconnects once and ignores events from the old socket', t => {
  const { service, sockets } = setup(t);
  service.connect(); sockets[0].open();
  assert.deepEqual(sockets[0].messages, ['get']);
  service.useRpc = true;
  assert.equal(sockets.length, 2);
  sockets[0].onclose(); t.mock.timers.tick(10000);
  assert.equal(sockets.length, 2);
  sockets[1].open();
  assert.equal(JSON.parse(sockets[1].messages[0]).method, 'common:getNodesLatestStatus');
  let calls = 0; service.subscribe(() => { calls++; });
  sockets[0].onmessage({ data: '{"result":{}}' });
  sockets[1].onmessage({ data: '{"result":{}}' });
  assert.equal(calls, 1);
});

test('outages keep retrying at a capped interval and reset after success', t => {
  const { service, sockets } = setup(t);
  service.connect();
  for (const delay of [2000, 4000, 8000, 16000, 30000, 30000, 30000]) {
    const count = sockets.length;
    sockets.at(-1).onclose();
    t.mock.timers.tick(delay - 1);
    assert.equal(sockets.length, count);
    t.mock.timers.tick(1);
    assert.equal(sockets.length, count + 1);
  }
  const count = sockets.length;
  sockets.at(-1).open();
  sockets.at(-1).onclose();
  t.mock.timers.tick(2000);
  assert.equal(sockets.length, count + 1);
});

test('returning online or to the foreground cancels backoff without duplicating sockets', t => {
  const windowEvents = new EventTarget();
  const page = Object.assign(new EventTarget(), { hidden: true });
  Object.assign(globalThis, { window: windowEvents, document: page });
  const { service, sockets } = setup(t);
  try {
    service.connect();
    sockets[0].onclose();
    page.dispatchEvent(new Event('visibilitychange'));
    windowEvents.dispatchEvent(new Event('online'));
    t.mock.timers.tick(60000);
    assert.equal(sockets.length, 1);
    page.hidden = false;
    page.dispatchEvent(new Event('visibilitychange'));
    windowEvents.dispatchEvent(new Event('online'));
    t.mock.timers.tick(2000);
    assert.equal(sockets.length, 2);
    sockets[1].onclose();
    windowEvents.dispatchEvent(new Event('online'));
    assert.equal(sockets.length, 3);
    service.disconnect();
    page.dispatchEvent(new Event('visibilitychange'));
    windowEvents.dispatchEvent(new Event('online'));
    assert.equal(sockets.length, 3);
  } finally {
    service.disconnect();
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');
  }
});

test('legacy REST endpoints preserve UUIDs containing URL delimiters', async t => {
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    paths.push(path);
    return Response.json({ status: 'success', data: [] });
  });
  const uuid = 'node/a?b&c#d';
  await apiService.getNodeRecentStats(uuid);
  await apiService.getLoadHistory(uuid);
  await apiService.getLoadHistory(uuid, 168);
  await apiService.getPingHistory(uuid);
  assert.deepEqual(paths, [
    '/api/recent/node%2Fa%3Fb%26c%23d',
    '/api/records/load?uuid=node%2Fa%3Fb%26c%23d&hours=24',
    '/api/records/load?uuid=node%2Fa%3Fb%26c%23d&hours=168',
    '/api/records/ping?uuid=node%2Fa%3Fb%26c%23d&hours=24',
  ]);
});
