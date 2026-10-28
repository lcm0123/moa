-- Derived evidence revision only; no new company/source/job tables.
INSERT OR IGNORE INTO catalyst_runtime(key,value,updated_at) VALUES('idea-evidence-revision','0',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TRIGGER IF NOT EXISTS idea_revision_business_profile_index_insert AFTER INSERT ON business_profile_index
BEGIN
 UPDATE catalyst_runtime SET value=CAST(value AS INTEGER)+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='idea-evidence-revision';
END;
CREATE TRIGGER IF NOT EXISTS idea_revision_business_profile_index_update AFTER UPDATE ON business_profile_index WHEN OLD.issuer IS NOT NEW.issuer OR OLD.item_id IS NOT NEW.item_id OR OLD.asset_id IS NOT NEW.asset_id OR OLD.dimension IS NOT NEW.dimension OR OLD.label IS NOT NEW.label OR OLD.concept_id IS NOT NEW.concept_id OR OLD.text IS NOT NEW.text OR OLD.source_id IS NOT NEW.source_id OR OLD.observation_id IS NOT NEW.observation_id OR OLD.payload IS NOT NEW.payload
BEGIN
 UPDATE catalyst_runtime SET value=CAST(value AS INTEGER)+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='idea-evidence-revision';
END;
CREATE TRIGGER IF NOT EXISTS idea_revision_business_profile_index_delete AFTER DELETE ON business_profile_index
BEGIN
 UPDATE catalyst_runtime SET value=CAST(value AS INTEGER)+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='idea-evidence-revision';
END;
CREATE TRIGGER IF NOT EXISTS idea_revision_catalyst_assets_insert AFTER INSERT ON catalyst_assets
BEGIN
 UPDATE catalyst_runtime SET value=CAST(value AS INTEGER)+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='idea-evidence-revision';
END;
CREATE TRIGGER IF NOT EXISTS idea_revision_catalyst_assets_update AFTER UPDATE ON catalyst_assets WHEN OLD.id IS NOT NEW.id OR OLD.kind IS NOT NEW.kind OR OLD.symbol IS NOT NEW.symbol OR OLD.name IS NOT NEW.name OR OLD.exchange IS NOT NEW.exchange OR OLD.issuer_id IS NOT NEW.issuer_id OR OLD.identity_status IS NOT NEW.identity_status OR OLD.payload IS NOT NEW.payload
BEGIN
 UPDATE catalyst_runtime SET value=CAST(value AS INTEGER)+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='idea-evidence-revision';
END;
CREATE TRIGGER IF NOT EXISTS idea_revision_catalyst_assets_delete AFTER DELETE ON catalyst_assets
BEGIN
 UPDATE catalyst_runtime SET value=CAST(value AS INTEGER)+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='idea-evidence-revision';
END;
CREATE TRIGGER IF NOT EXISTS idea_revision_catalyst_claims_insert AFTER INSERT ON catalyst_claims
BEGIN
 UPDATE catalyst_runtime SET value=CAST(value AS INTEGER)+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='idea-evidence-revision';
END;
CREATE TRIGGER IF NOT EXISTS idea_revision_catalyst_claims_update AFTER UPDATE ON catalyst_claims WHEN OLD.id IS NOT NEW.id OR OLD.subject_id IS NOT NEW.subject_id OR OLD.status IS NOT NEW.status OR OLD.quote IS NOT NEW.quote OR OLD.source_ids IS NOT NEW.source_ids OR OLD.payload IS NOT NEW.payload
BEGIN
 UPDATE catalyst_runtime SET value=CAST(value AS INTEGER)+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='idea-evidence-revision';
END;
CREATE TRIGGER IF NOT EXISTS idea_revision_catalyst_claims_delete AFTER DELETE ON catalyst_claims
BEGIN
 UPDATE catalyst_runtime SET value=CAST(value AS INTEGER)+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='idea-evidence-revision';
END;
CREATE TRIGGER IF NOT EXISTS idea_revision_company_metadata_facts_insert AFTER INSERT ON company_metadata_facts
BEGIN
 UPDATE catalyst_runtime SET value=CAST(value AS INTEGER)+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='idea-evidence-revision';
END;
CREATE TRIGGER IF NOT EXISTS idea_revision_company_metadata_facts_update AFTER UPDATE ON company_metadata_facts WHEN OLD.id IS NOT NEW.id OR OLD.company_id IS NOT NEW.company_id OR OLD.source_id IS NOT NEW.source_id OR OLD.lifecycle_status IS NOT NEW.lifecycle_status OR OLD.verification_status IS NOT NEW.verification_status OR OLD.payload IS NOT NEW.payload
BEGIN
 UPDATE catalyst_runtime SET value=CAST(value AS INTEGER)+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='idea-evidence-revision';
END;
CREATE TRIGGER IF NOT EXISTS idea_revision_company_metadata_facts_delete AFTER DELETE ON company_metadata_facts
BEGIN
 UPDATE catalyst_runtime SET value=CAST(value AS INTEGER)+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='idea-evidence-revision';
END;
CREATE TRIGGER IF NOT EXISTS idea_revision_catalyst_sources_insert AFTER INSERT ON catalyst_sources
BEGIN
 UPDATE catalyst_runtime SET value=CAST(value AS INTEGER)+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='idea-evidence-revision';
END;
CREATE TRIGGER IF NOT EXISTS idea_revision_catalyst_sources_update AFTER UPDATE ON catalyst_sources WHEN OLD.id IS NOT NEW.id OR OLD.asset_id IS NOT NEW.asset_id OR OLD.url IS NOT NEW.url OR OLD.source_type IS NOT NEW.source_type OR OLD.published_at IS NOT NEW.published_at OR OLD.observed_at IS NOT NEW.observed_at OR OLD.content_hash IS NOT NEW.content_hash OR OLD.body IS NOT NEW.body OR OLD.payload IS NOT NEW.payload
BEGIN
 UPDATE catalyst_runtime SET value=CAST(value AS INTEGER)+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='idea-evidence-revision';
END;
CREATE TRIGGER IF NOT EXISTS idea_revision_catalyst_sources_delete AFTER DELETE ON catalyst_sources
BEGIN
 UPDATE catalyst_runtime SET value=CAST(value AS INTEGER)+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='idea-evidence-revision';
END;
CREATE INDEX IF NOT EXISTS news_inline_asset_dependency ON news_inline_dependencies(asset_id,job_id);
CREATE INDEX IF NOT EXISTS news_company_queue ON news_company_jobs(status,created_at);
