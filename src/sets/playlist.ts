import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { setItems, sets } from "../db/schema";
import type { SpotifyClient } from "../spotify/client";
import { uploadSetCover } from "./cover";
import { SetNotFoundError } from "./service";

const DESCRIPTION_LIMIT = 300;

export class EmptySetError extends Error {}

export const playlistDescription = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, DESCRIPTION_LIMIT);

/**
 * Creates the set's private playlist on first save, then updates the same playlist in place, and uploads the set's cover
 * when it changed. A cover that fails is reported in `cover`; the save still stands.
 */
export async function saveSetPlaylist(db: Db, spotify: SpotifyClient, setId: number, now: number, fetchArt: typeof fetch = fetch) {
  const set = db.select().from(sets).where(eq(sets.id, setId)).get();
  if (!set) throw new SetNotFoundError();
  const uris = db
    .select({ uri: setItems.uri })
    .from(setItems)
    .where(eq(setItems.setId, setId))
    .orderBy(setItems.position)
    .all()
    .map((r) => r.uri);
  if (uris.length === 0) throw new EmptySetError("The set has no tracks yet");
  const details = { name: set.title, description: playlistDescription(set.description) };
  let { playlistId, playlistUrl } = set;
  if (!playlistId) {
    const created = await spotify.createPlaylist({ ...details, public: false });
    playlistId = created.id;
    playlistUrl = created.external_urls.spotify;
    db.update(sets).set({ playlistId, playlistUrl }).where(eq(sets.id, setId)).run();
  } else {
    await spotify.updatePlaylistDetails(playlistId, details);
  }
  await spotify.replacePlaylistItems(playlistId, uris);
  db.update(sets)
    .set({ savedVersion: set.version, savedAt: set.savedAt ?? now })
    .where(eq(sets.id, setId))
    .run();
  const cover = await uploadSetCover(db, spotify, setId, playlistId, { fetchFn: fetchArt, now });
  return { playlistId, playlistUrl, tracks: uris.length, cover };
}

/** A failed update is logged, not thrown: the set's change stands and the set stays outdated for a manual update. */
export async function syncSetPlaylist(db: Db, spotify: SpotifyClient, setId: number, now: number, fetchArt: typeof fetch = fetch): Promise<void> {
  const set = db.select({ playlistId: sets.playlistId, version: sets.version, savedVersion: sets.savedVersion }).from(sets).where(eq(sets.id, setId)).get();
  if (!set?.playlistId || set.savedVersion === set.version) return;
  try {
    await saveSetPlaylist(db, spotify, setId, now, fetchArt);
  } catch (error) {
    console.error(`Set ${setId} playlist was not updated: ${error instanceof Error ? error.message : String(error)}`);
  }
}
