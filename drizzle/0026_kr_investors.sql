CREATE TABLE IF NOT EXISTS kr_investor_daily (
 scope TEXT NOT NULL,
 trade_date TEXT NOT NULL,
 payload TEXT NOT NULL,
 collected_at TEXT NOT NULL,
 PRIMARY KEY(scope,trade_date)
);
CREATE TABLE IF NOT EXISTS kr_investor_rankings (
 market TEXT NOT NULL,
 trade_date TEXT NOT NULL,
 payload TEXT NOT NULL,
 collected_at TEXT NOT NULL,
 PRIMARY KEY(market,trade_date)
);
CREATE TABLE IF NOT EXISTS kr_investor_jobs (
 scope TEXT PRIMARY KEY,
 status TEXT NOT NULL,
 attempted_at TEXT NOT NULL,
 error_code TEXT
);
