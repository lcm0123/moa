-- Legacy claims remain available, but carry no current validation record.
CREATE TABLE IF NOT EXISTS catalyst_claim_ledger (
 claim_id TEXT PRIMARY KEY REFERENCES catalyst_claims(id),
 subject TEXT NOT NULL, predicate TEXT NOT NULL, object TEXT NOT NULL,
 typed_value TEXT NOT NULL, period TEXT NOT NULL, scope TEXT NOT NULL,
 effective_at TEXT, verification_status TEXT NOT NULL,
 validation_version TEXT NOT NULL, validation_checks TEXT NOT NULL,
 independent_source_count INTEGER NOT NULL DEFAULT 0, checked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS catalyst_claim_sources (
 claim_id TEXT NOT NULL REFERENCES catalyst_claims(id),
 source_id TEXT NOT NULL REFERENCES catalyst_sources(id),
 quote TEXT NOT NULL, locator TEXT, independence_key TEXT NOT NULL,
 verification_status TEXT NOT NULL, validation_version TEXT NOT NULL,
 validation_checks TEXT NOT NULL,
 PRIMARY KEY(claim_id,source_id)
);
CREATE INDEX IF NOT EXISTS catalyst_claim_source_lookup ON catalyst_claim_sources(source_id,claim_id);
CREATE TABLE IF NOT EXISTS catalyst_source_lineage (
 source_id TEXT PRIMARY KEY REFERENCES catalyst_sources(id),
 independence_key TEXT NOT NULL, original_url TEXT,
 content_hash TEXT NOT NULL, version TEXT NOT NULL
);
