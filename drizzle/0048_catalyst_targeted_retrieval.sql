CREATE TABLE catalyst_filing_documents (
 id TEXT PRIMARY KEY, document_hash TEXT NOT NULL, document_type TEXT NOT NULL,
 issuer_id TEXT NOT NULL, filing_date TEXT, url TEXT NOT NULL, local_path TEXT NOT NULL,
 byte_size INTEGER NOT NULL, parser_version TEXT NOT NULL, last_indexed_at TEXT NOT NULL,
 UNIQUE(document_hash,issuer_id,parser_version)
);
CREATE INDEX catalyst_filing_issuer ON catalyst_filing_documents(issuer_id,filing_date);
CREATE TABLE catalyst_filing_sections (
 document_id TEXT NOT NULL REFERENCES catalyst_filing_documents(id), ordinal INTEGER NOT NULL,
 kind TEXT NOT NULL, heading TEXT NOT NULL, locator TEXT NOT NULL, table_ids TEXT NOT NULL,
 html TEXT NOT NULL, truncated INTEGER NOT NULL, last_indexed_at TEXT NOT NULL,
 PRIMARY KEY(document_id,ordinal)
);
CREATE INDEX catalyst_section_kind ON catalyst_filing_sections(document_id,kind);
CREATE TABLE catalyst_official_domain_registry (
 asset_id TEXT NOT NULL, domain TEXT NOT NULL, proof_type TEXT NOT NULL,
 proof_url TEXT NOT NULL, document_hash TEXT, verified_at TEXT NOT NULL,
 PRIMARY KEY(asset_id,domain)
);
CREATE TABLE catalyst_product_aliases (
 concept TEXT NOT NULL, alias TEXT NOT NULL, status TEXT NOT NULL,
 source_id TEXT, quote TEXT NOT NULL, checked_at TEXT NOT NULL,
 PRIMARY KEY(concept,alias)
);
CREATE TABLE catalyst_research_claim_lifecycle (
 claim_id TEXT PRIMARY KEY REFERENCES catalyst_claim_ledger(claim_id),
 document_id TEXT REFERENCES catalyst_filing_documents(id), section_kind TEXT,
 issuer_id TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL
);
