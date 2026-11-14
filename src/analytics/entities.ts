import { eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { tracks } from "../db/schema";
import { hours, LISTEN, MS, MUSIC, musicWhere, periodExpr, type Period, type Range, songStatsSql, songWithStats, STATS, stats, type SongRow, type StatsRow, withArtistImages } from "./common";
import { classify, skipProfile, type ContextDimension, type ContextStat } from "./skips";

type EntityParams = { range: Range; period: Period; weekendDays: readonly number[] };

function base(db: Db, where: SQL, { period, weekendDays }: Pick<EntityParams, "period" | "weekendDays">) {
  const totals = db.all<StatsRow>(sql`select ${STATS} from ${MUSIC} where ${where}`)[0]!;
  if (totals.plays === 0) return null;
  const timeline = db.all<{ period: string; ms: number; plays: number; listens: number }>(sql`
    select ${periodExpr(period)} as period, sum(${MS}) as ms, count(*) as plays, sum(${LISTEN}) as listens
    from ${MUSIC} where ${where} group by period order by period`);
  return {
    totals: stats(totals),
    timeline: timeline.map((t) => ({ period: t.period, hours: hours(t.ms), plays: t.plays, listens: t.listens })),
    skipProfile: skipProfile(db, where, weekendDays),
  };
}

function songs(db: Db, where: SQL, limit = 50) {
  return db.all<SongRow>(sql`select * from (${songStatsSql(where)}) order by ms desc, song_key limit ${limit}`).map(songWithStats);
}

export function artistPage(db: Db, { artist, range, period, weekendDays }: EntityParams & { artist: string }) {
  const where = musicWhere(range, sql`t.artist = ${artist}`);
  const page = base(db, where, { period, weekendDays });
  if (!page) return null;
  const albums = db.all<StatsRow & { album: string; album_art_url: string | null }>(sql`
    select t.album, max(t.album_art_url) as album_art_url, ${STATS} from ${MUSIC}
    where ${where} and t.album is not null group by t.album order by ms desc`);
  return {
    artist,
    imageUrl: withArtistImages(db, [{ artist }])[0]!.imageUrl,
    ...page,
    tracks: songs(db, where),
    albums: albums.map((a) => ({ album: a.album, albumArtUrl: a.album_art_url, ...stats(a) })),
  };
}

export function albumPage(db: Db, { artist, album, range, period, weekendDays }: EntityParams & { artist: string; album: string }) {
  const where = musicWhere(range, sql`t.artist = ${artist}`, sql`t.album = ${album}`);
  const page = base(db, where, { period, weekendDays });
  if (!page) return null;
  const art = db.all<{ url: string | null }>(sql`select max(album_art_url) as url from tracks where artist = ${artist} and album = ${album}`)[0]?.url ?? null;
  return { album, artist, albumArtUrl: art, ...page, tracks: songs(db, where) };
}

export function trackPage(db: Db, { songKey, uri, range, period, weekendDays }: EntityParams & { songKey?: string; uri?: string }) {
  const key = songKey ?? (uri ? db.select({ songKey: tracks.songKey }).from(tracks).where(eq(tracks.uri, uri)).get()?.songKey : undefined);
  if (!key) return null;
  const where = musicWhere(range, sql`t.song_key = ${key}`);
  const page = base(db, where, { period, weekendDays });
  if (!page) return null;
  const rep = db.all<SongRow>(songStatsSql(where))[0]!;
  const uris = db.all<{ uri: string; name: string; album: string | null; plays: number }>(sql`
    select t.uri, t.name, t.album, count(*) as plays from ${MUSIC} where ${where} group by t.uri order by plays desc`);
  const contexts: ContextStat[] = Object.entries(page.skipProfile).flatMap(([dimension, values]) =>
    values.filter((v) => v.plays >= 3).map((v) => ({ dimension: dimension as ContextDimension, value: v.value, plays: v.plays, skips: v.skips, skipRate: v.skips / v.plays })),
  );
  const known = rep.skip_known;
  return {
    ...songWithStats(rep),
    ...page,
    class: known >= 8 ? classify(rep.skips / known, contexts) : null,
    uris,
  };
}
