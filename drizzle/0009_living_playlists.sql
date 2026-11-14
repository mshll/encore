CREATE TABLE `living_playlists` (
	`kind` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`playlist_id` text,
	`playlist_url` text,
	`created_at` integer,
	`removed_at` integer,
	`cover_upload_key` text,
	`status` text,
	`error` text,
	`attempted_at` integer,
	`checked_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `living_refreshes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`playlist_id` text NOT NULL,
	`trigger` text NOT NULL,
	`items` text NOT NULL,
	`added` text NOT NULL,
	`removed` text NOT NULL,
	`calls` integer NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `living_refreshes_kind` ON `living_refreshes` (`kind`,`at`);--> statement-breakpoint
CREATE TABLE `release_tracks` (
	`release_id` text NOT NULL,
	`position` integer NOT NULL,
	`uri` text NOT NULL,
	`song_key` text NOT NULL,
	`name` text NOT NULL,
	`artist` text NOT NULL,
	PRIMARY KEY(`release_id`, `position`)
);
--> statement-breakpoint
ALTER TABLE `releases` ADD `tracks_fetched_at` integer;