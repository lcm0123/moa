CREATE TABLE IF NOT EXISTS ecos_series_cache (
 series_id TEXT PRIMARY KEY,
 payload TEXT,
 next_attempt INTEGER NOT NULL DEFAULT 0,
 error_code TEXT
);
