CREATE TABLE catalyst_research_jobs (
 id TEXT PRIMARY KEY, research_key TEXT NOT NULL, query TEXT NOT NULL,
 market_filter TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL,
 plan TEXT, result TEXT, error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 lease_until INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
 version TEXT NOT NULL
);
CREATE UNIQUE INDEX catalyst_research_active ON catalyst_research_jobs(research_key) WHERE status IN ('queued','running');
CREATE INDEX catalyst_research_lookup ON catalyst_research_jobs(research_key,created_at);
CREATE TABLE catalyst_research_steps (
 id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES catalyst_research_jobs(id),
 stage TEXT NOT NULL, action TEXT NOT NULL, provider TEXT, input TEXT NOT NULL,
 output TEXT NOT NULL, duration_ms INTEGER NOT NULL, tool_cost_usd REAL, created_at TEXT NOT NULL
);
CREATE INDEX catalyst_research_step_job ON catalyst_research_steps(job_id,id);
CREATE TABLE catalyst_research_candidates (
 job_id TEXT NOT NULL REFERENCES catalyst_research_jobs(id), asset_id TEXT NOT NULL REFERENCES catalyst_assets(id),
 status TEXT NOT NULL, origins TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(job_id,asset_id)
);
CREATE TABLE catalyst_research_evidence (
 job_id TEXT NOT NULL REFERENCES catalyst_research_jobs(id), source_id TEXT NOT NULL REFERENCES catalyst_sources(id),
 stage TEXT NOT NULL, asset_id TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL,
 PRIMARY KEY(job_id,source_id,stage,asset_id)
);
CREATE TABLE catalyst_research_claims (
 job_id TEXT NOT NULL REFERENCES catalyst_research_jobs(id), claim_id TEXT NOT NULL REFERENCES catalyst_claim_ledger(claim_id),
 stage TEXT NOT NULL, asset_id TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL,
 PRIMARY KEY(job_id,claim_id,stage)
);
CREATE TABLE catalyst_research_search_usage (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES catalyst_research_jobs(id), provider TEXT NOT NULL,
 query TEXT NOT NULL, result_count INTEGER NOT NULL, tool_calls INTEGER NOT NULL,
 estimated_tool_cost_usd REAL, cost_status TEXT NOT NULL, latency_ms INTEGER NOT NULL,
 status TEXT NOT NULL, created_at TEXT NOT NULL
);
