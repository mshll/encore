import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { DEVICES } from "../db/schema";
import { hours, iso, MS, MUSIC, musicWhere, periodExpr, rate, type Period, type Range } from "./common";
import { topArtists, topTracks } from "./top";

export function overview(db: Db, { range }: { range: Range }) {
  const row = db.all<{
    plays: number;
    listens: number | null;
    ms: number | null;
    songs: number;
    artists: number;
    skips: number | null;
    skip_known: number | null;
    shuffles: number | null;
    shuffle_known: number | null;
    first_ts: number | null;
    last_ts: number | null;
  }>(sql`
    select count(*) as plays, sum(p.source = 'api' or p.ms_played >= 30000) as listens, sum(${MS}) as ms,
      count(distinct t.song_key) as songs, count(distinct t.artist) as artists,
      sum(p.skipped = 1) as skips, sum(p.skipped is not null) as skip_known,
      sum(p.shuffle = 1) as shuffles, sum(p.shuffle is not null) as shuffle_known,
      min(p.ts) as first_ts, max(p.ts) as last_ts
    from ${MUSIC} where ${musicWhere(range)}`)[0]!;
  const topArtist = topArtists(db, { range, limit: 1 })[0];
  const topTrack = topTracks(db, { range, limit: 1 })[0];
  return {
    hours: hours(row.ms ?? 0),
    plays: row.plays,
    listens: row.listens ?? 0,
    uniqueTracks: row.songs,
    uniqueArtists: row.artists,
    skipRate: rate(row.skips ?? 0, row.skip_known ?? 0),
    shuffleRate: rate(row.shuffles ?? 0, row.shuffle_known ?? 0),
    firstPlayed: iso(row.first_ts),
    lastPlayed: iso(row.last_ts),
    topArtist: topArtist ? { artist: topArtist.artist, imageUrl: topArtist.imageUrl, hours: topArtist.hours, listens: topArtist.listens } : null,
    topTrack: topTrack
      ? { songKey: topTrack.songKey, uri: topTrack.uri, name: topTrack.name, artist: topTrack.artist, albumArtUrl: topTrack.albumArtUrl, hours: topTrack.hours, listens: topTrack.listens }
      : null,
  };
}

export function timeSeries(db: Db, { range, period }: { range: Range; period: Period }) {
  const rows = db.all<{ period: string; ms: number; plays: number; listens: number }>(sql`
    select ${periodExpr(period)} as period, sum(${MS}) as ms, count(*) as plays, sum(p.source = 'api' or p.ms_played >= 30000) as listens
    from ${MUSIC} where ${musicWhere(range)} group by period order by period`);
  return { period, points: rows.map((r) => ({ period: r.period, hours: hours(r.ms), plays: r.plays, listens: r.listens })) };
}

export function clock(db: Db, { range }: { range: Range }) {
  const rows = db.all<{ weekday: number; hour: number; ms: number; plays: number }>(sql`
    select p.weekday, p.hour, sum(${MS}) as ms, count(*) as plays
    from ${MUSIC} where ${musicWhere(range)} group by p.weekday, p.hour`);
  const cells = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      const r = rows.find((x) => x.weekday === weekday && x.hour === hour);
      cells.push({ weekday, hour, hours: hours(r?.ms ?? 0), plays: r?.plays ?? 0 });
    }
  }
  return { cells };
}

export function devices(db: Db, { range, period }: { range: Range; period: Period }) {
  const rows = db.all<{ period: string; device: (typeof DEVICES)[number]; ms: number; plays: number }>(sql`
    select ${periodExpr(period)} as period, p.device, sum(${MS}) as ms, count(*) as plays
    from ${MUSIC} where ${musicWhere(range)} group by period, p.device order by period, p.device`);
  const totalMs = rows.reduce((sum, r) => sum + r.ms, 0);
  const byDevice = new Map<string, { ms: number; plays: number }>();
  for (const r of rows) {
    const d = byDevice.get(r.device) ?? { ms: 0, plays: 0 };
    d.ms += r.ms;
    d.plays += r.plays;
    byDevice.set(r.device, d);
  }
  return {
    period,
    totals: [...byDevice.entries()]
      .map(([device, d]) => ({ device, hours: hours(d.ms), plays: d.plays, share: rate(d.ms, totalMs) }))
      .sort((a, b) => b.hours - a.hours),
    series: rows.map((r) => ({ period: r.period, device: r.device, hours: hours(r.ms), plays: r.plays })),
  };
}
