DROP INDEX `picks_week`;--> statement-breakpoint
CREATE UNIQUE INDEX `picks_week` ON `picks` (`week`,`position`);