CREATE TABLE IF NOT EXISTS document_reading_state (
 reader_hash TEXT NOT NULL,
 report_id TEXT NOT NULL,
 document_version TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 state_json TEXT NOT NULL,
 opened_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(reader_hash,report_id,document_version)
);
