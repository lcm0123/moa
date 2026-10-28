CREATE TABLE `sector_daily_history` (
	`id` text PRIMARY KEY NOT NULL,
	`market` text NOT NULL,
	`index_id` text NOT NULL,
	`day` text NOT NULL,
	`snapshot` text NOT NULL,
	`observed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sector_daily_market_index_day` ON `sector_daily_history` (`market`,`index_id`,`day`);