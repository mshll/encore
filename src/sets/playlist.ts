import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { setItems, sets } from "../db/schema";
import type { SpotifyClient } from "../spotify/client";
import { SetNotFoundError } from "./service";

const DESCRIPTION_LIMIT = 300;

export class EmptySetError extends Error {}

export const playlistDescription = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, DESCRIPTION_LIMIT);

/** Creates the set's private playlist on first save, then updates the same playlist in place. */
export async function saveSetPlaylist(db: Db, spotify: SpotifyClient, setId: number, now: number) {
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
  return { playlistId, playlistUrl, tracks: uris.length };
}
