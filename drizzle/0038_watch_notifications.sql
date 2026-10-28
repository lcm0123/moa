CREATE TABLE IF NOT EXISTS notification_settings(user_id TEXT PRIMARY KEY,reports INTEGER NOT NULL DEFAULT 1,filings TEXT NOT NULL DEFAULT 'all',updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notification_watches(user_id TEXT NOT NULL,security_key TEXT NOT NULL,created_at TEXT NOT NULL,sec_baseline_at TEXT,PRIMARY KEY(user_id,security_key));
CREATE TABLE IF NOT EXISTS notification_sources(source TEXT NOT NULL,source_id TEXT NOT NULL,collected_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,processed_version INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(source,source_id));
CREATE INDEX IF NOT EXISTS notification_source_pending ON notification_sources(processed_version,version);
CREATE TABLE IF NOT EXISTS notification_events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,security_key TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,merged_into TEXT);
CREATE TABLE IF NOT EXISTS notification_aliases(alias TEXT PRIMARY KEY,event_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS user_notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,event_id TEXT NOT NULL,security_key TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,source_id TEXT NOT NULL,source_url TEXT,published_at TEXT,published_date TEXT,collected_at TEXT NOT NULL,created_at TEXT NOT NULL,read_at TEXT,href TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(user_id,event_id));
CREATE INDEX IF NOT EXISTS user_notifications_inbox ON user_notifications(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS notification_runtime(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notification_push_subscriptions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,endpoint TEXT NOT NULL UNIQUE,p256dh TEXT NOT NULL,auth TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,expires_at INTEGER);
CREATE INDEX IF NOT EXISTS notification_push_user ON notification_push_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS notification_push_jobs(notification_id TEXT NOT NULL,subscription_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,error TEXT,PRIMARY KEY(notification_id,subscription_id));

-- A source's initial collection clock survives edits, reparsing and restarts.
INSERT OR IGNORE INTO notification_sources(source,source_id,collected_at) SELECT 'report',id,updated_at FROM telegram_reports;
INSERT OR IGNORE INTO notification_sources(source,source_id,collected_at) SELECT 'sec',accession,collected_at FROM sec_filings;
INSERT OR IGNORE INTO notification_sources(source,source_id,collected_at) SELECT 'dart',receipt,first_seen_at FROM dart_filings;
CREATE TRIGGER notification_report_insert AFTER INSERT ON telegram_reports BEGIN
 INSERT INTO notification_sources(source,source_id,collected_at) VALUES('report',NEW.id,NEW.updated_at) ON CONFLICT(source,source_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER notification_report_update AFTER UPDATE ON telegram_reports BEGIN
 INSERT INTO notification_sources(source,source_id,collected_at) VALUES('report',NEW.id,NEW.updated_at) ON CONFLICT(source,source_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER notification_report_category_insert AFTER INSERT ON telegram_report_categories BEGIN
 UPDATE notification_sources SET version=version+1 WHERE source='report' AND source_id=NEW.report_id;
END;
CREATE TRIGGER notification_report_category_update AFTER UPDATE ON telegram_report_categories BEGIN
 UPDATE notification_sources SET version=version+1 WHERE source='report' AND source_id=NEW.report_id;
END;
CREATE TRIGGER notification_report_category_delete AFTER DELETE ON telegram_report_categories BEGIN
 UPDATE notification_sources SET version=version+1 WHERE source='report' AND source_id=OLD.report_id;
END;
CREATE TRIGGER notification_sec_insert AFTER INSERT ON sec_filings BEGIN
 INSERT INTO notification_sources(source,source_id,collected_at) VALUES('sec',NEW.accession,NEW.collected_at) ON CONFLICT(source,source_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER notification_sec_update AFTER UPDATE ON sec_filings BEGIN
 INSERT INTO notification_sources(source,source_id,collected_at) VALUES('sec',NEW.accession,NEW.collected_at) ON CONFLICT(source,source_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER notification_sec_issuer_insert AFTER INSERT ON sec_filing_issuers BEGIN
 UPDATE notification_sources SET version=version+1 WHERE source='sec' AND source_id=NEW.accession;
END;
CREATE TRIGGER notification_sec_issuer_update AFTER UPDATE ON sec_filing_issuers BEGIN
 UPDATE notification_sources SET version=version+1 WHERE source='sec' AND source_id=NEW.accession;
END;
CREATE TRIGGER notification_sec_source_insert AFTER INSERT ON sec_filing_sources BEGIN
 UPDATE notification_sources SET version=version+1 WHERE source='sec' AND source_id=NEW.accession;
END;
CREATE TRIGGER notification_issuer_insert AFTER INSERT ON issuer_links BEGIN
 UPDATE notification_sources SET version=version+1 WHERE source='report' AND source_id IN (SELECT id FROM telegram_reports WHERE market=NEW.market AND ticker=NEW.ticker);
END;
CREATE TRIGGER notification_issuer_update AFTER UPDATE ON issuer_links BEGIN
 UPDATE notification_sources SET version=version+1 WHERE source='report' AND source_id IN (SELECT id FROM telegram_reports WHERE market=NEW.market AND ticker=NEW.ticker);
END;
CREATE TRIGGER notification_dart_insert AFTER INSERT ON dart_filings BEGIN
 INSERT INTO notification_sources(source,source_id,collected_at) VALUES('dart',NEW.receipt,NEW.first_seen_at) ON CONFLICT(source,source_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER notification_dart_update AFTER UPDATE ON dart_filings BEGIN
 INSERT INTO notification_sources(source,source_id,collected_at) VALUES('dart',NEW.receipt,NEW.first_seen_at) ON CONFLICT(source,source_id) DO UPDATE SET version=version+1;
END;
