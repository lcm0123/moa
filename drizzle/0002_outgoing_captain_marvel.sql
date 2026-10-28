CREATE TABLE `calendar_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`featured` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finviz_memberships` (
	`index_id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`members` text NOT NULL,
	`changes` text NOT NULL,
	`observed_at` text NOT NULL
);
