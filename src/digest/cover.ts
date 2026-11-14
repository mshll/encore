import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { makeCover } from "../covers/render";
import type { Db } from "../db/client";
import { recapPlaylists } from "../db/schema";
import { coverArt } from "../sets/cover";
import type { SpotifyClient } from "../spotify/client";
import { periodLabel, type RecapKind } from "./periods";

export type RecapPlaylistRow = typeof recapPlaylists.$inferSelect;
export type CoverUploadStatus = "uploaded" | "unchanged" | "missing_scope" | "failed";

const UPLOAD_SCOPE = "ugc-image-upload";
/** Bump when the drawing changes, so every recap cover is drawn and uploaded again. */
const COVER_VERSION = 1;

export const recapPlaylistName = (kind: RecapKind, key: string) => periodLabel(kind, key);
export const recapPlaylistAbout = (kind: RecapKind, key: string) => `The songs that defined ${periodLabel(kind, key)}, from your encore recap.`;

export function recapPlaylistRow(db: Db, kind: RecapKind, key: string): RecapPlaylistRow | null {
  return (
    db
      .select()
      .from(recapPlaylists)
      .where(and(eq(recapPlaylists.kind, kind), eq(recapPlaylists.periodKey, key)))
      .get() ?? null
  );
}

/** Everything the cover is drawn from: the period's name and the art of its songs. */
export function recapCoverSource(kind: RecapKind, key: string, songs: { albumArtUrl: string | null }[]) {
  const source = { title: periodLabel(kind, key), art: coverArt(songs) };
  const hash = createHash("sha256").update(JSON.stringify([COVER_VERSION, source.title, source.art])).digest("hex").slice(0, 16);
  return { ...source, key: hash };
}

export const recapCoverUrl = (kind: RecapKind, key: string, coverKey: string) => `/api/digests/periods/${kind}/${key}/cover?v=${coverKey}`;

const drawn = new Map<string, Promise<Uint8Array>>();

/** The period's cover JPEG: album art behind the period's name. Drawn once per key and process. */
export function recapCover(source: ReturnType<typeof recapCoverSource>, fetchFn?: typeof fetch): Promise<Uint8Array> {
  let jpeg = drawn.get(source.key);
  if (!jpeg) {
    jpeg = makeCover({ title: source.title, covers: source.art, style: "field", fetchFn }).then((c) => c.jpeg);
    jpeg.catch(() => drawn.delete(source.key));
    drawn.set(source.key, jpeg);
  }
  return jpeg;
}

/** Uploads the period's cover to its playlist unless it already has it. A failure is logged and reported, never thrown. */
export async function uploadRecapCover(
  deps: { db: Db; spotify: SpotifyClient; fetchFn?: typeof fetch },
  row: RecapPlaylistRow,
  songs: { albumArtUrl: string | null }[],
): Promise<CoverUploadStatus> {
  const source = recapCoverSource(row.kind, row.periodKey, songs);
  if (row.coverUploadKey === source.key) return "unchanged";
  if (!deps.spotify.hasScope(UPLOAD_SCOPE)) return "missing_scope";
  try {
    await deps.spotify.uploadPlaylistCover(row.playlistId, await recapCover(source, deps.fetchFn));
    deps.db
      .update(recapPlaylists)
      .set({ coverUploadKey: source.key })
      .where(and(eq(recapPlaylists.kind, row.kind), eq(recapPlaylists.periodKey, row.periodKey)))
      .run();
    return "uploaded";
  } catch (error) {
    console.error(`Recap playlist ${row.kind} ${row.periodKey}: cover was not uploaded: ${error instanceof Error ? error.message : String(error)}`);
    return "failed";
  }
}
