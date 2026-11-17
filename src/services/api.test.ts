import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketService } from './api.ts';

function setup(t: any) {
  const original = globalThis.WebSocket;
  const sockets: any[] = [];
  class Socket {
    static OPEN = 1;
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
