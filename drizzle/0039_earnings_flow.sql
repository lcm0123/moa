CREATE TABLE IF NOT EXISTS earnings_flow_targets(security_key TEXT PRIMARY KEY,created_at TEXT NOT NULL,payload TEXT,last_accession TEXT,last_version TEXT,updated_at TEXT,next_refresh INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,error TEXT);
CREATE TABLE IF NOT EXISTS earnings_flow_evaluations(security_key TEXT NOT NULL,accession TEXT NOT NULL,version TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(security_key,accession,version));
CREATE TABLE IF NOT EXISTS earnings_flow_events(id TEXT PRIMARY KEY,payload TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TRIGGER earnings_flow_event_insert AFTER INSERT ON earnings_flow_events BEGIN
 INSERT OR IGNORE INTO notification_sources(source,source_id,collected_at) VALUES('earnings',NEW.id,NEW.created_at);
END;
