-- Additive: legacy graph and asset identifiers remain available for rollback.
CREATE TABLE catalyst_graph_policy (
 edge_id TEXT PRIMARY KEY REFERENCES catalyst_graph_edges(id),
 freshness_policy_id TEXT NOT NULL,
 lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(lifecycle_status IN ('ACTIVE','STALE','SUPERSEDED','EXPIRED')),
 evidence_at TEXT NOT NULL,
 canonical_condition TEXT NOT NULL DEFAULT '{}',
 raw_condition_text TEXT,
 superseded_by_claim_id TEXT REFERENCES catalyst_claims(id),
 lifecycle_event TEXT,
 updated_at TEXT NOT NULL
);
CREATE TABLE catalyst_metadata_requests (
 asset_id TEXT PRIMARY KEY REFERENCES catalyst_assets(id), kind TEXT NOT NULL,
 status TEXT NOT NULL, source_revision TEXT, requested_at TEXT NOT NULL,
 completed_at TEXT, error_code TEXT, payload TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE company_metadata_facts (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES catalyst_assets(id),
 category TEXT NOT NULL, fact_key TEXT NOT NULL, relationship TEXT NOT NULL,
 exposure_basis TEXT NOT NULL, revenue_value TEXT, revenue_ratio TEXT, period TEXT,
 verification_status TEXT NOT NULL, claim_ids TEXT NOT NULL, last_verified_at TEXT NOT NULL,
 source_id TEXT NOT NULL REFERENCES catalyst_sources(id), source_date TEXT,
 lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE', payload TEXT NOT NULL,
 UNIQUE(company_id,category,fact_key,source_id)
);
CREATE INDEX company_metadata_lookup ON company_metadata_facts(company_id,category,lifecycle_status);
CREATE TABLE company_metadata_claims (fact_id TEXT NOT NULL REFERENCES company_metadata_facts(id),claim_id TEXT NOT NULL REFERENCES catalyst_claim_ledger(claim_id),PRIMARY KEY(fact_id,claim_id));
CREATE VIEW company_business_segments AS SELECT * FROM company_metadata_facts WHERE category='business_segments';
CREATE VIEW company_products AS SELECT *,fact_key AS product_id FROM company_metadata_facts WHERE category='products';
CREATE VIEW company_end_markets AS SELECT * FROM company_metadata_facts WHERE category='end_markets';
CREATE VIEW company_customers AS SELECT * FROM company_metadata_facts WHERE category='customers';
CREATE VIEW company_suppliers AS SELECT * FROM company_metadata_facts WHERE category='suppliers';
CREATE VIEW company_capex_exposure AS SELECT * FROM company_metadata_facts WHERE category='capex_exposure';
CREATE VIEW company_order_exposure AS SELECT * FROM company_metadata_facts WHERE category='order_exposure';
CREATE TABLE catalyst_blockchains (chain_id TEXT PRIMARY KEY,name TEXT NOT NULL,source_url TEXT,last_verified_at TEXT NOT NULL);
CREATE TABLE catalyst_protocols (protocol_id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT,official_domain TEXT,chains TEXT NOT NULL,status TEXT NOT NULL,last_verified_at TEXT NOT NULL,payload TEXT NOT NULL);
CREATE TABLE catalyst_tokens (token_id TEXT PRIMARY KEY,asset_id TEXT NOT NULL UNIQUE REFERENCES catalyst_assets(id),symbol TEXT NOT NULL,name TEXT NOT NULL,native INTEGER NOT NULL,provider_ids TEXT NOT NULL,last_verified_at TEXT NOT NULL);
CREATE TABLE catalyst_deployments (deployment_id TEXT PRIMARY KEY,token_id TEXT NOT NULL REFERENCES catalyst_tokens(token_id),chain_id TEXT NOT NULL REFERENCES catalyst_blockchains(chain_id),contract_address TEXT,standard TEXT,verification_status TEXT NOT NULL,source_url TEXT,last_verified_at TEXT NOT NULL);
CREATE TABLE catalyst_exchange_pairs (pair_id TEXT PRIMARY KEY,token_id TEXT NOT NULL REFERENCES catalyst_tokens(token_id),exchange TEXT NOT NULL,base TEXT NOT NULL,quote TEXT NOT NULL,market_type TEXT NOT NULL,source_url TEXT);
CREATE TABLE catalyst_token_protocols (token_id TEXT NOT NULL REFERENCES catalyst_tokens(token_id),protocol_id TEXT NOT NULL REFERENCES catalyst_protocols(protocol_id),verification_status TEXT NOT NULL,claim_ids TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(token_id,protocol_id));
CREATE TABLE catalyst_token_value_capture (token_id TEXT NOT NULL REFERENCES catalyst_tokens(token_id),capture_type TEXT NOT NULL,verification_status TEXT NOT NULL,claim_ids TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(token_id,capture_type));
CREATE TABLE catalyst_crypto_observations (entity_id TEXT NOT NULL,category TEXT NOT NULL,as_of TEXT NOT NULL,source_url TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(entity_id,category));
