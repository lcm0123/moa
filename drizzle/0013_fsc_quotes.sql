CREATE TABLE IF NOT EXISTS fsc_daily_snapshots (
 operation TEXT NOT NULL, base_date TEXT NOT NULL, synced_at TEXT NOT NULL,
 payload TEXT NOT NULL, PRIMARY KEY(operation,base_date)
);
CREATE TABLE IF NOT EXISTS fsc_sync_state (
 operation TEXT PRIMARY KEY, credential_version TEXT NOT NULL DEFAULT '',
 next_attempt INTEGER NOT NULL DEFAULT 0, last_attempt TEXT,
 last_success TEXT, base_date TEXT, error_code TEXT
);
