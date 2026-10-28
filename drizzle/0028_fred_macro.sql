CREATE TABLE IF NOT EXISTS fred_macro_cache (
 cache_key TEXT PRIMARY KEY, payload TEXT, retrieved_at TEXT,
 next_attempt INTEGER NOT NULL DEFAULT 0, error_code TEXT
);
CREATE TABLE IF NOT EXISTS macro_usage (
 day TEXT NOT NULL, visitor_hash TEXT NOT NULL, series_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('view','click')),
 PRIMARY KEY(day,visitor_hash,series_id,action)
);
CREATE INDEX IF NOT EXISTS macro_usage_window ON macro_usage(day,series_id);
