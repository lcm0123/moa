import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createProductionServer, productionEnvironment} from '../server/node-http.mjs';
import {d1Adapter} from '../server/sqlite-adapter.mjs';
import {installOfflineNetworkGuard} from './public-offline-guard.mjs';

const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const args = process.argv.slice(2);
if (args.some(arg => !/^--port=\d+$/.test(arg) && arg !== '--memory-db')) {
  throw new Error('Supported options: --port=4181 and --memory-db');
}
const memory = args.includes('--memory-db');
const port = Number(args.find(arg => arg.startsWith('--port='))?.slice(7)
  || process.env.MOA_PREVIEW_PORT || 4181);
if (!Number.isInteger(port) || port > 65535 || port < (memory ? 0 : 1024)) {
  throw new Error('Use a port from 1024 to 65535.');
}
const assetsRoot = path.join(root, 'dist/client');
if (!fs.existsSync(path.join(assetsRoot, 'index.html'))) {
  throw new Error('Build first: pnpm build');
}

// No .env loading, inherited provider credentials, or configurable database path.
const runtime = path.join(root, '.preview-runtime');
if (!memory) fs.mkdirSync(runtime, {recursive: true});
const sqlite = new DatabaseSync(memory ? ':memory:' : path.join(runtime, 'public-preview.sqlite'));
sqlite.exec('PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort()) {
  if (sqlite.prepare('SELECT name FROM local_migrations WHERE name=?').get(name)) continue;
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8'));
    sqlite.prepare('INSERT INTO local_migrations(name) VALUES(?)').run(name);
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    sqlite.close();
    throw error;
  }
}
const network = installOfflineNetworkGuard();
const {api} = await import('../server/api.mjs');
const env = productionEnvironment({
  MOA_PUBLIC_ORIGIN: 'http://127.0.0.1:' + port,
  MOA_JOBS_ENABLED: 'false', CRYPTO_PUBLIC_DISPLAY: 'false',
  NEWS_COMPANIES_ENABLED: 'false', NEWS_AUTO_COLLECT_ENABLED: 'false',
  NEWS_INLINE_V2_ENABLED: 'false', IDEA_COMPANIES_ENABLED: 'false',
  IDEA_COMPANIES_EXTERNAL_ENABLED: 'false', BUSINESS_PROFILE_AUTO_ENABLED: 'false',
  REACTION_GAP_ENABLED: 'false', TELEGRAM_REPORTS_ENABLED: 'false',
  TELEGRAM_REPORTS_PUBLIC_DISPLAY: 'false', TELEGRAM_REPORTS_PUBLIC_PDF_DISPLAY: 'false',
  CATALYST_ENABLED: 'false', CATALYST_FREE_RESEARCH_ENABLED: 'false',
  CATALYST_RESEARCH_WORKER_ENABLED: 'false', CATALYST_METADATA_WORKER_ENABLED: 'false',
  ENABLE_OPENAI_WEB_SEARCH: 'false', US_INDICES_ENABLED: 'false',
  KRX_PUBLIC_DISPLAY: 'false', KR_INVESTORS_PUBLIC_DISPLAY: 'false',
}, {DB: d1Adapter(sqlite), NOTIFICATION_PUSH_READY: false});
const status = () => ({mode: 'offline-source-preview', jobsEnabled: false,
  credentialsLoaded: false, outboundAttemptsBlocked: network.attempts,
  database: memory ? 'isolated-memory' : 'export-local', externalDataIncluded: false});
const server = createProductionServer({env, assetsRoot,
  api: request => new URL(request.url).pathname === '/api/preview-status'
    ? Response.json(status(), {headers: {'Cache-Control': 'no-store'}}) : api(request, env),
  health: () => sqlite.prepare('SELECT 1').get(),
});
server.prependListener('request', (_request, response) => {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
});
server.listen(port, '127.0.0.1', () => {
  const actualPort = server.address().port;
  env.MOA_PUBLIC_ORIGIN = 'http://127.0.0.1:' + actualPort;
  console.log('MOA offline source preview: ' + env.MOA_PUBLIC_ORIGIN);
  console.log('No API credentials, external collection, AI calls, or background workers.');
  process.send?.({type: 'ready', port: actualPort});
});
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections();
  server.close(() => {sqlite.close(); process.exit(0);});
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.on('message', message => {if (message === 'shutdown') shutdown();});
