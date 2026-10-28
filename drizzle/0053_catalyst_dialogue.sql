-- Dialogue ownership/context only. Jobs, evidence, usage and queue remain shared infrastructure.
CREATE TABLE IF NOT EXISTS catalyst_dialogue (
 job_id TEXT PRIMARY KEY REFERENCES catalyst_research_jobs(id),
 reader_hash TEXT NOT NULL,
 conversation_id TEXT NOT NULL,
 parent_job_id TEXT,
 context TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS catalyst_dialogue_owner ON catalyst_dialogue(reader_hash,conversation_id,created_at);
