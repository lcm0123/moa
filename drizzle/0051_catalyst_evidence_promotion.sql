CREATE TABLE IF NOT EXISTS catalyst_source_organizations (
 organization_id TEXT PRIMARY KEY, organization_name TEXT NOT NULL,
 canonical_domain TEXT NOT NULL, alternate_domains TEXT NOT NULL DEFAULT '[]',
 ir_domains TEXT NOT NULL DEFAULT '[]', product_domains TEXT NOT NULL DEFAULT '[]',
 documentation_domains TEXT NOT NULL DEFAULT '[]', verification_method TEXT NOT NULL,
 verified_at TEXT NOT NULL, last_checked_at TEXT NOT NULL, valid_from TEXT NOT NULL,
 valid_to TEXT NOT NULL, proof TEXT NOT NULL, asset_id TEXT
);
CREATE TABLE IF NOT EXISTS catalyst_source_authority (
 url_hash TEXT PRIMARY KEY, domain TEXT NOT NULL, organization_id TEXT,
 status TEXT NOT NULL, reject_reason TEXT, checked_at TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS catalyst_evidence_promotions (
 run_id TEXT NOT NULL, source_key TEXT NOT NULL, stage TEXT NOT NULL,
 status TEXT NOT NULL, reject_reason TEXT, updated_at TEXT NOT NULL, payload TEXT NOT NULL,
 PRIMARY KEY(run_id, source_key, stage)
);
CREATE TABLE IF NOT EXISTS catalyst_event_anchors (
 run_id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL
);
