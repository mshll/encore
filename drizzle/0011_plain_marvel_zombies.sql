CREATE TABLE `recap_playlists` (
	`kind` text NOT NULL,
	`period_key` text NOT NULL,
	`playlist_id` text NOT NULL,
	`playlist_url` text NOT NULL,
	`source` text NOT NULL,
	`cover_upload_key` text,
	`saved_at` integer NOT NULL,
	PRIMARY KEY(`kind`, `period_key`)
);
--> statement-breakpoint
CREATE TABLE `shares` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` integer NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`views` integer DEFAULT 0 NOT NULL,
	`last_viewed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_token` ON `shares` (`token_hash`);--> statement-breakpoint
CREATE INDEX `shares_ref` ON `shares` (`kind`,`ref_id`);--> statement-breakpoint
ALTER TABLE `digests` ADD `lines` text;