CREATE TABLE IF NOT EXISTS research_cache (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS issuer_links (market TEXT NOT NULL, ticker TEXT NOT NULL, issuer_id TEXT NOT NULL, name TEXT NOT NULL, source TEXT NOT NULL, verified_at TEXT NOT NULL, PRIMARY KEY(market,ticker));
