-- Additive only: existing quotes, reports and filings remain authoritative.
CREATE TABLE IF NOT EXISTS catalyst_assets (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('KR_STOCK','US_STOCK','CRYPTO')),
 symbol TEXT NOT NULL, name TEXT NOT NULL, exchange TEXT, issuer_id TEXT,
 chain TEXT, contract_address TEXT, protocol_id TEXT,
 identity_status TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS catalyst_assets_symbol ON catalyst_assets(symbol,kind);
CREATE TABLE IF NOT EXISTS catalyst_identifiers (
 namespace TEXT NOT NULL, value TEXT NOT NULL, asset_id TEXT NOT NULL REFERENCES catalyst_assets(id),
 valid_from TEXT NOT NULL DEFAULT '', valid_to TEXT, source_url TEXT,
 PRIMARY KEY(namespace,value,asset_id,valid_from)
);
CREATE INDEX IF NOT EXISTS catalyst_identifier_asset ON catalyst_identifiers(asset_id);
CREATE TABLE IF NOT EXISTS catalyst_sources (
 id TEXT PRIMARY KEY, asset_id TEXT, source_type TEXT NOT NULL, publisher TEXT NOT NULL,
 title TEXT NOT NULL, url TEXT NOT NULL, published_at TEXT, effective_at TEXT,
 observed_at TEXT NOT NULL, fiscal_period TEXT, content_hash TEXT NOT NULL,
 independence_key TEXT NOT NULL, body TEXT NOT NULL, locator TEXT,
 origin_ref TEXT, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS catalyst_source_asset_date ON catalyst_sources(asset_id,published_at);
CREATE INDEX IF NOT EXISTS catalyst_source_hash ON catalyst_sources(content_hash);
CREATE TABLE IF NOT EXISTS catalyst_claims (
 id TEXT PRIMARY KEY, run_id TEXT, claim_type TEXT NOT NULL, subject_id TEXT NOT NULL,
 predicate TEXT NOT NULL, object_value TEXT NOT NULL, status TEXT NOT NULL,
 confidence TEXT NOT NULL, as_of TEXT, source_ids TEXT NOT NULL,
 quote TEXT NOT NULL, payload TEXT NOT NULL, version TEXT NOT NULL, checked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS catalyst_claim_subject ON catalyst_claims(subject_id,claim_type,status);
CREATE TABLE IF NOT EXISTS catalyst_nodes (id TEXT PRIMARY KEY,kind TEXT NOT NULL,label TEXT NOT NULL,asset_id TEXT,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS catalyst_edges (
 id TEXT PRIMARY KEY,from_id TEXT NOT NULL,to_id TEXT NOT NULL,relation TEXT NOT NULL,
 status TEXT NOT NULL,claim_ids TEXT NOT NULL,valid_from TEXT,valid_to TEXT,
 version TEXT NOT NULL,payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS catalyst_edges_from ON catalyst_edges(from_id,relation,status);
CREATE TABLE IF NOT EXISTS catalyst_facts (
 asset_id TEXT NOT NULL,category TEXT NOT NULL,payload TEXT NOT NULL,source_ids TEXT NOT NULL,
 verified_at TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(asset_id,category)
);
CREATE TABLE IF NOT EXISTS catalyst_runs (
 id TEXT PRIMARY KEY,reader_hash TEXT NOT NULL,query TEXT NOT NULL,asset_id TEXT,intent TEXT NOT NULL,
 state TEXT NOT NULL,stage TEXT NOT NULL,payload TEXT NOT NULL,cache_key TEXT NOT NULL,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS catalyst_runs_reader ON catalyst_runs(reader_hash,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS catalyst_runs_active ON catalyst_runs(reader_hash,cache_key) WHERE state IN ('queued','running');
CREATE TABLE IF NOT EXISTS catalyst_cache (cache_key TEXT PRIMARY KEY,payload TEXT NOT NULL,created_at TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS catalyst_reservations (
 id TEXT PRIMARY KEY,run_id TEXT NOT NULL,day TEXT NOT NULL,amount INTEGER NOT NULL,
 state TEXT NOT NULL,created_at INTEGER NOT NULL,completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS catalyst_reservations_day ON catalyst_reservations(day,created_at);
CREATE TABLE IF NOT EXISTS catalyst_usage (
 id TEXT PRIMARY KEY,run_id TEXT NOT NULL,model TEXT NOT NULL,input_tokens INTEGER NOT NULL,
 cached_input_tokens INTEGER NOT NULL,output_tokens INTEGER NOT NULL,total_tokens INTEGER NOT NULL,
 reasoning_effort TEXT NOT NULL,feature TEXT NOT NULL,latency_ms INTEGER NOT NULL,
 http_status INTEGER,result TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS catalyst_usage_date ON catalyst_usage(created_at);
CREATE TABLE IF NOT EXISTS catalyst_runtime (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);
