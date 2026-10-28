-- A-stage only: keep the existing latest-value cache and add a publication fence
-- plus immutable observation changes. No historical/provider vintage backfill.
CREATE TABLE fred_macro_refresh_fences (
 cache_key TEXT PRIMARY KEY,
 generation INTEGER NOT NULL CHECK(generation > 0),
 owner_token TEXT NOT NULL,
 requested_at TEXT NOT NULL
);
CREATE TABLE fred_observation_revisions (
 series_id TEXT NOT NULL,
 observation_date TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision >= 0),
 value_exact TEXT,
 observation_state TEXT NOT NULL CHECK(observation_state IN ('VALUE','MISSING','ABSENT_FROM_RESPONSE')),
 provider_realtime_start TEXT,
 provider_realtime_end TEXT,
 received_at TEXT,
 recorded_at TEXT NOT NULL,
 source_identifier TEXT NOT NULL,
 source_hash TEXT NOT NULL,
 hash_scope TEXT NOT NULL DEFAULT 'NORMALIZED_RESPONSE_OBSERVATIONS',
 replay_eligibility TEXT NOT NULL DEFAULT 'HELD_PROVIDER_VINTAGE_UNVERIFIED',
 provenance TEXT NOT NULL CHECK(provenance IN ('FETCHED','EXISTING_CACHE')),
 PRIMARY KEY(series_id,observation_date,revision)
);
CREATE TRIGGER fred_observation_revision_immutable BEFORE UPDATE ON fred_observation_revisions BEGIN
 SELECT RAISE(ABORT,'FRED_OBSERVATION_REVISION_IMMUTABLE');
END;
CREATE TRIGGER fred_observation_revision_no_delete BEFORE DELETE ON fred_observation_revisions BEGIN
 SELECT RAISE(ABORT,'FRED_OBSERVATION_REVISION_IMMUTABLE');
END;
