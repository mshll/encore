CREATE TABLE `conversation_turns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`position` integer NOT NULL,
	`message` text NOT NULL,
	`task` text NOT NULL,
	`outcome` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_turns_position` ON `conversation_turns` (`conversation_id`,`position`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`subject_kind` text,
	`subject_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rule_drafts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer,
	`name` text NOT NULL,
	`about` text,
	`rule` text NOT NULL,
	`count` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `library_plans` ADD `conversation_id` integer;--> statement-breakpoint
ALTER TABLE `sets` ADD `conversation_id` integer;