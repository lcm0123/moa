CREATE TABLE IF NOT EXISTS competitor_profiles(id TEXT PRIMARY KEY,market TEXT NOT NULL,ticker TEXT NOT NULL,issuer TEXT NOT NULL,receipt TEXT NOT NULL,source_date TEXT NOT NULL,checked_at TEXT NOT NULL,version TEXT NOT NULL,payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS competitor_profile_company ON competitor_profiles(market,ticker,checked_at DESC);
CREATE TABLE IF NOT EXISTS competitor_companies(market TEXT NOT NULL,ticker TEXT NOT NULL,name TEXT NOT NULL,issuer TEXT,active_profile TEXT,next_check INTEGER NOT NULL DEFAULT 0,checked_at TEXT,error TEXT,priority INTEGER NOT NULL DEFAULT 10,PRIMARY KEY(market,ticker));
CREATE TABLE IF NOT EXISTS competitor_terms(profile_id TEXT NOT NULL,kind TEXT NOT NULL,term TEXT NOT NULL,PRIMARY KEY(profile_id,kind,term));
CREATE INDEX IF NOT EXISTS competitor_term_lookup ON competitor_terms(kind,term,profile_id);
CREATE TABLE IF NOT EXISTS competitor_pairs(id TEXT PRIMARY KEY,us_profile TEXT NOT NULL,kr_profile TEXT NOT NULL,version TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS competitor_pair_us ON competitor_pairs(us_profile,version);
CREATE TABLE IF NOT EXISTS competitor_cache(id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS competitor_universe(ticker TEXT PRIMARY KEY,name TEXT NOT NULL,cik TEXT NOT NULL);
