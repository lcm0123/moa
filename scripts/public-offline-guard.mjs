// Export preview only: reject outbound clients before importing application APIs.
// This complements the browser CSP; it is not an operating-system sandbox.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

export function installOfflineNetworkGuard() {
  let attempts = 0;
  const deny = () => {
    attempts++;
    const error = new Error('External network is disabled in this source preview.');
    error.code = 'MOA_OFFLINE_NETWORK_DISABLED';
    throw error;
  };
  globalThis.fetch = async () => deny();
  globalThis.WebSocket = class OfflineWebSocket { constructor() { deny(); } };
  http.request = http.get = https.request = https.get = deny;
  net.connect = net.createConnection = tls.connect = deny;
  net.Socket.prototype.connect = deny;
  return Object.freeze({get attempts() { return attempts; }});
}
