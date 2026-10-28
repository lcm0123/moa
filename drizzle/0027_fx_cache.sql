CREATE TABLE IF NOT EXISTS fx_cache (
 cache_key TEXT PRIMARY KEY,
 payload TEXT,
 next_attempt INTEGER NOT NULL DEFAULT 0,
 error_code TEXT
);
