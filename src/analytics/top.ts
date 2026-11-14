import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { containsPattern, hours, iso, MUSIC, musicWhere, type Range, songStatsSql, songWithStats, STATS, stats, type SongRow, type StatsRow, withArtistImages } from "./common";

export type TopSort = "hours" | "listens" | "plays";
export type TopParams = { range: Range; limit: number; offset?: number; sort?: TopSort; q?: string };
export type TopAtParams = TopParams & { weekday?: number; hour?: number };

const sortColumn = { hours: "ms", listens: "listens", plays: "plays" } as const;
const orderBy = (sort: TopSort = "hours") => sql.raw(`${sortColumn[sort]} desc`);
const where = ({ range, weekday, hour }: TopAtParams, ...extra: (SQL | undefined)[]) =>
  musicWhere(range, weekday === undefined ? undefined : sql`p.weekday = ${weekday}`, hour === undefined ? undefined : sql`p.hour = ${hour}`, ...extra);
const matches = (q: string | undefined, ...columns: string[]) => {
  if (!q) return undefined;
  const like = containsPattern(q);
  return sql`(${sql.join(
    columns.map((c) => sql`${sql.raw(c)} like ${like} escape '\\'`),
    sql` or `,
  )})`;
};

export function topTracks(db: Db, params: TopAtParams) {
  const { limit, offset = 0, sort, q } = params;
  const rows = db.all<SongRow>(sql`select * from (${songStatsSql(where(params))}) where ${matches(q, "name", "artist") ?? sql`1`} order by ${orderBy(sort)}, song_key limit ${limit} offset ${offset}`);
  return rows.map(songWithStats);
}

export function topArtists(db: Db, params: TopAtParams) {
  const { limit, offset = 0, sort, q } = params;
  const rows = db.all<StatsRow & { artist: string; songs: number }>(sql`
    select t.artist, count(distinct t.song_key) as songs, ${STATS}
    from ${MUSIC} where ${where(params, matches(q, "t.artist"))}
    group by t.artist order by ${orderBy(sort)}, t.artist limit ${limit} offset ${offset}`);
  return withArtistImages(
    db,
    rows.map((r) => ({ artist: r.artist, songs: r.songs, ...stats(r) })),
  );
}

export function topAlbums(db: Db, { range, limit, offset = 0, sort, q }: TopParams) {
  const rows = db.all<StatsRow & { artist: string; album: string; album_art_url: string | null; songs: number }>(sql`
    select t.artist, t.album, max(t.album_art_url) as album_art_url, count(distinct t.song_key) as songs, ${STATS}
    from ${MUSIC} where ${musicWhere(range, sql`t.album is not null`, matches(q, "t.album", "t.artist"))}
    group by t.artist, t.album order by ${orderBy(sort)}, t.artist, t.album limit ${limit} offset ${offset}`);
  return rows.map((r) => ({ album: r.album, artist: r.artist, albumArtUrl: r.album_art_url, songs: r.songs, ...stats(r) }));
}

export function eras(db: Db, { range, limit }: { range: Range; limit: number }) {
  const artists = topArtists(db, { range, limit }).map((a) => a.artist);
  if (artists.length === 0) return { months: [], series: [], artists: [] };
  const inArtists = sql`t.artist in (${sql.join(
    artists.map((a) => sql`${a}`),
    sql`, `,
  )})`;
  const monthly = db.all<{ artist: string; month: string; ms: number; plays: number }>(sql`
    select t.artist, substr(p.day, 1, 7) as month, sum(coalesce(p.ms_played, t.duration_ms, 0)) as ms, count(*) as plays
    from ${MUSIC} where ${musicWhere(range, inArtists)}
    group by t.artist, month`);
  const lifetime = db.all<{ artist: string; first_ts: number; last_ts: number }>(sql`
    select t.artist, min(p.ts) as first_ts, max(p.ts) as last_ts
    from ${MUSIC} where ${musicWhere({}, inArtists)} group by t.artist`);
  const months = monthRange(monthly.map((m) => m.month));
  const index = new Map(months.map((m, i) => [m, i]));
  return {
    months,
    series: artists.map((artist) => {
      const values = months.map(() => 0);
      for (const m of monthly) if (m.artist === artist) values[index.get(m.month)!] = hours(m.ms);
      return { artist, hours: values };
    }),
    artists: withArtistImages(
      db,
      artists.map((artist) => {
        const own = monthly.filter((m) => m.artist === artist);
        const peak = own.reduce((best, m) => (m.ms > best.ms ? m : best), own[0]!);
        const life = lifetime.find((l) => l.artist === artist)!;
        return {
          artist,
          hours: hours(own.reduce((sum, m) => sum + m.ms, 0)),
          firstPlayed: iso(life.first_ts),
          lastPlayed: iso(life.last_ts),
          peakMonth: peak.month,
          peakMonthHours: hours(peak.ms),
        };
      }),
    ),
  };
}

function monthRange(months: string[]): string[] {
  if (months.length === 0) return [];
  const sorted = [...months].sort();
  const out: string[] = [];
  let [y, m] = sorted[0]!.split("-").map(Number) as [number, number];
  const last = sorted[sorted.length - 1]!;
  for (;;) {
    const current = `${y}-${String(m).padStart(2, "0")}`;
    out.push(current);
    if (current >= last) return out;
    m = m === 12 ? 1 : m + 1;
    if (m === 1) y++;
  }
}
