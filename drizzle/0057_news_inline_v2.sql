-- Additive projection of the existing news queue. No new company/document master.
CREATE TABLE IF NOT EXISTS news_inline_bindings (
  scope TEXT NOT NULL,
  article_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  content_version TEXT NOT NULL,
  job_id TEXT,
  state TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(scope,article_id)
);
CREATE INDEX IF NOT EXISTS news_inline_event ON news_inline_bindings(scope,event_key);
CREATE INDEX IF NOT EXISTS news_inline_job ON news_inline_bindings(job_id);
CREATE TABLE IF NOT EXISTS news_inline_dependencies (
  job_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  asset_id TEXT,
  profile_version TEXT,
  payload TEXT NOT NULL,
  PRIMARY KEY(job_id,source_id)
);
CREATE INDEX IF NOT EXISTS news_inline_source ON news_inline_dependencies(source_url);
