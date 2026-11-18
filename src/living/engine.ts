import { and, asc, desc, eq, gte, max, ne, sql, type SQL } from "drizzle-orm";
import { FINISHED, MUSIC, musicWhere, songStatsSql, type SongRow } from "../analytics/common";
import type { Db } from "../db/client";
import { picks, releases, releaseTracks, type LivingTrack } from "../db/schema";
import { artistKey, blockedSets, isBlocked } from "../library/blocks";
import { localTime } from "../plays/localTime";
import { isReissue } from "../radar/reissue";
import type { BuiltinSort, Rule, RuleFilters, RuleSource, RuleWindow, When } from "./rules";

/** `seed` orders a shuffle: the same seed gives the same order. */
export type BuildContext = { now: number; timezone: string; seed?: string };

/** Songs a rule hands to the merge: a rolling playlist needs more than it holds, to skip songs it already had. */
export const CANDIDATES = 200;
/** Hours in each window of a moment that follows the clock. */
export const WINDOW_HOURS = 3;

const DAY_MS = 86_400_000;

type Stats = { listens: number; ms: number; through: number; known: number; firstTs: number | null; lastTs: number | null };
type Candidate = LivingTrack & Stats & { releaseDate: string | null };
type StatsRow = SongRow & { through: number; release_date: string | null };

const NO_STATS: Stats = { listens: 0, ms: 0, through: 0, known: 0, firstTs: null, lastTs: null };

export const dayBefore = (day: string, days: number): string => new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

/** The local weekday and three-hour window a time falls in. */
export function momentOf(ts: number, timezone: string): { weekday: number; from: number; to: number } {
  const t = localTime(ts, timezone);
  const from = Math.floor(t.hour / WINDOW_HOURS) * WINDOW_HOURS;
  return { weekday: t.weekday, from, to: from + WINDOW_HOURS };
}

function statsSql(where: SQL): SQL {
  return sql`
    select s.*, x.through, x.release_date from (${songStatsSql(where)}) s
    join (
      select t.song_key as k, coalesce(sum(${FINISHED}), 0) as through, max(t.release_date) as release_date
      from ${MUSIC} where ${where} group by t.song_key
    ) x on x.k = s.song_key
    order by s.listens desc, s.ms desc, s.song_key`;
}

const fromStats = (r: StatsRow): Candidate => ({
  uri: r.uri,
  songKey: r.song_key,
  name: r.name,
  artist: r.artist,
  album: r.album,
  albumArtUrl: r.album_art_url,
  listens: r.listens,
  ms: r.ms,
  through: r.through,
  known: r.skip_known,
  firstTs: r.first_ts,
  lastTs: r.last_ts,
  releaseDate: r.release_date,
});

function windowWhere(window: RuleWindow, ctx: BuildContext): SQL {
  const today = localTime(ctx.now, ctx.timezone).day;
  switch (window.type) {
    case "all":
      return musicWhere({});
    case "days":
      return musicWhere({ from: dayBefore(today, window.days - 1), to: today });
    case "range":
      return musicWhere({ from: window.from, to: window.to });
    case "year-to-date":
      return musicWhere({ from: `${today.slice(0, 4)}-01-01`, to: today });
    case "month-in-past-years":
      return musicWhere({}, sql`substr(p.day, 6, 2) = ${today.slice(5, 7)}`, sql`p.day < ${`${today.slice(0, 4)}-01-01`}`);
  }
}

function momentWhere(source: Extract<RuleSource, { type: "moment" }>, ctx: BuildContext): SQL {
  const now = momentOf(ctx.now, ctx.timezone);
  const weekdays = source.weekdays === "today" ? [now.weekday] : source.weekdays;
  const hours = source.hours === "now" ? now : source.hours;
  return musicWhere(
    {},
    sql`p.weekday in (${sql.join(
      weekdays.map((d) => sql`${d}`),
      sql`, `,
    )})`,
    sql`p.hour >= ${hours.from} and p.hour < ${hours.to}`,
  );
}

