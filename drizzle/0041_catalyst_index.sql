-- Small inverted index of observed business text, not a second stock master.
CREATE TABLE IF NOT EXISTS catalyst_business_index (
 asset_id TEXT NOT NULL, term TEXT NOT NULL, source_id TEXT NOT NULL,
 PRIMARY KEY(asset_id,term,source_id)
);
CREATE INDEX IF NOT EXISTS catalyst_business_term ON catalyst_business_index(term,asset_id);
