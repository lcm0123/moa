-- IR provider IDs are NOT SEC accession numbers. Never join on date/form alone.
CREATE TABLE IF NOT EXISTS sec_ir_filings (
 id TEXT PRIMARY KEY, ticker TEXT NOT NULL, cik TEXT NOT NULL,
 provider TEXT NOT NULL, provider_id TEXT NOT NULL,
 form TEXT NOT NULL, topic TEXT NOT NULL, filed_date TEXT NOT NULL,
 filer_name TEXT, title_ko TEXT NOT NULL, summary_ko TEXT,
 source_url TEXT NOT NULL, document_url TEXT NOT NULL,
 source_received_at TEXT, collected_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 source_hash TEXT NOT NULL, version TEXT NOT NULL, state TEXT NOT NULL,
 UNIQUE(provider,cik,provider_id)
);
CREATE INDEX IF NOT EXISTS sec_ir_ticker_date ON sec_ir_filings(ticker,cik,filed_date DESC);
CREATE TABLE IF NOT EXISTS sec_ir_versions (
 id TEXT NOT NULL, source_hash TEXT NOT NULL, version TEXT NOT NULL,
 chunks TEXT NOT NULL, facts TEXT NOT NULL, raw_path TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(id,source_hash,version)
);
