-- Releases stored under the checked artist's id but led by another artist. Removing them and the check time of their
-- artists makes the next radar run store them again under the album's own lead artist.
CREATE TEMP TABLE `misattributed_releases` AS
  SELECT r.`id`, r.`artist_id` FROM `releases` r JOIN `artists` a ON a.`id` = r.`artist_id` WHERE a.`name` <> r.`artist_name`;
--> statement-breakpoint
DELETE FROM `release_tracks` WHERE `release_id` IN (SELECT `id` FROM `misattributed_releases`);
--> statement-breakpoint
DELETE FROM `radar_artists` WHERE `artist_id` IN (SELECT `artist_id` FROM `misattributed_releases`);
--> statement-breakpoint
DELETE FROM `releases` WHERE `id` IN (SELECT `id` FROM `misattributed_releases`);
--> statement-breakpoint
DROP TABLE `misattributed_releases`;
