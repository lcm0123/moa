CREATE TABLE `fsc_stock_history` (
	`id` text PRIMARY KEY NOT NULL,
	`operation` text NOT NULL,
	`stock_id` text NOT NULL,
	`isin` text NOT NULL,
	`payload` text DEFAULT '[]' NOT NULL,
	`covered_through` text DEFAULT '' NOT NULL,
	`source_count` integer DEFAULT 0 NOT NULL,
	`received_at` text,
	`next_attempt` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`error_code` text
);
