import { sql } from "drizzle-orm";
import type { Db } from "../db/client";

const hasLivingPlaylists = (db: Db) => db.all(sql`select 1 from sqlite_master where type = 'table' and name = 'living_playlists'`).length > 0;

/** Playlists encore made itself (DJ session, archive, saved sets, self-updating playlists). They are never part of the library and never cleaned. */
export function appOwnedPlaylistIds(db: Db): string[] {
  // living_playlists arrives with the self-updating playlists branch; read it whenever the table exists.
  const living = hasLivingPlaylists(db) ? sql` union select playlist_id as id from living_playlists where playlist_id is not null` : sql``;
  return db
    .all<{ id: string }>(sql`select playlist_id as id from app_playlists union select playlist_id as id from sets where playlist_id is not null${living}`)
    .map((r) => r.id);
}
