ALTER TABLE `living_playlists` ADD `name` text;--> statement-breakpoint
ALTER TABLE `living_playlists` ADD `about` text;--> statement-breakpoint
ALTER TABLE `living_playlists` ADD `rule` text;--> statement-breakpoint
ALTER TABLE `living_playlists` ADD `defined_at` integer;--> statement-breakpoint
ALTER TABLE `living_playlists` ADD `frozen` integer DEFAULT false NOT NULL;