CREATE TABLE IF NOT EXISTS crypto_observations (
 instrument_id TEXT NOT NULL, bucket TEXT NOT NULL, kst_day TEXT NOT NULL,
 price REAL NOT NULL, received_at TEXT NOT NULL, currency TEXT NOT NULL,
 PRIMARY KEY(instrument_id,bucket)
);
CREATE INDEX IF NOT EXISTS crypto_observations_day ON crypto_observations(kst_day,instrument_id);
CREATE TABLE IF NOT EXISTS crypto_identity_map (
 instrument_id TEXT PRIMARY KEY, finviz_ticker TEXT NOT NULL, finviz_name TEXT NOT NULL,
 cmc_id INTEGER, status TEXT NOT NULL, checked_at TEXT NOT NULL, evidence TEXT NOT NULL
);
