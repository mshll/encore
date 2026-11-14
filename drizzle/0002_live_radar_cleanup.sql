CREATE TABLE `app_playlists` (
	`purpose` text PRIMARY KEY NOT NULL,
	`playlist_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cleanup_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proposal_ids` text NOT NULL,
	`undo` text NOT NULL,
	`applied_at` integer NOT NULL,
	`undone_at` integer
);
--> statement-breakpoint
CREATE TABLE `cleanup_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`playlist_id` text,
	`uri` text NOT NULL,
	`evidence` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cleanup_proposals_key_unique` ON `cleanup_proposals` (`key`);--> statement-breakpoint
CREATE INDEX `cleanup_proposals_status` ON `cleanup_proposals` (`status`,`kind`);--> statement-breakpoint
CREATE TABLE `dj_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`playlist_id` text NOT NULL,
	`status` text NOT NULL,
	`uris` text NOT NULL,
	`position` integer NOT NULL,
	`outcomes` text NOT NULL,
	`skip_streak` integer DEFAULT 0 NOT NULL,
	`replans` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ended_at` integer,
	`end_reason` text
);
--> statement-breakpoint
CREATE TABLE `owned_playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`snapshot_id` text,
	`item_count` integer NOT NULL,
	`synced_at` integer
);
--> statement-breakpoint
CREATE TABLE `playlist_items` (
	`playlist_id` text NOT NULL,
	`position` integer NOT NULL,
	`uri` text NOT NULL,
	`added_at` integer,
	PRIMARY KEY(`playlist_id`, `position`)
);
--> statement-breakpoint
CREATE INDEX `playlist_items_uri` ON `playlist_items` (`uri`);--> statement-breakpoint
CREATE TABLE `radar_artists` (
	`artist_id` text PRIMARY KEY NOT NULL,
	`last_checked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `releases` (
	`id` text PRIMARY KEY NOT NULL,
	`uri` text NOT NULL,
	`artist_id` text NOT NULL,
	`artist_name` text NOT NULL,
	`name` text NOT NULL,
	`album_type` text NOT NULL,
	`release_date` text NOT NULL,
	`total_tracks` integer,
	`image_url` text,
	`first_seen_at` integer NOT NULL,
	`is_new` integer NOT NULL,
	`seen_at` integer
);
--> statement-breakpoint
CREATE INDEX `releases_date` ON `releases` (`release_date`);--> statement-breakpoint
CREATE INDEX `releases_artist` ON `releases` (`artist_id`);--> statement-breakpoint
CREATE TABLE `saved_tracks` (
	`uri` text PRIMARY KEY NOT NULL,
	`added_at` integer NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `plays` ADD `context_uri` text;