CREATE TABLE `set_covers` (
	`set_id` integer PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`style` text NOT NULL,
	`partial` integer NOT NULL,
	`jpeg` blob NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `sets` ADD `cover_upload_key` text;