CREATE TABLE IF NOT EXISTS fmp_requests (id TEXT PRIMARY KEY, key_hash TEXT NOT NULL, requested_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS fmp_requests_budget ON fmp_requests(key_hash, requested_at);
CREATE TABLE IF NOT EXISTS fmp_cache (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS fmp_blocks (scope TEXT PRIMARY KEY, reason TEXT NOT NULL, until_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS fmp_last_good (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL);
