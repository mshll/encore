import type { LivingTrack } from "../db/schema";

const distinct = (tracks: LivingTrack[]) => [...new Map(tracks.map((t) => [t.songKey, t] as const)).values()];

/** A ranking rebuilt from scratch: the first `cap` distinct songs. */
export function replaceMerge(candidates: LivingTrack[], cap: number): LivingTrack[] {
  return distinct(candidates).slice(0, cap);
}

/**
 * New songs on top, the oldest fall off the end at `cap`. A song is added once per playlist: never again after it
 * fell off (`placed` holds every song key the playlist ever had). An empty playlist is filled to the cap; after that
 * at most `perRefresh` songs are added at a time.
 */
export function rollingMerge(current: LivingTrack[], candidates: LivingTrack[], opts: { cap: number; perRefresh: number; placed: Set<string> }): LivingTrack[] {
  const take = current.length === 0 ? opts.cap : opts.perRefresh;
  const fresh = distinct(candidates)
    .filter((t) => !opts.placed.has(t.songKey))
    .slice(0, take);
  return distinct([...fresh, ...current]).slice(0, opts.cap);
}
