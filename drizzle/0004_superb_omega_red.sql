CREATE TABLE `sector_reconstructed_history` (
	`id` text PRIMARY KEY NOT NULL,
	`market` text NOT NULL,
	`index_id` text NOT NULL,
	`day` text NOT NULL,
	`snapshot` text NOT NULL,
	`calculated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sector_reconstructed_market_index_day` ON `sector_reconstructed_history` (`market`,`index_id`,`day`);