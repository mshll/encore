import { createHash } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { isArtUrl } from "../covers/art";
import { coverTitleClamped, makeCover } from "../covers/render";
import type { CoverStyle } from "../covers/style";
import type { Db } from "../db/client";
import { setCovers, setItems, sets } from "../db/schema";
import { withArtwork } from "../library/artwork";
import type { SpotifyClient } from "../spotify/client";

export const SET_COVER_STYLE: CoverStyle = "field";
/** Bump when the drawing changes, so every cover is redrawn and uploaded again. */
const COVER_VERSION = 1;
const MAX_ART = 8;
const PARTIAL_RETRY_MS = 60 * 60_000;
const UPLOAD_SCOPE = "ugc-image-upload";

export type CoverSource = { title: string; style: CoverStyle; art: string[] };
export type SetCoverSource = CoverSource & { key: string };
export type StoredCover = typeof setCovers.$inferSelect;
export type CoverUpload = { status: "uploaded" | "unchanged" | "missing_scope" | "failed" };
export type CoverOptions = { fetchFn?: typeof fetch; now: number };

/** Distinct album art on Spotify's image CDN, in set order, at most 8. */
export function coverArt(items: { albumArtUrl: string | null }[]): string[] {
  return [...new Set(items.map((i) => i.albumArtUrl).filter((u): u is string => !!u && isArtUrl(u)))].slice(0, MAX_ART);
}

/** Everything the image is drawn from, hashed: the same key means the same cover. */
export function coverKey(source: CoverSource): string {
  // Only a clamped title adds to the key, so every other cover keeps the key it was uploaded under.
  const clamped = coverTitleClamped(source.title) ? ["title-clamped"] : [];
  return createHash("sha256")
    .update(JSON.stringify([COVER_VERSION, source.title, source.style, source.art, ...clamped]))
    .digest("hex")
    .slice(0, 16);
}

export const coverUrl = (setId: number, key: string) => `/api/sets/${setId}/cover?v=${key}`;

/** Cover sources of the given sets; sets without tracks have none. */
export function setCoverSources(db: Db, rows: { id: number; title: string }[]): Map<number, SetCoverSource> {
  const ids = rows.map((r) => r.id);
  const items = ids.length ? db.select().from(setItems).where(inArray(setItems.setId, ids)).orderBy(asc(setItems.setId), asc(setItems.position)).all() : [];
  const bySet = new Map<number, typeof items>();
  for (const item of withArtwork(db, items)) bySet.set(item.setId, [...(bySet.get(item.setId) ?? []), item]);
  const out = new Map<number, SetCoverSource>();
  for (const row of rows) {
    const setItemsWithArt = bySet.get(row.id);
    if (!setItemsWithArt?.length) continue;
    const source = { title: row.title, style: SET_COVER_STYLE, art: coverArt(setItemsWithArt) };
    out.set(row.id, { ...source, key: coverKey(source) });
  }
  return out;
}

export function setCoverSource(db: Db, setId: number): SetCoverSource | null {
  const row = db.select({ id: sets.id, title: sets.title }).from(sets).where(eq(sets.id, setId)).get();
  return row ? (setCoverSources(db, [row]).get(setId) ?? null) : null;
}

const drawing = new Map<string, Promise<StoredCover>>();

async function draw(db: Db, setId: number, source: SetCoverSource, opts: CoverOptions): Promise<StoredCover> {
  const cover = await makeCover({ title: source.title, covers: source.art, style: source.style, fetchFn: opts.fetchFn });
  const row: StoredCover = { setId, key: source.key, style: cover.style, partial: cover.partial, jpeg: Buffer.from(cover.jpeg), createdAt: opts.now };
  db.insert(setCovers).values(row).onConflictDoUpdate({ target: setCovers.setId, set: row }).run();
  return row;
}

/**
 * The stored cover for the set's current source, drawn when missing or stale. A cover drawn with some art missing is
 * redrawn after an hour, or at once with `retryPartial`. One drawing per set and key at a time.
 */
export function ensureSetCover(db: Db, setId: number, source: SetCoverSource, opts: CoverOptions & { retryPartial?: boolean }): Promise<StoredCover> {
  const stored = db.select().from(setCovers).where(eq(setCovers.setId, setId)).get();
  const stale = !stored || stored.key !== source.key || (stored.partial && (opts.retryPartial || stored.createdAt < opts.now - PARTIAL_RETRY_MS));
  if (!stale) return Promise.resolve(stored);
  const id = `${setId}:${source.key}`;
  const pending = drawing.get(id) ?? draw(db, setId, source, opts).finally(() => drawing.delete(id));
  drawing.set(id, pending);
  return pending;
}

/** Uploads the set's cover to its playlist unless the playlist already has this cover. A failure is reported, never thrown. */
export async function uploadSetCover(db: Db, spotify: SpotifyClient, setId: number, playlistId: string, opts: CoverOptions): Promise<CoverUpload> {
  const source = setCoverSource(db, setId);
  if (!source) return { status: "unchanged" };
  const uploaded = db.select({ key: sets.coverUploadKey }).from(sets).where(eq(sets.id, setId)).get()?.key;
  const stored = db.select({ key: setCovers.key, partial: setCovers.partial }).from(setCovers).where(eq(setCovers.setId, setId)).get();
  if (uploaded === source.key && stored?.key === source.key && !stored.partial) return { status: "unchanged" };
  if (!spotify.hasScope(UPLOAD_SCOPE)) return { status: "missing_scope" };
  try {
    const cover = await ensureSetCover(db, setId, source, { ...opts, retryPartial: true });
    await spotify.uploadPlaylistCover(playlistId, cover.jpeg);
    db.update(sets).set({ coverUploadKey: source.key }).where(eq(sets.id, setId)).run();
    return { status: "uploaded" };
  } catch (error) {
    console.error(`Set ${setId} cover was not uploaded: ${error instanceof Error ? error.message : String(error)}`);
    return { status: "failed" };
  }
}
