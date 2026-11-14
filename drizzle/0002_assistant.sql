CREATE TABLE `blocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blocks_kind_key` ON `blocks` (`kind`,`key`);--> statement-breakpoint
CREATE TABLE `digests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`period_key` text NOT NULL,
	`from_day` text NOT NULL,
	`to_day` text NOT NULL,
	`facts` text NOT NULL,
	`text` text NOT NULL,
	`model` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `digests_kind_period` ON `digests` (`kind`,`period_key`);--> statement-breakpoint
CREATE TABLE `llm_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`month` text NOT NULL,
	`feature` text NOT NULL,
	`ref` text,
	`requested_model` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cache_read_tokens` integer NOT NULL,
	`cache_write_tokens` integer NOT NULL,
	`web_searches` integer NOT NULL,
	`usd` real NOT NULL,
	`stop_reason` text,
	`duration_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_calls_month` ON `llm_calls` (`month`,`feature`);--> statement-breakpoint
CREATE TABLE `llm_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feature` text NOT NULL,
	`system` text NOT NULL,
	`messages` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `picks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`week` text NOT NULL,
	`position` integer NOT NULL,
	`uri` text NOT NULL,
	`song_key` text NOT NULL,
	`name` text NOT NULL,
	`artist` text NOT NULL,
	`album` text,
	`release_date` text,
	`reason` text NOT NULL,
	`distance` text NOT NULL,
	`state` text DEFAULT 'new' NOT NULL,
	`state_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`plays` integer DEFAULT 0 NOT NULL,
	`finished` integer DEFAULT 0 NOT NULL,
	`play_days` integer DEFAULT 0 NOT NULL,
	`in_library` integer,
	`first_played_at` integer
);
--> statement-breakpoint
CREATE INDEX `picks_week` ON `picks` (`week`,`position`);--> statement-breakpoint
CREATE INDEX `picks_song` ON `picks` (`song_key`);--> statement-breakpoint
CREATE TABLE `set_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`set_id` integer NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`song_key` text NOT NULL,
	`uri` text NOT NULL,
	`name` text NOT NULL,
	`artist` text NOT NULL,
	`album` text,
	`reason` text NOT NULL,
	`plays_after` integer DEFAULT 0 NOT NULL,
	`finished` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`first_played_at` integer,
	FOREIGN KEY (`set_id`) REFERENCES `sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `set_items_set` ON `set_items` (`set_id`,`position`);--> statement-breakpoint
CREATE INDEX `set_items_song` ON `set_items` (`song_key`);--> statement-breakpoint
CREATE TABLE `sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` integer NOT NULL,
	`request` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`version` integer NOT NULL,
	`playlist_id` text,
	`playlist_url` text,
	`saved_version` integer,
	`saved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `llm_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `spotify_lookups` (
	`query` text PRIMARY KEY NOT NULL,
	`result` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `track_notes` (
	`song_key` text PRIMARY KEY NOT NULL,
	`uri` text NOT NULL,
	`name` text NOT NULL,
	`artist` text NOT NULL,
	`text` text NOT NULL,
	`sources` text NOT NULL,
	`model` text NOT NULL,
	`created_at` integer NOT NULL
);