/** Play statistics over all history for songs that come from outside it. */
function withStats(db: Db, tracks: (LivingTrack & { releaseDate?: string | null })[]): Candidate[] {
  const keys = [...new Set(tracks.map((t) => t.songKey))];
  if (keys.length === 0) return [];
  const rows = db.all<StatsRow>(
    statsSql(
      musicWhere(
        {},
        sql`t.song_key in (${sql.join(
          keys.map((k) => sql`${k}`),
          sql`, `,
        )})`,
      ),
    ),
  );
  const byKey = new Map(rows.map((r) => [r.song_key, fromStats(r)]));
  return tracks.map((t) => {
    const s = byKey.get(t.songKey);
    return { ...t, ...(s ? { listens: s.listens, ms: s.ms, through: s.through, known: s.known, firstTs: s.firstTs, lastTs: s.lastTs } : NO_STATS), releaseDate: t.releaseDate ?? s?.releaseDate ?? null };
  });
}

function picksSource(db: Db) {
  const week = db.select({ week: max(picks.week) }).from(picks).get()?.week;
  if (!week) return [];
  return db
    .select({ uri: picks.uri, songKey: picks.songKey, name: picks.name, artist: picks.artist, album: picks.album, albumArtUrl: picks.albumArtUrl, releaseDate: picks.releaseDate })
    .from(picks)
    .where(and(eq(picks.week, week), ne(picks.state, "never")))
    .orderBy(asc(picks.position))
    .all();
}

function releasesSource(db: Db, days: number, ctx: BuildContext) {
  const since = dayBefore(localTime(ctx.now, ctx.timezone).day, days);
  return db
    .select({ uri: releaseTracks.uri, songKey: releaseTracks.songKey, name: releaseTracks.name, artist: releaseTracks.artist, album: releases.name, albumArtUrl: releases.imageUrl, albumType: releases.albumType, releaseDate: releases.releaseDate })
    .from(releaseTracks)
    .innerJoin(releases, eq(releases.id, releaseTracks.releaseId))
    .where(and(eq(releases.isNew, true), gte(releases.releaseDate, since)))
    .orderBy(desc(releases.releaseDate), desc(releases.firstSeenAt), asc(releaseTracks.releaseId), asc(releaseTracks.position))
    .all()
    .filter((t) => !isReissue({ name: t.album, albumType: t.albumType }))
    .map(({ albumType: _, ...track }) => track);
}

function likedSource(db: Db): LivingTrack[] {
  return db
    .all<{ uri: string; song_key: string; name: string; artist: string; album: string | null; album_art_url: string | null }>(
      sql`select t.uri, t.song_key, t.name, t.artist, t.album, t.album_art_url from saved_tracks s join tracks t on t.uri = s.uri order by s.added_at desc, t.uri`,
    )
    .map((r) => ({ uri: r.uri, songKey: r.song_key, name: r.name, artist: r.artist, album: r.album, albumArtUrl: r.album_art_url }));
}

function sourceSongs(db: Db, source: RuleSource, ctx: BuildContext): Candidate[] {
  switch (source.type) {
    case "history":
      return db.all<StatsRow>(statsSql(windowWhere(source.window, ctx))).map(fromStats);
    case "moment":
      return db.all<StatsRow>(statsSql(momentWhere(source, ctx))).map(fromStats);
    case "releases":
      return withStats(db, releasesSource(db, source.days, ctx));
    case "picks":
      return withStats(db, picksSource(db));
    case "liked":
      return withStats(db, likedSource(db));
  }
}

function isBefore(ts: number, w: When, ctx: BuildContext): boolean {
  return "daysAgo" in w ? ts < ctx.now - w.daysAgo * DAY_MS : localTime(ts, ctx.timezone).day < w.day;
}

