import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { hours, MS, MUSIC, musicWhere, songStatsSql, songWithStats, type SongRow } from "./common";

export function forgotten(db: Db, { days, minListens, limit, asOf }: { days: number; minListens: number; limit: number; asOf: number }) {
  const cutoff = asOf - days * 86_400_000;
  const rows = db.all<SongRow>(sql`
    select * from (${songStatsSql(musicWhere({}))})
    where listens >= ${minListens} and last_ts < ${cutoff}
    order by listens desc, song_key limit ${limit}`);
  return { days, minListens, asOf: new Date(asOf).toISOString(), items: rows.map(songWithStats) };
}

export function onThisDay(db: Db, { date, limit }: { date: string; limit: number }) {
  const monthDay = date.slice(5);
  const sameDay = musicWhere({}, sql`substr(p.day, 6) = ${monthDay}`, sql`p.day < ${date}`);
  const years = db.all<{ year: string; day: string; ms: number; plays: number; listens: number }>(sql`
    select substr(p.day, 1, 4) as year, p.day, sum(${MS}) as ms, count(*) as plays, sum(p.source = 'api' or p.ms_played >= 30000) as listens
    from ${MUSIC} where ${sameDay} group by p.day order by p.day desc`);
  return {
    date,
    years: years.map((y) => ({
      year: Number(y.year),
      day: y.day,
      hours: hours(y.ms),
      plays: y.plays,
      listens: y.listens,
      topTracks: db
        .all<SongRow>(sql`select * from (${songStatsSql(musicWhere({ from: y.day, to: y.day }))}) order by listens desc, ms desc, song_key limit ${limit}`)
        .map(songWithStats),
    })),
  };
}
