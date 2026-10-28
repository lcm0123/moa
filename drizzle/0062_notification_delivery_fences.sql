-- Additive: existing notification, read-state and outbox primary keys are unchanged.
-- A claimed queued/retry job retains its state so existing cancellation writers
-- still match it. Only the matching token may publish a delivery result.
ALTER TABLE notification_push_jobs ADD COLUMN claim_token TEXT;

-- Existing updated_at is a conservative lower bound, not a reconstructed
-- historical activation time. Keep independent boundaries when another
-- category changes or an unchanged settings form is saved.
ALTER TABLE notification_settings ADD COLUMN reports_enabled_at TEXT;
ALTER TABLE notification_settings ADD COLUMN filings_enabled_at TEXT;
UPDATE notification_settings SET
 reports_enabled_at=CASE WHEN reports=1 THEN updated_at END,
 filings_enabled_at=CASE WHEN filings<>'none' THEN updated_at END;

-- INSERT/UPDATE already advance source versions (0038). Deleting identity
-- evidence must also invalidate an in-flight validation before publication/send.
CREATE TRIGGER notification_sec_issuer_delete AFTER DELETE ON sec_filing_issuers BEGIN
 UPDATE notification_sources SET version=version+1 WHERE source='sec' AND source_id=OLD.accession;
END;
CREATE TRIGGER notification_sec_source_delete AFTER DELETE ON sec_filing_sources BEGIN
 UPDATE notification_sources SET version=version+1 WHERE source='sec' AND source_id=OLD.accession;
END;
CREATE TRIGGER notification_issuer_delete AFTER DELETE ON issuer_links BEGIN
 UPDATE notification_sources SET version=version+1 WHERE source='report' AND source_id IN (SELECT id FROM telegram_reports WHERE market=OLD.market AND ticker=OLD.ticker);
END;
