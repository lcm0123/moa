import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import {installOfflineNetworkGuard} from '../scripts/public-offline-guard.mjs';

test('preview outbound clients fail before establishing a connection', async () => {
  const guard = installOfflineNetworkGuard();
  const denied = error => error.code === 'MOA_OFFLINE_NETWORK_DISABLED';
  await assert.rejects(fetch('https://fixture.invalid'), denied);
  assert.throws(() => new WebSocket('wss://fixture.invalid'), denied);
  assert.throws(() => http.get('http://fixture.invalid'), denied);
  assert.throws(() => https.request('https://fixture.invalid'), denied);
  assert.throws(() => net.connect({host: 'fixture.invalid', port: 80}), denied);
  assert.throws(() => new net.Socket().connect(80, 'fixture.invalid'), denied);
  assert.throws(() => tls.connect(443, 'fixture.invalid'), denied);
  assert.equal(guard.attempts, 7);
});
