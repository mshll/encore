CREATE TABLE `job_state` (
	`name` text PRIMARY KEY NOT NULL,
	`last_run_at` integer,
	`last_success_at` integer,
	`last_error` text,
	`data` text
);
--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`code_verifier` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer NOT NULL,
	`transports` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE TABLE `plays` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
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
	FOREIGN KEY (`track_uri`) REFERENCES `tracks`(`uri`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plays_dedupe_key_unique` ON `plays` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `plays_kind_day` ON `plays` (`kind`,`day`);--> statement-breakpoint
CREATE INDEX `plays_track_day` ON `plays` (`track_uri`,`day`);--> statement-breakpoint
CREATE INDEX `plays_ts` ON `plays` (`ts`);--> statement-breakpoint
CREATE INDEX `plays_source_ts` ON `plays` (`source`,`ts`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spotify_auth` (
	`id` integer PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`scope` text NOT NULL,
	`spotify_user_id` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `track_tags` (
	`song_key` text PRIMARY KEY NOT NULL,
	`track_uri` text NOT NULL,
	`genres` text NOT NULL,
	`subgenre` text,
	`moods` text NOT NULL,
	`energy` integer NOT NULL,
	`valence` integer NOT NULL,
	`language` text NOT NULL,
	`model` text NOT NULL,
	`confidence` text NOT NULL,
	`tagged_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tracks` (
	`uri` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`artist` text NOT NULL,
	`album` text,
	`song_key` text NOT NULL,
	`duration_ms` integer,
	`release_date` text,
	`album_art_url` text,
	`enriched_at` integer,
	`enrich_attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tracks_song_key` ON `tracks` (`song_key`);--> statement-breakpoint
CREATE INDEX `tracks_artist` ON `tracks` (`artist`);--> statement-breakpoint
CREATE INDEX `tracks_album` ON `tracks` (`artist`,`album`);