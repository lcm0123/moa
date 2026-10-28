CREATE TABLE IF NOT EXISTS ranking_security_types (
 id TEXT PRIMARY KEY,
 payload TEXT NOT NULL,
 next_attempt INTEGER NOT NULL
);
