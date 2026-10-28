-- Legacy rows (including REJECTED) remain untouched and are never copied into v3.
CREATE VIEW IF NOT EXISTS catalyst_legacy_edges AS
 SELECT *, 'legacy-1' AS graph_version, 'legacy-unvalidated' AS validation_version FROM catalyst_edges;
CREATE TABLE IF NOT EXISTS catalyst_graph_nodes (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL,
 asset_id TEXT REFERENCES catalyst_assets(id), namespace TEXT NOT NULL,
 graph_version TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS catalyst_graph_node_lookup ON catalyst_graph_nodes(namespace,kind,label);
CREATE TABLE IF NOT EXISTS catalyst_candidate_edges (
 id TEXT PRIMARY KEY, source_node_id TEXT NOT NULL REFERENCES catalyst_graph_nodes(id),
 relation_type TEXT NOT NULL, target_node_id TEXT NOT NULL REFERENCES catalyst_graph_nodes(id),
 condition_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('PENDING','SUPPORTED','VERIFIED','REJECTED','CONFLICTED')),
 graph_version TEXT NOT NULL, validation_version TEXT NOT NULL, updated_at TEXT NOT NULL,
 payload TEXT NOT NULL,
 UNIQUE(source_node_id,relation_type,target_node_id,condition_hash)
);
CREATE TABLE IF NOT EXISTS catalyst_graph_edges (
 id TEXT PRIMARY KEY, source_node_id TEXT NOT NULL REFERENCES catalyst_graph_nodes(id),
 relation_type TEXT NOT NULL, target_node_id TEXT NOT NULL REFERENCES catalyst_graph_nodes(id),
 condition_hash TEXT NOT NULL, condition TEXT NOT NULL, direction TEXT NOT NULL,
 edge_kind TEXT NOT NULL CHECK(edge_kind IN ('GENERIC','COMPANY')),
 status TEXT NOT NULL CHECK(status IN ('PENDING','SUPPORTED','VERIFIED','REJECTED','CONFLICTED')),
 valid_from TEXT, valid_to TEXT, last_verified_at TEXT NOT NULL,
 event_state TEXT, confidence REAL, graph_version TEXT NOT NULL,
 validation_version TEXT NOT NULL, namespace TEXT NOT NULL,
 UNIQUE(source_node_id,relation_type,target_node_id,condition_hash)
);
CREATE INDEX IF NOT EXISTS catalyst_graph_outgoing ON catalyst_graph_edges(source_node_id,status,valid_to);
CREATE TABLE IF NOT EXISTS catalyst_graph_evidence (
 edge_id TEXT NOT NULL REFERENCES catalyst_graph_edges(id),
 claim_id TEXT NOT NULL REFERENCES catalyst_claim_ledger(claim_id),
 validation_version TEXT NOT NULL, binding_hash TEXT NOT NULL,
 PRIMARY KEY(edge_id,claim_id)
);
