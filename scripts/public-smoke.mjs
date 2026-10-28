// Isolated smoke: ephemeral loopback port + in-memory SQLite; never uses .env.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const child = fork(path.join(root, 'scripts/public-preview.mjs'), ['--port=0', '--memory-db'], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  env: {...(process.env.SystemRoot ? {SystemRoot: process.env.SystemRoot} : {}),
    FINVIZ_API_KEY: 'ignored-fixture-value', OPENAI_API_KEY: 'ignored-fixture-value',
    MOA_JOBS_ENABLED: 'true', CRYPTO_PUBLIC_DISPLAY: 'true',
    NEWS_COMPANIES_ENABLED: 'true', NEWS_AUTO_COLLECT_ENABLED: 'true',
    MOA_DB_FILE: 'must-not-be-opened.sqlite'},
});
let output = '';
child.stdout.on('data', data => {output += data;});
child.stderr.on('data', data => {output += data;});
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview readiness timeout')), 20000);
    child.once('error', error => {clearTimeout(timer); reject(error);});
    child.once('exit', code => {clearTimeout(timer); reject(new Error('Preview exited: ' + code));});
    child.once('message', message => {clearTimeout(timer); assert.equal(message.type, 'ready'); resolve(message.port);});
  });
  const origin = 'http://127.0.0.1:' + port;
  const homepage = await fetch(origin);
  assert.equal(homepage.status, 200);
  const html = await homepage.text();
  assert.ok(html.includes('<title>MOA</title>'));
  assert.ok(!html.includes('cdn.jsdelivr.net'));
  assert.match(homepage.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(homepage.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await fetch(origin + '/healthz')).status, 200);
  for (const route of ['/api/catalyst', '/api/catalyst/chat', '/api/theses']) {
    assert.equal((await fetch(origin + route)).status, 410);
  }
  for (const route of ['/api/crypto', '/api/crypto/events']) {
    assert.equal((await fetch(origin + route)).status, 403);
  }
  for (const route of ['/api/search?q=fixture', '/api/indices?market=KR',
    '/api/indices?market=US', '/api/futures?market=US', '/api/sector-history?market=KR&indexId=KOSPI200&month=2026-10',
    '/api/business-profile?market=US&ticker=FIXTURE', '/api/financials?market=KR&ticker=123456',
    '/api/macro?q=inflation&region=US', '/api/reports']) {
    const response = await fetch(origin + route);
    assert.ok(response.status < 500, route + ': ' + response.status);
  }
  assert.equal((await fetch(origin + '/api/news-companies/articles?region=US')).status, 503);
  for (const route of ['/.env', '/server/index.js', '/.preview-runtime/public-preview.sqlite', '/.sites-runtime/assets.mjs']) {
    assert.equal((await fetch(origin + route)).status, 404);
  }
  const status = await (await fetch(origin + '/api/preview-status')).json();
  assert.deepEqual(status, {mode: 'offline-source-preview', jobsEnabled: false,
    credentialsLoaded: false, outboundAttemptsBlocked: 0, database: 'isolated-memory', externalDataIncluded: false});
  console.log('PASS: isolated preview, denied collectors, empty API states, retired routes, and browser CSP.');
} catch (error) {
  console.error(error.message);
  if (output) console.error(output.replaceAll(root, '[export]/'));
  process.exitCode = 1;
} finally {
  if (child.exitCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.send('shutdown');
    const timer = setTimeout(() => child.kill(), 5000);
    await exited;
    clearTimeout(timer);
  }
}
