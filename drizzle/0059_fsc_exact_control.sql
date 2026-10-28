-- Additive control metadata only. The legacy numeric bars stay compatible.
-- A key change permits retry of a previously blocked authentication failure.
ALTER TABLE fsc_stock_history ADD COLUMN credential_version TEXT NOT NULL DEFAULT '';
ALTER TABLE fsc_index_history ADD COLUMN credential_version TEXT NOT NULL DEFAULT '';
