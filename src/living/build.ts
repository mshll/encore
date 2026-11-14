import { and, asc, desc, eq, gte, max, ne, sql } from "drizzle-orm";
import { musicWhere, songStatsSql, type SongRow } from "../analytics/common";
import { forgotten } from "../analytics/recall";
import { topTracks } from "../analytics/top";
import type { Db } from "../db/client";
import { picks, releases, releaseTracks, type LivingTrack } from "../db/schema";
import { definingSongs } from "../digest/songs";
import { localTime } from "../plays/localTime";

export type BuildContext = { now: number; timezone: string };

const DAY_MS = 86_400_000;
export const FORGOTTEN_AFTER_DAYS = 90;
export const FORGOTTEN_MIN_LISTENS = 10;
export const MOST_PLAYED_DAYS = 28;
export const MOST_PLAYED_MIN_LISTENS = 2;
export const NEW_RELEASE_DAYS = 90;
const CANDIDATES = 200;

const dayBefore = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

const fromSong = (s: { songKey: string; uri: string; name: string; artist: string; album: string | null; albumArtUrl: string | null }): LivingTrack => ({
  uri: s.uri,
  songKey: s.songKey,
  name: s.name,
  artist: s.artist,
  album: s.album,
  albumArtUrl: s.albumArtUrl,
});

/** The latest week of picks in pick order, without the ones the owner marked "never". */
export function picksTracks(db: Db): LivingTrack[] {
  const week = db.select({ week: max(picks.week) }).from(picks).get()?.week;
  if (!week) return [];
  return db
    .select()
    .from(picks)
    .where(and(eq(picks.week, week), ne(picks.state, "never")))
    .orderBy(asc(picks.position))
    .all()
    .map(fromSong);
}

/** Songs with many listens and no play in the last 90 days, most listened first: the Forgotten list in Music. */
export function forgottenTracks(db: Db, ctx: BuildContext): LivingTrack[] {
  return forgotten(db, { days: FORGOTTEN_AFTER_DAYS, minListens: FORGOTTEN_MIN_LISTENS, limit: CANDIDATES, asOf: ctx.now }).items.map(fromSong);
}

/** Most listens in the last four weeks, then the song key. A skip is no listen, so skips never lower a song. */
export function mostPlayedTracks(db: Db, ctx: BuildContext): LivingTrack[] {
  const today = localTime(ctx.now, ctx.timezone).day;
  return topTracks(db, { range: { from: dayBefore(today, MOST_PLAYED_DAYS - 1), to: today }, limit: CANDIDATES, sort: "listens" })
    .filter((s) => s.listens >= MOST_PLAYED_MIN_LISTENS)
    .map(fromSong);
}

/** What the owner listened to most in this calendar month of every earlier year. */
export function thisMonthTracks(db: Db, ctx: BuildContext): LivingTrack[] {
  const today = localTime(ctx.now, ctx.timezone).day;
  const where = musicWhere({}, sql`substr(p.day, 6, 2) = ${today.slice(5, 7)}`, sql`p.day < ${`${today.slice(0, 4)}-01-01`}`);
  return db
    .all<SongRow>(sql`select * from (${songStatsSql(where)}) where listens > 0 order by listens desc, ms desc, song_key limit ${CANDIDATES}`)
    .map((r) => ({ uri: r.uri, songKey: r.song_key, name: r.name, artist: r.artist, album: r.album, albumArtUrl: r.album_art_url }));
}

/** The songs that defined the year so far, by the recap playlist rule: most listens, then most time, at least two listens. */
export function thisYearTracks(db: Db, ctx: BuildContext, cap: number): LivingTrack[] {
  const today = localTime(ctx.now, ctx.timezone).day;
  return yearTracks(db, { from: `${today.slice(0, 4)}-01-01`, to: today }, cap);
}

export function yearTracks(db: Db, span: { from: string; to: string }, cap: number): LivingTrack[] {
  return definingSongs(db, "yearly", span, cap).map(fromSong);
}

/** Stored tracks of new releases from the last 90 days, newest release first, in album order. */
export function newReleaseTracks(db: Db, ctx: BuildContext): LivingTrack[] {
  const since = dayBefore(localTime(ctx.now, ctx.timezone).day, NEW_RELEASE_DAYS);
  return db
    .select({ uri: releaseTracks.uri, songKey: releaseTracks.songKey, name: releaseTracks.name, artist: releaseTracks.artist, album: releases.name, albumArtUrl: releases.imageUrl })
    .from(releaseTracks)
    .innerJoin(releases, eq(releases.id, releaseTracks.releaseId))
    .where(and(eq(releases.isNew, true), gte(releases.releaseDate, since)))
    .orderBy(desc(releases.releaseDate), desc(releases.firstSeenAt), asc(releaseTracks.releaseId), asc(releaseTracks.position))
    .limit(CANDIDATES)
    .all();
}

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
