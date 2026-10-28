CREATE TABLE IF NOT EXISTS observation_records (
 id TEXT PRIMARY KEY, ticker TEXT NOT NULL, session_date TEXT NOT NULL,
 version TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS observation_session ON observation_records(session_date,ticker);
CREATE TABLE IF NOT EXISTS observation_jobs (
 ticker TEXT PRIMARY KEY, requested_at TEXT NOT NULL, next_check INTEGER NOT NULL DEFAULT 0,
 checked_at TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS observation_business (
 id TEXT PRIMARY KEY, ticker TEXT NOT NULL, topic TEXT NOT NULL, receipt TEXT NOT NULL,
 available_at TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS observation_business_topic ON observation_business(topic,ticker);
CREATE TABLE IF NOT EXISTS observation_cache (id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL);
