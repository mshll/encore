CREATE TABLE `artist_aliases` (
	`alias` text PRIMARY KEY NOT NULL,
	`canonical` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `artist_aliases_canonical` ON `artist_aliases` (`canonical`);--> statement-breakpoint
CREATE TABLE `play_tombstones` (
	`dedupe_key` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`track_uri` text,
	`ts` integer NOT NULL,
	`ms_played` integer,
	`deleted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `play_tombstones_track_ts` ON `play_tombstones` (`track_uri`,`ts`);--> statement-breakpoint
CREATE TABLE `play_trash` (
	`id` integer PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`ts` integer NOT NULL,
	`day` text NOT NULL,
	`hour` integer NOT NULL,
	`weekday` integer NOT NULL,
	`kind` text NOT NULL,
	`track_uri` text,
	`episode_uri` text,
	`episode_name` text,
	`show_name` text,
	`ms_played` integer,
	`reason_start` text,
	`reason_end` text,
	`skipped` integer,
	`shuffle` integer,
	`offline` integer,
	`incognito` integer,
	`device` text NOT NULL,
	`platform_raw` text,
	`conn_country` text,
	`source` text NOT NULL,
	`context_uri` text,
	`trashed_at` integer NOT NULL,
	FOREIGN KEY (`track_uri`) REFERENCES `tracks`(`uri`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `play_trash_dedupe_key_unique` ON `play_trash` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `play_trash_ts` ON `play_trash` (`ts`);--> statement-breakpoint
ALTER TABLE `tracks` ADD `artist_credit` text;