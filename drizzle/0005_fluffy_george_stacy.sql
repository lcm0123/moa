CREATE TABLE `telegram_channels` (
	`username` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`channel_id` text,
	`status` text NOT NULL,
	`last_error` text,
	`heartbeat_at` text,
	`last_sync_at` text,
	`cursor` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `telegram_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` integer NOT NULL,
	`channel_username` text NOT NULL,
	`kind` text NOT NULL,
	`posted_at` text NOT NULL,
	`edited_at` text,
	`revision_at` text NOT NULL,
	`raw_text` text NOT NULL,
	`filename` text,
	`payload` text NOT NULL,
	`market` text,
	`ticker` text,
	`title` text,
	`source_url` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_telegram_message` ON `telegram_reports` (`channel_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `idx_telegram_reports_stock` ON `telegram_reports` (`market`,`ticker`,`posted_at`);--> statement-breakpoint
CREATE INDEX `idx_telegram_reports_kind` ON `telegram_reports` (`kind`,`posted_at`);