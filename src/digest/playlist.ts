import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { recapPlaylists } from "../db/schema";
import { MissingScopeError, WRITE_SCOPE } from "../living/refresh";
import { playlistDescription } from "../sets/playlist";
import type { SpotifyClient } from "../spotify/client";
import { SpotifyApiError, SpotifyNotConnectedError } from "../spotify/errors";
import { recapPlaylistAbout, recapPlaylistName, recapPlaylistRow, uploadRecapCover, type RecapPlaylistRow } from "./cover";
import { coveredSpan, isRecapKey, type RecapKind } from "./periods";
import { RecapPeriodError } from "./service";
import { definingSongs, type DefiningSong } from "./songs";

export type RecapPlaylistDeps = { db: Db; spotify: SpotifyClient; now: () => number; today: string; fetchFn?: typeof fetch };

export class EmptyRecapPlaylistError extends Error {}

/** The songs of a period that has ended; a period still going has no playlist of its own. */
export function recapPlaylistSongs(db: Db, kind: RecapKind, key: string, today: string): DefiningSong[] {
  if (!isRecapKey(kind, key)) throw new RecapPeriodError("Not a period");
  const span = coveredSpan(kind, key, today);
  if (!span || span.inProgress) throw new RecapPeriodError("This period has not ended yet");
  return definingSongs(db, kind, span);
}

const isGone = (error: unknown) => error instanceof SpotifyApiError && error.status === 404;

/**
 * Saves the songs that defined an ended period as a private playlist in the owner's account, named after the period,
 * with a cover drawn from its art. The first save makes the playlist; saving again updates the same playlist in place,
 * or makes a new one when it was deleted in Spotify. Only ever called from the owner's tap.
 */
export async function saveRecapPlaylist(deps: RecapPlaylistDeps, kind: RecapKind, key: string) {
  const { db, spotify } = deps;
  const songs = recapPlaylistSongs(db, kind, key, deps.today);
  if (songs.length === 0) throw new EmptyRecapPlaylistError("No song was played often enough in this period");
  if (!spotify.connected()) throw new SpotifyNotConnectedError();
  if (!spotify.hasScope(WRITE_SCOPE)) throw new MissingScopeError(WRITE_SCOPE);
  const details = { name: recapPlaylistName(kind, key), description: playlistDescription(recapPlaylistAbout(kind, key)) };
  let row: RecapPlaylistRow | null = recapPlaylistRow(db, kind, key);
  if (row) {
    try {
      await spotify.updatePlaylistDetails(row.playlistId, details);
    } catch (error) {
      if (!isGone(error)) throw error;
      row = null;
    }
  }
  if (!row) {
    const created = await spotify.createPlaylist({ ...details, public: false });
    row = { kind, periodKey: key, playlistId: created.id, playlistUrl: created.external_urls.spotify, source: "recap", coverUploadKey: null, savedAt: deps.now() };
    db.insert(recapPlaylists)
      .values(row)
      .onConflictDoUpdate({ target: [recapPlaylists.kind, recapPlaylists.periodKey], set: row })
      .run();
  }
  await spotify.replacePlaylistItems(row.playlistId, songs.map((s) => s.uri));
  db.update(recapPlaylists)
    .set({ savedAt: deps.now() })
    .where(and(eq(recapPlaylists.kind, kind), eq(recapPlaylists.periodKey, key)))
    .run();
  const cover = await uploadRecapCover(deps, row, songs);
  return { playlistId: row.playlistId, playlistUrl: row.playlistUrl, tracks: songs.length, cover: { status: cover } };
}

/** Spotify playlist ids encore made for recaps, so library cleanup leaves them alone. */
export function recapPlaylistIds(db: Db): string[] {
  return db
    .select({ id: recapPlaylists.playlistId })
    .from(recapPlaylists)
    .all()
    .map((r) => r.id);
}
