CREATE TABLE `set_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`set_id` integer NOT NULL,
	`version` integer NOT NULL,
	`source` text NOT NULL,
	`message` text,
	`added` text NOT NULL,
	`removed` text NOT NULL,
	`moved` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `set_changes_set` ON `set_changes` (`set_id`,`version`);--> statement-breakpoint
ALTER TABLE `dj_sessions` ADD `replanned_at` integer;--> statement-breakpoint
ALTER TABLE `dj_sessions` ADD `replan_skips` integer;--> statement-breakpoint
ALTER TABLE `set_items` ADD `pinned` integer DEFAULT false NOT NULL;