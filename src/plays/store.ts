import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { plays, tracks } from "../db/schema";
import { localTime } from "./localTime";
import { songKey } from "./song";

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
}

export function insertPlays(db: DbOrTx, input: PlayInput[], timezone: string): number {
  let inserted = 0;
  for (const batch of chunks(input)) {
    const rows = db
      .insert(plays)
      .values(batch.map((p) => ({ ...p, ...localTime(p.ts, timezone) })))
      .onConflictDoNothing({ target: plays.dedupeKey })
      .returning({ id: plays.id })
      .all();
    inserted += rows.length;
  }
  return inserted;
}
