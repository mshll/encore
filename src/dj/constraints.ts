import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { sets, setSessions, tracks } from "../db/schema";
import { blockedSets, isBlocked } from "../library/blocks";
import { CapTally, exclusion, NO_CONSTRAINTS, withDefaults, type ConstraintDefaults, type Constraints } from "../library/constraints";

/** The set's constraints for a session started from a set, else the defaults. */
export function sessionConstraints(db: Db, sessionId: number, defaults: ConstraintDefaults): Constraints {
  const row = db
    .select({ constraints: sets.constraints })
    .from(setSessions)
    .innerJoin(sets, eq(sets.id, setSessions.setId))
    .where(eq(setSessions.sessionId, sessionId))
    .get();
  return row ? (row.constraints ?? NO_CONSTRAINTS) : withDefaults(defaults);
}

/**
 * Drops the songs a re-plan added that break the constraints or a block. Songs already planned stay and count
 * towards the caps, as do the played songs in `exclude`. Songs missing from `tracks` cannot be checked and stay.
 */
export function constrainTail(db: Db, input: { exclude: string[]; upcoming: string[] }, proposed: string[], c: Constraints): string[] {
  const uris = [...new Set([...input.exclude, ...proposed])];
  if (uris.length === 0) return proposed;
  const info = new Map(
    db
      .select({ uri: tracks.uri, name: tracks.name, artist: tracks.artist, album: tracks.album, songKey: tracks.songKey })
      .from(tracks)
      .where(inArray(tracks.uri, uris))
      .all()
      .map((t) => [t.uri, { ...t, artists: [t.artist] }]),
  );
  const planned = new Set(input.upcoming);
  const blocked = blockedSets(db);
  const tally = new CapTally(c);
  for (const uri of [...input.exclude, ...proposed.filter((u) => planned.has(u))]) {
    const song = info.get(uri);
    if (song) tally.add(song);
  }
  return proposed.filter((uri) => {
    const song = info.get(uri);
    if (planned.has(uri) || !song) return true;
    if (isBlocked(blocked, song.songKey, song.artists) || exclusion(c, song) || !tally.fits(song)) return false;
    tally.add(song);
    return true;
  });
}
