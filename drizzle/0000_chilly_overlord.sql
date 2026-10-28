CREATE TABLE `search_events` (
	`id` text PRIMARY KEY NOT NULL,
	`stock_id` text NOT NULL,
	`name` text NOT NULL,
	`ticker` text NOT NULL,
	`market` text NOT NULL,
	`session_hash` text NOT NULL,
	`minute_bucket` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_search_events_created_market` ON `search_events` (`created_at`,`market`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_search_events_session_stock_minute` ON `search_events` (`session_hash`,`stock_id`,`market`,`minute_bucket`);