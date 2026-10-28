CREATE TRIGGER research_event_first_version AFTER INSERT ON research_events
BEGIN
 INSERT INTO research_event_versions(id,event_id,revision,recorded_at,payload)
 VALUES(NEW.id || ':' || NEW.revision,NEW.id,NEW.revision,NEW.last_seen_at,NEW.payload);
END;
CREATE TRIGGER research_event_changed_version AFTER UPDATE ON research_events
WHEN NEW.revision <> OLD.revision
BEGIN
 INSERT INTO research_event_versions(id,event_id,revision,recorded_at,payload)
 VALUES(NEW.id || ':' || NEW.revision,NEW.id,NEW.revision,NEW.last_seen_at,NEW.payload);
END;

CREATE TRIGGER research_report_before_change BEFORE UPDATE ON telegram_reports
WHEN OLD.raw_text IS NOT NEW.raw_text OR OLD.edited_at IS NOT NEW.edited_at OR OLD.deleted IS NOT NEW.deleted
 OR json_extract(OLD.payload,'$.fields') IS NOT json_extract(NEW.payload,'$.fields')
 OR json_extract(OLD.payload,'$.attachment.key') IS NOT json_extract(NEW.payload,'$.attachment.key')
BEGIN
 INSERT INTO research_source_versions(source,source_id,published_at,data_date,collected_at,recorded_at,payload)
 SELECT 'telegram',OLD.id,OLD.posted_at,json_extract(OLD.payload,'$.fields.issuedDate.value'),OLD.updated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 json_object('report',json(OLD.payload),'rawText',OLD.raw_text,'editedAt',OLD.edited_at,'deleted',OLD.deleted,'sourceUrl',OLD.source_url)
 WHERE NOT EXISTS(SELECT 1 FROM research_source_versions WHERE source='telegram' AND source_id=OLD.id);
END;
CREATE TRIGGER research_report_after_change AFTER UPDATE ON telegram_reports
WHEN OLD.raw_text IS NOT NEW.raw_text OR OLD.edited_at IS NOT NEW.edited_at OR OLD.deleted IS NOT NEW.deleted
 OR json_extract(OLD.payload,'$.fields') IS NOT json_extract(NEW.payload,'$.fields')
 OR json_extract(OLD.payload,'$.attachment.key') IS NOT json_extract(NEW.payload,'$.attachment.key')
BEGIN
 INSERT INTO research_source_versions(source,source_id,published_at,data_date,collected_at,recorded_at,payload)
 VALUES('telegram',NEW.id,NEW.posted_at,json_extract(NEW.payload,'$.fields.issuedDate.value'),NEW.updated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 json_object('report',json(NEW.payload),'rawText',NEW.raw_text,'editedAt',NEW.edited_at,'deleted',NEW.deleted,'sourceUrl',NEW.source_url));
END;
CREATE TRIGGER research_manager_before_change BEFORE UPDATE ON manager_snapshots
WHEN json_extract(OLD.payload,'$.items') IS NOT json_extract(NEW.payload,'$.items')
 OR json_extract(OLD.payload,'$.filings') IS NOT json_extract(NEW.payload,'$.filings')
BEGIN
 INSERT INTO research_source_versions(source,source_id,published_at,data_date,collected_at,recorded_at,payload)
 SELECT 'sec13f',OLD.cik || ':' || OLD.period,json_extract(OLD.payload,'$.filedAt'),OLD.period,OLD.updated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'),OLD.payload
 WHERE NOT EXISTS(SELECT 1 FROM research_source_versions WHERE source='sec13f' AND source_id=OLD.cik || ':' || OLD.period);
END;
CREATE TRIGGER research_manager_after_change AFTER UPDATE ON manager_snapshots
WHEN json_extract(OLD.payload,'$.items') IS NOT json_extract(NEW.payload,'$.items')
 OR json_extract(OLD.payload,'$.filings') IS NOT json_extract(NEW.payload,'$.filings')
BEGIN
 INSERT INTO research_source_versions(source,source_id,published_at,data_date,collected_at,recorded_at,payload)
 VALUES('sec13f',NEW.cik || ':' || NEW.period,json_extract(NEW.payload,'$.filedAt'),NEW.period,NEW.updated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.payload);
END;
