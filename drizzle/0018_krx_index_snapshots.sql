CREATE TABLE `krx_index_snapshots` (
	`base_date` text PRIMARY KEY NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`received_at` text,
	`next_attempt` integer DEFAULT 0 NOT NULL,
	`error_code` text
);
