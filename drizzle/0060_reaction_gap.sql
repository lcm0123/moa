-- Additive only. Application at deployment is deliberately not performed by
-- the reaction-gap API/runtime; this migration is tested in isolated SQLite.
CREATE TABLE reaction_gap_jobs (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, request_key TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, latest_version INTEGER,
 state TEXT NOT NULL, request TEXT NOT NULL, frozen TEXT NOT NULL,
 lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, control_generation INTEGER NOT NULL,
 error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(owner,request_key)
);
CREATE INDEX reaction_gap_queue ON reaction_gap_jobs(state,created_at);
CREATE TABLE reaction_gap_versions (
 job_id TEXT NOT NULL REFERENCES reaction_gap_jobs(id), version INTEGER NOT NULL,
 snapshot_id TEXT NOT NULL, manifest TEXT NOT NULL, input TEXT NOT NULL, result TEXT NOT NULL,
 valid INTEGER NOT NULL DEFAULT 1, invalid_reason TEXT, created_at TEXT NOT NULL,
 PRIMARY KEY(job_id,version)
);
CREATE TABLE reaction_gap_dependencies (
 job_id TEXT NOT NULL, version INTEGER NOT NULL, kind TEXT NOT NULL, dependency_key TEXT NOT NULL,
 dependency_version TEXT NOT NULL,
 PRIMARY KEY(job_id,version,kind,dependency_key),
 FOREIGN KEY(job_id,version) REFERENCES reaction_gap_versions(job_id,version)
);
CREATE INDEX reaction_gap_dependency_lookup ON reaction_gap_dependencies(kind,dependency_key);
CREATE TABLE reaction_gap_market_rows (
 kind TEXT NOT NULL CHECK(kind IN ('STOCK','INDEX')), asset_id TEXT NOT NULL, day TEXT NOT NULL,
 revision TEXT NOT NULL, received_at TEXT NOT NULL, raw_hash TEXT NOT NULL, payload TEXT NOT NULL,
 PRIMARY KEY(kind,asset_id,day,revision)
);
CREATE INDEX reaction_gap_market_range ON reaction_gap_market_rows(kind,asset_id,day);
CREATE TRIGGER reaction_gap_market_immutable BEFORE UPDATE ON reaction_gap_market_rows BEGIN
 SELECT RAISE(ABORT,'REACTION_GAP_IMMUTABLE_OBSERVATION');
END;
CREATE TRIGGER reaction_gap_version_immutable BEFORE UPDATE OF job_id,version,snapshot_id,manifest,input,result,created_at ON reaction_gap_versions BEGIN
 SELECT RAISE(ABORT,'REACTION_GAP_IMMUTABLE_SNAPSHOT');
END;
CREATE TABLE reaction_gap_contracts (
 id TEXT PRIMARY KEY, version TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE reaction_gap_calendars (
 id TEXT PRIMARY KEY, version TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- Persistent feature gate uses the existing shared runtime control table.
INSERT OR IGNORE INTO catalyst_runtime(key,value,updated_at) VALUES('reaction-gap-control','{"enabled":false,"generation":0}','');

CREATE TRIGGER reaction_gap_market_changed AFTER INSERT ON reaction_gap_market_rows BEGIN
 UPDATE reaction_gap_versions SET valid=0,invalid_reason='MARKET_DATA_CHANGED'
 WHERE EXISTS(SELECT 1 FROM reaction_gap_dependencies d WHERE d.job_id=reaction_gap_versions.job_id AND d.version=reaction_gap_versions.version AND d.kind='MARKET' AND d.dependency_key=NEW.kind||':'||NEW.asset_id)
 AND (EXISTS(SELECT 1 FROM json_each(json_extract(reaction_gap_versions.manifest,'$.requiredDates')) d WHERE d.value=NEW.day)
 OR json_extract(reaction_gap_versions.manifest,'$.period.endDate') IS NULL);
END;
CREATE TRIGGER reaction_gap_contract_changed AFTER UPDATE ON reaction_gap_contracts
WHEN OLD.version<>NEW.version OR OLD.state<>NEW.state OR OLD.payload<>NEW.payload BEGIN
 UPDATE reaction_gap_versions SET valid=0,invalid_reason='DATA_CONTRACT_CHANGED'
 WHERE EXISTS(SELECT 1 FROM reaction_gap_dependencies d WHERE d.job_id=reaction_gap_versions.job_id AND d.version=reaction_gap_versions.version AND d.kind='CONTRACT' AND d.dependency_key=NEW.id);
END;
CREATE TRIGGER reaction_gap_market_removed AFTER DELETE ON reaction_gap_market_rows BEGIN
 UPDATE reaction_gap_versions SET valid=0,invalid_reason='MARKET_DATA_REMOVED'
 WHERE EXISTS(SELECT 1 FROM reaction_gap_dependencies d WHERE d.job_id=reaction_gap_versions.job_id AND d.version=reaction_gap_versions.version AND d.kind='MARKET' AND d.dependency_key=OLD.kind||':'||OLD.asset_id)
 AND (EXISTS(SELECT 1 FROM json_each(json_extract(reaction_gap_versions.manifest,'$.requiredDates')) d WHERE d.value=OLD.day)
 OR json_extract(reaction_gap_versions.manifest,'$.period.endDate') IS NULL);
END;
CREATE TRIGGER reaction_gap_calendar_changed AFTER UPDATE ON reaction_gap_calendars
WHEN OLD.version<>NEW.version OR OLD.state<>NEW.state OR OLD.payload<>NEW.payload BEGIN
 UPDATE reaction_gap_versions SET valid=0,invalid_reason='CALENDAR_CHANGED'
 WHERE EXISTS(SELECT 1 FROM reaction_gap_dependencies d WHERE d.job_id=reaction_gap_versions.job_id AND d.version=reaction_gap_versions.version AND d.kind='CALENDAR' AND d.dependency_key=NEW.id);
END;
