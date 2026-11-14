CREATE TABLE `library_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`rule_kind` text,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_plans_rule_kind_unique` ON `library_plans` (`rule_kind`);--> statement-breakpoint
ALTER TABLE `cleanup_batches` ADD `plan_id` integer;--> statement-breakpoint
ALTER TABLE `cleanup_batches` ADD `selected_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `cleanup_batches` ADD `skipped` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `cleanup_batches` ADD `status` text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE `cleanup_batches` ADD `error` text;--> statement-breakpoint
ALTER TABLE `cleanup_batches` ADD `calls` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cleanup_batches` ADD `finished_at` integer;--> statement-breakpoint
ALTER TABLE `cleanup_batches` ADD `undo_status` text;--> statement-breakpoint
ALTER TABLE `cleanup_batches` ADD `undo_error` text;--> statement-breakpoint
ALTER TABLE `cleanup_proposals` ADD `plan_id` integer;--> statement-breakpoint
ALTER TABLE `cleanup_proposals` ADD `action` text;--> statement-breakpoint
ALTER TABLE `cleanup_proposals` ADD `included` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `cleanup_proposals` ADD `reason` text;--> statement-breakpoint
CREATE INDEX `cleanup_proposals_plan` ON `cleanup_proposals` (`plan_id`,`status`);