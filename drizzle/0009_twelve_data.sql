CREATE TABLE IF NOT EXISTS twelve_data_requests (
 id TEXT PRIMARY KEY,
 key_hash TEXT NOT NULL,
 requested_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS twelve_data_requests_budget ON twelve_data_requests(key_hash, requested_at);
CREATE TABLE IF NOT EXISTS twelve_data_cache (
 cache_key TEXT PRIMARY KEY,
 payload TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
