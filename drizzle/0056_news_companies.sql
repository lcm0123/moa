-- Private, user-requested analyses. Company identity and revenue remain in the existing master.
CREATE TABLE IF NOT EXISTS news_company_jobs (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, request_key TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, phase TEXT NOT NULL,
 input TEXT NOT NULL, result TEXT, error TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(owner,request_key)
);
CREATE INDEX IF NOT EXISTS news_company_owner ON news_company_jobs(owner,updated_at);
CREATE TABLE IF NOT EXISTS news_company_versions (
 job_id TEXT NOT NULL REFERENCES news_company_jobs(id), version INTEGER NOT NULL,
 input TEXT NOT NULL, result TEXT, reason TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, PRIMARY KEY(job_id,version)
);
