CREATE TABLE `artists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`image_url` text,
	`fetched_at` integer,
	`fetch_attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `artists_name` ON `artists` (`name`);--> statement-breakpoint
CREATE TABLE `track_artists` (
	`track_uri` text NOT NULL,
	`artist_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`track_uri`, `position`),
	FOREIGN KEY (`track_uri`) REFERENCES `tracks`(`uri`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `track_artists_artist` ON `track_artists` (`artist_id`);--> statement-breakpoint
ALTER TABLE `tracks` ADD `art_attempts` integer DEFAULT 0 NOT NULL;