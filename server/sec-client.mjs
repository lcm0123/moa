// Shared SEC transport for web financials and 13F providers. The SQLite slots
// also coordinate with sec.worker; browser visits cannot bypass its cooldown.
export function validSecUserAgent(value) {
  return typeof value === 'string' && /^[\x20-\x7e]+$/.test(value)
    && /^.+\s+[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function secErrorReason(body = '') {
  if (/undeclared automated tool/i.test(body)) return 'UNDECLARED_AUTOMATED_TOOL';
  if (/request rate threshold exceeded|rate threshold/i.test(body)) return 'RATE_LIMIT';
  if (/access denied/i.test(body)) return 'ACCESS_DENIED';
  return 'HTTP_ERROR';
}

async function errorPreview(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  let preview = '';
  try {
    while (preview.length < 8192) {
      const {done, value} = await reader.read();
      if (done) break;
      preview += new TextDecoder().decode(value.subarray(0, 8192 - preview.length));
    }
  } catch { /* The status is sufficient if the error document is truncated. */ }
  finally { await reader.cancel().catch(() => {}); }
  return preview;
}

export function createSecTransport({fetchImpl = (...args) => fetch(...args), now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  let queue = Promise.resolve(), localSlot = 0, localCooldown = 0;
  return function secFetch(env, url, accept = 'application/json') {
    const run = async () => {
      const target = new URL(url);
      if (target.protocol !== 'https:' || !['data.sec.gov', 'www.sec.gov'].includes(target.hostname) || target.username || target.password)
        throw new Error('SEC_URL_REJECTED');
      if (!validSecUserAgent(env.SEC_USER_AGENT)) throw new Error('SEC_USER_AGENT_CONTACT_REQUIRED');
      const db = env.DB;
      const checkCooldown = async () => {
        const until = db ? Number((await db.prepare("SELECT value FROM sec_runtime WHERE key='sec_cooldown'").all()).results[0]?.value || 0) : localCooldown;
        if (until > now() / 1000) throw new Error('SEC_ACCESS_COOLDOWN');
      };
      await checkCooldown();
      const start = now() / 1000;
      let slot;
      if (db) {
        // One atomic statement, so reservations also serialize with Python's transaction.
        const {results} = await db.prepare("INSERT INTO sec_runtime(key,value) VALUES('request_slot',?) ON CONFLICT(key) DO UPDATE SET value=CAST(MAX(CAST(sec_runtime.value AS REAL),?)+1 AS TEXT) RETURNING value")
          .bind(String(start + 1), start).all();
        slot = Number(results[0].value) - 1;
      } else { slot = Math.max(start, localSlot); localSlot = slot + 1; }
      if (slot > start) await sleep((slot - start) * 1000);
      await checkCooldown();
      let response;
      try {
        response = await fetchImpl(url, {headers: {Accept: accept, 'User-Agent': env.SEC_USER_AGENT, 'Accept-Encoding': 'gzip, deflate'}, redirect: 'error', signal: AbortSignal.timeout(25000)});
      } catch { throw new Error('SEC_CONNECTION_ERROR'); }
      if (!response.ok) {
        const reason = secErrorReason(await errorPreview(response));
        if ([403, 429].includes(response.status)) {
          const retry = response.headers.get('retry-after');
          const retrySeconds = /^\d+$/.test(retry || '') ? Number(retry) : (Date.parse(retry) - now()) / 1000;
          const until = now() / 1000 + Math.max(900, Math.min(86400, Number.isFinite(retrySeconds) ? retrySeconds : 900));
          if (db) {
            await db.prepare("INSERT INTO sec_runtime VALUES('sec_cooldown',?) ON CONFLICT(key) DO UPDATE SET value=CAST(MAX(CAST(sec_runtime.value AS REAL),?) AS TEXT)").bind(String(until), until).run();
            const diagnostic = JSON.stringify({status: response.status, reason, host: target.hostname, path: target.pathname, receivedAt: new Date(now()).toISOString()});
            await db.prepare("INSERT INTO sec_runtime VALUES('sec_last_error',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(diagnostic).run();
          } else localCooldown = until;
        }
        throw new Error('SEC_HTTP_' + response.status + '_' + reason);
      }
      return response;
    };
    const operation = queue.catch(() => {}).then(run);
    queue = operation;
    return operation;
  };
}

export const secFetch = createSecTransport();
