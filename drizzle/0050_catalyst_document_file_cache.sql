ALTER TABLE catalyst_filing_documents ADD COLUMN file_mtime_ms REAL;
CREATE INDEX catalyst_filing_local_cache ON catalyst_filing_documents(local_path,issuer_id,parser_version);
