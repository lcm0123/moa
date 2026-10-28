CREATE TABLE IF NOT EXISTS screener_snapshots (
 cache_key TEXT PRIMARY KEY,
 payload TEXT,
 received_at TEXT,
 next_attempt INTEGER NOT NULL,
 error_message TEXT
);
