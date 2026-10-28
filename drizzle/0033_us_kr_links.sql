CREATE TABLE IF NOT EXISTS us_kr_industry_snapshots (
 id TEXT PRIMARY KEY, session_date TEXT NOT NULL, close_at TEXT NOT NULL,
 observed_at TEXT NOT NULL, classification_at TEXT NOT NULL, version TEXT NOT NULL,
 payload TEXT NOT NULL, UNIQUE(session_date,version)
);
CREATE TABLE IF NOT EXISTS us_kr_evidence (
 id TEXT PRIMARY KEY,ticker TEXT NOT NULL,corp_code TEXT NOT NULL,topic TEXT NOT NULL,
 receipt TEXT NOT NULL,published_date TEXT NOT NULL,available_at TEXT NOT NULL,
 checked_at TEXT NOT NULL,version TEXT NOT NULL,status TEXT NOT NULL,
 payload TEXT NOT NULL,UNIQUE(ticker,topic,receipt,version)
);
CREATE INDEX IF NOT EXISTS us_kr_evidence_ticker ON us_kr_evidence(ticker,available_at);
CREATE TABLE IF NOT EXISTS us_kr_business_jobs (
 ticker TEXT PRIMARY KEY,corp_code TEXT NOT NULL,name TEXT NOT NULL,
 next_check INTEGER NOT NULL DEFAULT 0,checked_at TEXT,error TEXT,latest_receipt TEXT
);
CREATE TABLE IF NOT EXISTS us_kr_runtime (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS us_kr_cache (
 id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL
);
