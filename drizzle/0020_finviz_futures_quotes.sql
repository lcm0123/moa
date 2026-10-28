CREATE TABLE IF NOT EXISTS finviz_futures_quotes (
 id TEXT PRIMARY KEY,
 payload TEXT NOT NULL,
 next_attempt INTEGER NOT NULL DEFAULT 0
);
