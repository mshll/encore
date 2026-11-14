import { and, eq, gte, inArray, ne, notInArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { ownedPlaylists, playlistItems, savedTracks } from "../db/schema";
import { saveSpotifyTrack } from "../ingest/live/enrich";
import type { SpotifyAuth } from "../spotify/auth";
import type { SpotifyClient } from "../spotify/client";
import type { Page, PlaylistEntry, SavedTrack, SimplifiedPlaylist, SpotifyTrack } from "../spotify/types";

export type SyncCursor =
  | { phase: "idle"; completedAt: number | null }
  | { phase: "saved"; passStartedAt: number; offset: number }
  | { phase: "playlists"; passStartedAt: number; offset: number; seen: string[]; queue: QueuedPlaylist[]; appSeen?: string[] }
  | { phase: "items"; passStartedAt: number; queue: QueuedPlaylist[]; offset: number };

type QueuedPlaylist = { id: string; snapshotId: string };

export type SyncStep = { cursor: SyncCursor; calls: number; passCompleted: boolean };

const PAGE = 50;
const isTrack = (track: SpotifyTrack | null | undefined): track is SpotifyTrack => Boolean(track?.uri?.startsWith("spotify:track:"));

export type LibrarySyncDeps = {
  db: Db;
  spotify: SpotifyClient;
  spotifyAuth: SpotifyAuth;
  appPlaylistIds: () => string[];
  /** Called once a pass has listed every playlist in the owner's library, with the encore playlists among them. */
  appPlaylistsListed?: (listed: Set<string>, listingStartedAt: number) => void;
};

async function ownerId({ spotify, spotifyAuth }: LibrarySyncDeps): Promise<string> {
  const known = spotifyAuth.status().userId;
  if (known) return known;
  const me = await spotify.me();
  spotifyAuth.setUserId(me.id);
  return me.id;
}

export function syncDue(cursor: SyncCursor, now: number, intervalMs: number): boolean {
  return cursor.phase !== "idle" || cursor.completedAt === null || now >= cursor.completedAt + intervalMs;
}

export async function syncStep(deps: LibrarySyncDeps, cursor: SyncCursor, now: number): Promise<SyncStep> {
  const { db, spotify } = deps;
  if (cursor.phase === "idle") return syncStep(deps, { phase: "saved", passStartedAt: now, offset: 0 }, now);

  if (cursor.phase === "saved") {
    const page = await spotify.request<Page<SavedTrack>>("GET", `/me/tracks?limit=${PAGE}&offset=${cursor.offset}`);
    const saved = page.items.filter((i) => isTrack(i.track));
    for (const item of saved) saveSpotifyTrack(db, item.track);
    for (const item of saved) {
      const row = { uri: item.track.uri, addedAt: Date.parse(item.added_at), syncedAt: cursor.passStartedAt };
      db.insert(savedTracks).values(row).onConflictDoUpdate({ target: savedTracks.uri, set: { addedAt: row.addedAt, syncedAt: row.syncedAt } }).run();
    }
    if (page.next) return { cursor: { ...cursor, offset: cursor.offset + PAGE }, calls: 1, passCompleted: false };
    db.delete(savedTracks).where(ne(savedTracks.syncedAt, cursor.passStartedAt)).run();
    return { cursor: { phase: "playlists", passStartedAt: cursor.passStartedAt, offset: 0, seen: [], queue: [] }, calls: 1, passCompleted: false };
  }

  if (cursor.phase === "playlists") {
    const me = await ownerId(deps);
    const page = await spotify.request<Page<SimplifiedPlaylist>>("GET", `/me/playlists?limit=${PAGE}&offset=${cursor.offset}`);
    const appOwned = new Set(deps.appPlaylistIds());
    const own = page.items.filter((p) => p && p.owner.id === me && !appOwned.has(p.id));
    const queue = [...cursor.queue];
    for (const p of own) {
      const stored = db.select().from(ownedPlaylists).where(eq(ownedPlaylists.id, p.id)).get();
      const itemCount = p.items?.total ?? p.tracks?.total ?? 0;
      db.insert(ownedPlaylists)
        .values({ id: p.id, name: p.name, snapshotId: stored?.snapshotId ?? null, itemCount, syncedAt: stored?.syncedAt ?? null })
        .onConflictDoUpdate({ target: ownedPlaylists.id, set: { name: p.name, itemCount } })
        .run();
      if (stored?.snapshotId !== p.snapshot_id || stored.syncedAt === null) queue.push({ id: p.id, snapshotId: p.snapshot_id });
    }
    const seen = [...cursor.seen, ...own.map((p) => p.id)];
    const appSeen = [...(cursor.appSeen ?? []), ...page.items.filter((p) => p && appOwned.has(p.id)).map((p) => p.id)];
    if (page.next) return { cursor: { ...cursor, offset: cursor.offset + PAGE, seen, queue, appSeen }, calls: 1, passCompleted: false };
    deps.appPlaylistsListed?.(new Set(appSeen), cursor.passStartedAt);
    const gone = db.select({ id: ownedPlaylists.id }).from(ownedPlaylists).where(notInArray(ownedPlaylists.id, seen.length ? seen : [""])).all().map((r) => r.id);
    if (gone.length) {
      db.delete(playlistItems).where(inArray(playlistItems.playlistId, gone)).run();
      db.delete(ownedPlaylists).where(inArray(ownedPlaylists.id, gone)).run();
    }
    return { cursor: { phase: "items", passStartedAt: cursor.passStartedAt, queue, offset: 0 }, calls: 1, passCompleted: false };
  }

  const [playlist, ...rest] = cursor.queue;
  if (!playlist) return { cursor: { phase: "idle", completedAt: now }, calls: 0, passCompleted: true };
  const playlistId = playlist.id;
  const page = await spotify.request<Page<PlaylistEntry>>("GET", `/playlists/${playlistId}/items?limit=${PAGE}&offset=${cursor.offset}`);
  page.items.forEach((entry, i) => {
    const track = entry.item ?? entry.track;
    const position = cursor.offset + i;
    if (!isTrack(track) || entry.is_local) {
      db.delete(playlistItems).where(and(eq(playlistItems.playlistId, playlistId), eq(playlistItems.position, position))).run();
      return;
    }
    saveSpotifyTrack(db, track);
    const row = { playlistId, position, uri: track.uri, addedAt: entry.added_at ? Date.parse(entry.added_at) : null };
    db.insert(playlistItems)
      .values(row)
      .onConflictDoUpdate({ target: [playlistItems.playlistId, playlistItems.position], set: { uri: row.uri, addedAt: row.addedAt } })
      .run();
  });
  if (page.next) return { cursor: { ...cursor, offset: cursor.offset + PAGE }, calls: 1, passCompleted: false };
  db.delete(playlistItems).where(and(eq(playlistItems.playlistId, playlistId), gte(playlistItems.position, page.total))).run();
  db.update(ownedPlaylists).set({ snapshotId: playlist.snapshotId, itemCount: page.total, syncedAt: now }).where(eq(ownedPlaylists.id, playlistId)).run();
  const next: SyncCursor = rest.length ? { phase: "items", passStartedAt: cursor.passStartedAt, queue: rest, offset: 0 } : { phase: "idle", completedAt: now };
  return { cursor: next, calls: 1, passCompleted: next.phase === "idle" };
}
