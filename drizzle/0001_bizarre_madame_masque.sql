CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`country` text NOT NULL,
	`importance` text NOT NULL,
	`featured` integer DEFAULT 0 NOT NULL,
	`starts_at` integer,
	`date_kst` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_calendar_events_date_time` ON `calendar_events` (`date_kst`,`starts_at`);