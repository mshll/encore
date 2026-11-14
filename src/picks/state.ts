import { eq } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { picks, type PickState } from "../db/schema";
import { addBlock, artistKey, removeBlock } from "../library/blocks";

export const ARTIST_BLOCK_AFTER_NEVERS = 2;

export class PickNotFoundError extends Error {}

function neverCountForArtist(db: DbOrTx, artist: string): number {
  return db
    .select({ artist: picks.artist })
    .from(picks)
    .where(eq(picks.state, "never"))
    .all()
    .filter((p) => artistKey(p.artist) === artistKey(artist)).length;
}

/**
 * "never" blocks the song; a second "never" for the same artist blocks the artist.
 * Leaving "never" lifts the song block, and the artist block once fewer than two nevers remain.
 */
export function setPickState(db: Db, id: number, state: PickState, now: number) {
  const pick = db.select().from(picks).where(eq(picks.id, id)).get();
  if (!pick) throw new PickNotFoundError();
  if (pick.state === state) return pick;
  db.transaction((tx) => {
    tx.update(picks).set({ state, stateAt: now }).where(eq(picks.id, id)).run();
    if (state === "never") {
      addBlock(tx, "song", pick.songKey, `${pick.name} - ${pick.artist}`, `never on weekly pick ${pick.week}`, now);
      if (neverCountForArtist(tx, pick.artist) >= ARTIST_BLOCK_AFTER_NEVERS) addBlock(tx, "artist", artistKey(pick.artist), pick.artist, "two weekly picks marked never", now);
    } else if (pick.state === "never") {
      removeBlock(tx, "song", pick.songKey);
      if (neverCountForArtist(tx, pick.artist) < ARTIST_BLOCK_AFTER_NEVERS) removeBlock(tx, "artist", artistKey(pick.artist));
    }
  });
  return db.select().from(picks).where(eq(picks.id, id)).get()!;
}
