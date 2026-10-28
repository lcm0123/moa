CREATE TABLE IF NOT EXISTS manager_directory (
 cik TEXT PRIMARY KEY, name TEXT NOT NULL, people TEXT NOT NULL DEFAULT '[]', slug TEXT,
 period TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS manager_snapshots (
 cik TEXT NOT NULL, period TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY (cik, period)
);
CREATE TABLE IF NOT EXISTS manager_positions (
 cik TEXT NOT NULL, period TEXT NOT NULL, revision TEXT NOT NULL, security_id TEXT NOT NULL, ticker TEXT,
 kind TEXT NOT NULL, shares REAL NOT NULL, value_usd REAL NOT NULL,
 PRIMARY KEY (cik, period, revision, security_id)
);
CREATE INDEX IF NOT EXISTS manager_positions_ticker ON manager_positions(ticker,kind);
