CREATE TABLE IF NOT EXISTS monthly_flow_cache (
 cache_key TEXT PRIMARY KEY,
 payload TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
