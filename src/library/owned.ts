import { sql } from "drizzle-orm";
import type { Db } from "../db/client";

/** Playlists encore made itself (DJ session, archive, saved sets, self-updating playlists, recap playlists). They are never part of the library and never cleaned. */
export function appOwnedPlaylistIds(db: Db): string[] {
  return db
    .all<{ id: string }>(
      sql`select playlist_id as id from app_playlists
        union select playlist_id as id from sets where playlist_id is not null
        union select playlist_id as id from living_playlists where playlist_id is not null
        union select playlist_id as id from recap_playlists`,
    )
    .map((r) => r.id);
}
