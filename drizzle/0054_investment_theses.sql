-- Private, explicit user saves. Research jobs, assets, sources and budgets are reused.
CREATE TABLE investment_theses (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 title TEXT NOT NULL,
 thesis_text TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
 current_version INTEGER NOT NULL DEFAULT 1 CHECK(current_version > 0),
 linked_asset_ids TEXT NOT NULL DEFAULT '[]',
 linked_industry_concepts TEXT NOT NULL DEFAULT '[]',
 position_context TEXT NOT NULL DEFAULT 'UNSPECIFIED' CHECK(position_context IN ('HOLDING','WATCHING','UNSPECIFIED')),
 importance INTEGER NOT NULL DEFAULT 2 CHECK(importance BETWEEN 1 AND 3),
 monitoring_topics TEXT NOT NULL DEFAULT '[]',
 reconsideration_conditions TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 last_review_at TEXT,
 last_successful_review_at TEXT,
 archived_at TEXT,
 UNIQUE(id,owner_id)
);
CREATE INDEX investment_theses_owner ON investment_theses(owner_id,status,importance,updated_at);
CREATE TABLE investment_thesis_versions (
 thesis_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version > 0),
 owner_id TEXT NOT NULL,
 title TEXT NOT NULL,
 thesis_text TEXT NOT NULL,
 snapshot TEXT NOT NULL,
 baseline_snapshot TEXT NOT NULL,
 change_reason TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(thesis_id,version),
 FOREIGN KEY(thesis_id,owner_id) REFERENCES investment_theses(id,owner_id)
);
CREATE TABLE investment_thesis_premises (
 premise_id TEXT NOT NULL,
 thesis_id TEXT NOT NULL,
 thesis_version INTEGER NOT NULL,
 statement TEXT NOT NULL,
 statement_type TEXT NOT NULL CHECK(statement_type IN ('USER_BELIEF','USER_ASSUMPTION','USER_GOAL','EVIDENCE_FACT','DERIVED_METRIC','RESEARCH_INFERENCE','UNKNOWN')),
 importance INTEGER NOT NULL DEFAULT 2,
 linked_asset_ids TEXT NOT NULL DEFAULT '[]',
 supporting_source_ids TEXT NOT NULL DEFAULT '[]',
 monitoring_topics TEXT NOT NULL DEFAULT '[]',
 reconsideration_conditions TEXT NOT NULL DEFAULT '[]',
 PRIMARY KEY(thesis_id,thesis_version,premise_id),
 FOREIGN KEY(thesis_id,thesis_version) REFERENCES investment_thesis_versions(thesis_id,version)
);
CREATE TABLE investment_thesis_reviews (
 id TEXT PRIMARY KEY,
 thesis_id TEXT NOT NULL,
 thesis_version INTEGER NOT NULL,
 owner_id TEXT NOT NULL,
 job_id TEXT UNIQUE REFERENCES catalyst_research_jobs(id),
 status TEXT NOT NULL CHECK(status IN ('queued','running','complete','failed','cancelled')),
 investigation_status TEXT,
 baseline_review_id TEXT,
 started_at TEXT NOT NULL,
 completed_at TEXT,
 result TEXT,
 evidence_snapshot TEXT NOT NULL DEFAULT '[]',
 cache_key TEXT NOT NULL,
 FOREIGN KEY(thesis_id,owner_id) REFERENCES investment_theses(id,owner_id),
 FOREIGN KEY(thesis_id,thesis_version) REFERENCES investment_thesis_versions(thesis_id,version)
);
CREATE UNIQUE INDEX investment_thesis_active_review ON investment_thesis_reviews(thesis_id,thesis_version) WHERE status IN ('queued','running');
CREATE INDEX investment_thesis_reviews_owner ON investment_thesis_reviews(owner_id,thesis_id,started_at);
CREATE INDEX investment_thesis_review_cache ON investment_thesis_reviews(owner_id,cache_key,completed_at);
