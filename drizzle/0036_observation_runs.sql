CREATE TABLE IF NOT EXISTS observation_runs (
 id TEXT PRIMARY KEY, ticker TEXT NOT NULL, state TEXT NOT NULL,
 stage TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS observation_runs_ticker ON observation_runs(ticker, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS observation_runs_active_ticker ON observation_runs(ticker) WHERE state IN ('queued','running');
