CREATE TABLE IF NOT EXISTS sec_filing_sources (
 accession TEXT NOT NULL,
 provider TEXT NOT NULL,
 ticker TEXT NOT NULL,
 source_url TEXT NOT NULL,
 document_url TEXT,
 description_en TEXT,
 metadata_summary TEXT,
 received_at TEXT NOT NULL,
 PRIMARY KEY(accession,provider,ticker)
);
CREATE INDEX IF NOT EXISTS sec_sources_ticker ON sec_filing_sources(ticker,provider,accession);
