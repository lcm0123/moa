-- Issuer IDs reference the existing asset master; no duplicate company master.
CREATE TABLE business_profile_jobs (
 id TEXT PRIMARY KEY, issuer TEXT NOT NULL, asset_id TEXT NOT NULL REFERENCES catalyst_assets(id),
 period_key TEXT NOT NULL, purpose TEXT NOT NULL, version TEXT NOT NULL, phase INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'QUEUED', priority INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT,
 available_at INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 checkpoint TEXT NOT NULL DEFAULT '{}', result TEXT NOT NULL DEFAULT '{}', error_code TEXT,
 UNIQUE(issuer,period_key,purpose,version)
);
CREATE INDEX business_profile_queue ON business_profile_jobs(state,phase,available_at,priority,created_at);
CREATE TABLE business_profile_runs (
 id TEXT PRIMARY KEY, state TEXT NOT NULL, mode TEXT NOT NULL, company_limit INTEGER NOT NULL,
 request_limit INTEGER NOT NULL, reserved_requests INTEGER NOT NULL DEFAULT 0,
 used_requests INTEGER NOT NULL DEFAULT 0, processed INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE business_profile_reservations (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES business_profile_runs(id), job_id TEXT NOT NULL,
 reserved INTEGER NOT NULL, actual INTEGER, state TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE business_profile_coverage (
 issuer TEXT NOT NULL, dimension TEXT NOT NULL, period_key TEXT NOT NULL, state TEXT NOT NULL,
 observation_count INTEGER NOT NULL DEFAULT 0, source_ids TEXT NOT NULL DEFAULT '[]',
 last_success TEXT, updated_at TEXT NOT NULL, reason TEXT,
 PRIMARY KEY(issuer,dimension,period_key)
);
CREATE TABLE business_profile_documents (
 issuer TEXT NOT NULL, source_id TEXT NOT NULL, document_hash TEXT NOT NULL, version TEXT NOT NULL,
 state TEXT NOT NULL, records INTEGER NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(issuer,source_id,document_hash,version)
);
-- Search projection; observations and claims remain the source of truth.
CREATE TABLE business_profile_index (
 issuer TEXT NOT NULL, item_id TEXT NOT NULL, asset_id TEXT NOT NULL, dimension TEXT NOT NULL,
 label TEXT NOT NULL, concept_id TEXT, text TEXT NOT NULL, source_id TEXT NOT NULL,
 observation_id TEXT, payload TEXT NOT NULL,
 PRIMARY KEY(issuer,item_id,source_id)
);
CREATE INDEX business_profile_index_asset ON business_profile_index(asset_id,dimension);
CREATE TABLE business_profile_derived (
 id TEXT PRIMARY KEY, issuer TEXT NOT NULL, item_id TEXT NOT NULL, period_key TEXT NOT NULL,
 kind TEXT NOT NULL, version TEXT NOT NULL, inputs TEXT NOT NULL, payload TEXT NOT NULL,
 computed_at TEXT NOT NULL
);
