CREATE TABLE `fsc_index_history` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text DEFAULT '[]' NOT NULL,
	`covered_through` text DEFAULT '' NOT NULL,
	`received_at` text,
	`next_attempt` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`error_code` text
);
