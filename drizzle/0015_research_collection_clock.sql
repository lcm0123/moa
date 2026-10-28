DROP TRIGGER research_manager_before_change;
DROP TRIGGER research_manager_after_change;
CREATE TRIGGER research_manager_before_change BEFORE UPDATE ON manager_snapshots
WHEN json_extract(OLD.payload,'$.items') IS NOT json_extract(NEW.payload,'$.items')
 OR json_extract(OLD.payload,'$.filings') IS NOT json_extract(NEW.payload,'$.filings')
BEGIN
 INSERT INTO research_source_versions(source,source_id,published_at,data_date,collected_at,recorded_at,payload)
 SELECT 'sec13f',OLD.cik || ':' || OLD.period,json_extract(OLD.payload,'$.filedAt'),OLD.period,json_extract(OLD.payload,'$.receivedAt'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),OLD.payload
 WHERE NOT EXISTS(SELECT 1 FROM research_source_versions WHERE source='sec13f' AND source_id=OLD.cik || ':' || OLD.period);
END;
CREATE TRIGGER research_manager_after_change AFTER UPDATE ON manager_snapshots
WHEN json_extract(OLD.payload,'$.items') IS NOT json_extract(NEW.payload,'$.items')
 OR json_extract(OLD.payload,'$.filings') IS NOT json_extract(NEW.payload,'$.filings')
BEGIN
 INSERT INTO research_source_versions(source,source_id,published_at,data_date,collected_at,recorded_at,payload)
 VALUES('sec13f',NEW.cik || ':' || NEW.period,json_extract(NEW.payload,'$.filedAt'),NEW.period,json_extract(NEW.payload,'$.receivedAt'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.payload);
END;
