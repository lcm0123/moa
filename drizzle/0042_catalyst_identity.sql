-- Stable legacy asset IDs are retained. An unresolved venue/deployment is NULL,
-- never a fabricated identifier or a merge on ticker alone.
CREATE TABLE IF NOT EXISTS catalyst_asset_identity (
 asset_id TEXT PRIMARY KEY REFERENCES catalyst_assets(id),
 canonical_key TEXT, market TEXT, symbol TEXT NOT NULL,
 exchange TEXT, issuer_id TEXT, chain TEXT, contract_address TEXT,
 completeness TEXT NOT NULL, source_url TEXT, version TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS catalyst_identity_key ON catalyst_asset_identity(canonical_key);
CREATE TABLE IF NOT EXISTS catalyst_aliases (
 alias TEXT NOT NULL, asset_id TEXT NOT NULL REFERENCES catalyst_assets(id),
 alias_type TEXT NOT NULL CHECK(alias_type IN ('exact','canonical')),
 source_url TEXT, version TEXT NOT NULL,
 PRIMARY KEY(alias,asset_id,alias_type)
);
CREATE INDEX IF NOT EXISTS catalyst_asset_name_exact ON catalyst_assets(lower(name));
CREATE INDEX IF NOT EXISTS catalyst_asset_symbol_exact ON catalyst_assets(lower(symbol));
