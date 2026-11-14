import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { hours, type Range } from "./common";

type Row = { ts: number; day: string; country: string; ms: number; music: number; song_key: string | null; uri: string | null; name: string | null; artist: string | null; listen: number };

type Trip = { rows: Row[] };

export function trips(db: Db, { range, homeCountry, minPlays, topTracks }: { range: Range; homeCountry: string; minPlays: number; topTracks: number }) {
  const rows = db.all<Row>(sql`
    select p.ts, p.day, p.conn_country as country, coalesce(p.ms_played, t.duration_ms, 0) as ms, p.kind = 'track' as music,
      t.song_key, t.uri, t.name, t.artist, (p.source = 'api' or p.ms_played >= 30000) as listen
    from plays p left join tracks t on t.uri = p.track_uri
    where p.conn_country is not null
      ${range.from ? sql`and p.day >= ${range.from}` : sql``}
      ${range.to ? sql`and p.day <= ${range.to}` : sql``}
    order by p.ts`);
  const found: Trip[] = [];
  let current: Trip | null = null;
  for (const row of rows) {
    if (row.country === homeCountry) {
      current = null;
      continue;
    }
    if (!current) {
      current = { rows: [] };
      found.push(current);
    }
    current.rows.push(row);
  }
  return {
    homeCountry,
    trips: found
      .filter((trip) => trip.rows.length >= minPlays)
      .map((trip) => summarize(trip, topTracks))
      .reverse(),
  };
}

function summarize({ rows }: Trip, topTracks: number) {
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const countries = new Map<string, number>();
  const songs = new Map<string, { songKey: string; uri: string; name: string; artist: string; plays: number; listens: number; ms: number }>();
  let ms = 0;
  for (const r of rows) {
    countries.set(r.country, (countries.get(r.country) ?? 0) + 1);
    if (!r.music || !r.song_key) continue;
    ms += r.ms;
    const s = songs.get(r.song_key) ?? { songKey: r.song_key, uri: r.uri!, name: r.name!, artist: r.artist!, plays: 0, listens: 0, ms: 0 };
    s.plays++;
    s.listens += r.listen;
    s.ms += r.ms;
    songs.set(r.song_key, s);
  }
  const startDay = first.day;
  const endDay = last.day;
  return {
    start: new Date(first.ts).toISOString(),
    end: new Date(last.ts).toISOString(),
    startDay,
    endDay,
    days: Math.round((Date.parse(endDay) - Date.parse(startDay)) / 86_400_000) + 1,
    countries: [...countries.entries()].map(([country, plays]) => ({ country, plays })).sort((a, b) => b.plays - a.plays),
    plays: rows.length,
    hours: hours(ms),
    topTracks: [...songs.values()]
      .sort((a, b) => b.listens - a.listens || b.ms - a.ms)
      .slice(0, topTracks)
      .map(({ ms: songMs, ...s }) => ({ ...s, hours: hours(songMs) })),
  };
}
