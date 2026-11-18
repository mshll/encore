import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { artists, plays, trackArtists, tracks } from "../db/schema";
import { syncAliases } from "../artists/aliases";
import { localTime } from "./localTime";
import { songKey } from "./song";
import { tombstonedKeys } from "./trash";

export type TrackInput = {
  uri: string;
  name: string;
  artist: string;
  album: string | null;
  durationMs?: number | null;
  releaseDate?: string | null;
  albumArtUrl?: string | null;
  complete?: boolean;
};

export type PlayInput = Omit<typeof plays.$inferInsert, "id" | "day" | "hour" | "weekday">;

const chunkSize = 500;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) out.push(items.slice(i, i + chunkSize));
  return out;
}

export function upsertTracks(db: DbOrTx, input: TrackInput[], now = Date.now()) {
  const unique = [...new Map(input.map((t) => [t.uri, t])).values()];
  for (const batch of chunks(unique)) {
    db.insert(tracks)
      .values(
        batch.map((t) => ({
          uri: t.uri,
          name: t.name,
          artist: t.artist,
          album: t.album,
          songKey: songKey(t.name, t.artist),
          durationMs: t.durationMs ?? null,
          releaseDate: t.releaseDate ?? null,
          albumArtUrl: t.albumArtUrl ?? null,
          enrichedAt: t.complete ? now : null,
        })),
      )
      .onConflictDoUpdate({
        target: tracks.uri,
        set: {
          durationMs: sql`coalesce(${tracks.durationMs}, excluded.duration_ms)`,
          releaseDate: sql`coalesce(${tracks.releaseDate}, excluded.release_date)`,
          albumArtUrl: sql`coalesce(${tracks.albumArtUrl}, excluded.album_art_url)`,
          enrichedAt: sql`coalesce(${tracks.enrichedAt}, excluded.enriched_at)`,
        },
      })
      .run();
  }
  syncAliases(db);
}

export type ArtistInput = { id: string; name: string };

export function linkArtists(db: DbOrTx, trackUri: string, input: ArtistInput[]) {
  if (input.length === 0) return;
  db.insert(artists)
    .values(input.map((a) => ({ id: a.id, name: a.name })))
    .onConflictDoUpdate({ target: artists.id, set: { name: sql`excluded.name` } })
    .run();
  db.delete(trackArtists).where(sql`${trackArtists.trackUri} = ${trackUri}`).run();
  db.insert(trackArtists)
    .values(input.map((a, position) => ({ trackUri, artistId: a.id, position })))
    .run();
}

/** Where stored history starts: plays are bucketed in `timezone`, and those on a local day before `historyStart` are never stored. */
export type HistoryWindow = { timezone: string; historyStart?: string };

export function beforeHistoryStart(ts: number, window: HistoryWindow): boolean {
  return window.historyStart !== undefined && localTime(ts, window.timezone).day < window.historyStart;
}

/** Inserts the plays inside the window that were never deleted; returns how many rows were new. */
export function insertPlays(db: DbOrTx, input: PlayInput[], window: HistoryWindow): number {
  const deleted = tombstonedKeys(
    db,
    input.map((p) => p.dedupeKey),
  );
  const inside = input
    .filter((p) => !deleted.has(p.dedupeKey))
    .map((p) => ({ ...p, ...localTime(p.ts, window.timezone) }))
    .filter((p) => window.historyStart === undefined || p.day >= window.historyStart);
  let inserted = 0;
  for (const batch of chunks(inside)) {
    const rows = db
      .insert(plays)
      .values(batch)
      .onConflictDoNothing({ target: plays.dedupeKey })
      .returning({ id: plays.id })
      .all();
    inserted += rows.length;
  }
  return inserted;
}