/** A song never played passes `lastPlayed.before` (it has not been played since) and fails every other time bound. */
function matches(c: Candidate, f: RuleFilters, ctx: BuildContext): boolean {
  if (f.listens?.min !== undefined && c.listens < f.listens.min) return false;
  if (f.listens?.max !== undefined && c.listens > f.listens.max) return false;
  if (f.lastPlayed?.before && c.lastTs !== null && !isBefore(c.lastTs, f.lastPlayed.before, ctx)) return false;
  if (f.lastPlayed?.after && (c.lastTs === null || isBefore(c.lastTs, f.lastPlayed.after, ctx))) return false;
  if (f.firstPlayed?.before && (c.firstTs === null || !isBefore(c.firstTs, f.firstPlayed.before, ctx))) return false;
  if (f.firstPlayed?.after && (c.firstTs === null || isBefore(c.firstTs, f.firstPlayed.after, ctx))) return false;
  const artist = artistKey(c.artist);
  if (f.artists?.include?.length && !f.artists.include.some((a) => artistKey(a) === artist)) return false;
  if (f.artists?.exclude?.some((a) => artistKey(a) === artist)) return false;
  if (f.releaseYears) {
    const year = c.releaseDate ? Number(c.releaseDate.slice(0, 4)) : null;
    if (year === null) return false;
    if (f.releaseYears.min !== undefined && year < f.releaseYears.min) return false;
    if (f.releaseYears.max !== undefined && year > f.releaseYears.max) return false;
  }
  if (f.keepers && c.known > 0 && c.through / c.known < f.keepers.minPlayedThrough) return false;
  return true;
}

/** SQLite orders text by its UTF-8 bytes; the JS string order differs past the Basic Multilingual Plane. */
const byKey = (a: Candidate, b: Candidate) => Buffer.compare(Buffer.from(a.songKey), Buffer.from(b.songKey));
const byListens = (a: Candidate, b: Candidate) => b.listens - a.listens || b.ms - a.ms || byKey(a, b);
const ORDER: Record<Exclude<BuiltinSort, "source" | "shuffle">, (a: Candidate, b: Candidate) => number> = {
  listens: byListens,
  "listens-by-key": (a, b) => b.listens - a.listens || byKey(a, b),
  recent: (a, b) => (b.lastTs ?? -Infinity) - (a.lastTs ?? -Infinity) || byKey(a, b),
  "first-played": (a, b) => (a.firstTs ?? Infinity) - (b.firstTs ?? Infinity) || byKey(a, b),
  keepers: (a, b) => b.through - a.through || byListens(a, b),
};

function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}

function sorted(songs: Candidate[], sort: BuiltinSort, seed: string): Candidate[] {
  if (sort === "source") return songs;
  if (sort !== "shuffle") return [...songs].sort(ORDER[sort]);
  const random = seededRandom(seed);
  const out = [...songs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function capPerArtist(songs: Candidate[], cap: number | undefined): Candidate[] {
  if (cap === undefined) return songs;
  const counts = new Map<string, number>();
  return songs.filter((s) => {
    const key = artistKey(s.artist);
    const n = counts.get(key) ?? 0;
    counts.set(key, n + 1);
    return n < cap;
  });
}

/** The songs a rule picks now, best first, from the local database only. Blocked songs and artists never pass. */
export function buildRule(db: Db, rule: Rule, ctx: BuildContext): LivingTrack[] {
  const blocked = blockedSets(db);
  const seen = new Set<string>();
  const songs = sourceSongs(db, rule.source, ctx).filter((s) => {
    if (seen.has(s.songKey)) return false;
    seen.add(s.songKey);
    return !isBlocked(blocked, s.songKey, [s.artist]) && matches(s, rule.filters, ctx);
  });
  return capPerArtist(sorted(songs, rule.sort, ctx.seed ?? ""), rule.perArtist)
    .slice(0, CANDIDATES)
    .map((s) => ({ uri: s.uri, songKey: s.songKey, name: s.name, artist: s.artist, album: s.album, albumArtUrl: s.albumArtUrl }));
}
