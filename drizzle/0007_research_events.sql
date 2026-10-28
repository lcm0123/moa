CREATE TABLE `research_event_sources` (
	`source_key` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_event_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`revision` integer NOT NULL,
	`recorded_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_research_event_version` ON `research_event_versions` (`event_id`,`revision`);--> statement-breakpoint
CREATE TABLE `research_events` (
	`id` text PRIMARY KEY NOT NULL,
	`security_key` text NOT NULL,
	`security_id` text NOT NULL,
	`kind` text NOT NULL,
	`event_date` text NOT NULL,
	`published_at` text,
	`published_date` text,
	`data_date` text,
	`collected_at` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`content_hash` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`payload` text NOT NULL,
	`merged_into` text
);
--> statement-breakpoint
CREATE INDEX `idx_research_events_security_date` ON `research_events` (`security_key`,`event_date`);--> statement-breakpoint
CREATE TABLE `research_reads` (
	`id` text PRIMARY KEY NOT NULL,
	`reader_hash` text NOT NULL,
	`event_id` text NOT NULL,
	`revision` integer NOT NULL,
	`read_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_research_reader_event` ON `research_reads` (`reader_hash`,`event_id`);--> statement-breakpoint
CREATE TABLE `research_securities` (
	`security_key` text PRIMARY KEY NOT NULL,
	`security_id` text NOT NULL,
	`market` text NOT NULL,
	`ticker` text NOT NULL,
	`issuer_id` text,
	`isin` text,
	`cusip` text,
	`evidence` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_research_security_id` ON `research_securities` (`security_id`);--> statement-breakpoint
CREATE TABLE `research_source_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`published_at` text,
	`data_date` text,
	`collected_at` text,
	`recorded_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_research_source_versions` ON `research_source_versions` (`source`,`source_id`);