CREATE TABLE IF NOT EXISTS catalyst_table_cells (
 source_id TEXT NOT NULL REFERENCES catalyst_sources(id), source_location TEXT NOT NULL,
 table_id TEXT NOT NULL, row_header TEXT NOT NULL, column_header TEXT NOT NULL,
 cell_value TEXT NOT NULL, unit TEXT, period TEXT NOT NULL, scope TEXT NOT NULL,
 footnote TEXT NOT NULL, unit_inheritance TEXT NOT NULL, payload TEXT NOT NULL,
 PRIMARY KEY(source_id,source_location)
);
CREATE TABLE IF NOT EXISTS catalyst_claim_context (
 claim_id TEXT PRIMARY KEY REFERENCES catalyst_claims(id),
 event_state TEXT, exposure_type TEXT NOT NULL, normalized_proposition TEXT,
 table_evidence TEXT, version TEXT NOT NULL
);
