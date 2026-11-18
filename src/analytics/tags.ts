import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { hours, LISTEN, MS, MUSIC, musicWhere, periodExpr, rate, type Period, type Range } from "./common";

const TAGGED = sql.raw("plays p join tracks t on t.uri = p.track_uri join track_tags tg on tg.song_key = t.song_key");

function bySeries(db: Db, column: "genres" | "moods", range: Range, period: Period) {
  const rows = db.all<{ period: string; value: string; ms: number; plays: number }>(sql`
    select ${periodExpr(period)} as period, j.value as value, sum(${MS}) as ms, count(*) as plays
    from ${TAGGED}, json_each(tg.${sql.raw(column)}) j
    where ${musicWhere(range)} group by period, j.value order by period, j.value`);
  const totals = new Map<string, { ms: number; plays: number }>();
  for (const r of rows) {
    const t = totals.get(r.value) ?? { ms: 0, plays: 0 };
    t.ms += r.ms;
    t.plays += r.plays;
    totals.set(r.value, t);
  }
  return {
    period,
    coverage: tagCoverage(db, range),
    totals: [...totals.entries()].map(([value, t]) => ({ value, hours: hours(t.ms), plays: t.plays })).sort((a, b) => b.hours - a.hours),
    series: rows.map((r) => ({ period: r.period, value: r.value, hours: hours(r.ms), plays: r.plays })),
  };
}

function tagCoverage(db: Db, range: Range) {
  const row = db.all<{ ms: number | null; tagged_ms: number | null }>(sql`
    select sum(${MS}) as ms, sum(case when tg.song_key is not null then ${MS} else 0 end) as tagged_ms
    from ${MUSIC} left join track_tags tg on tg.song_key = t.song_key where ${musicWhere(range)}`)[0]!;
  return { hoursTagged: hours(row.tagged_ms ?? 0), hoursTotal: hours(row.ms ?? 0), share: rate(row.tagged_ms ?? 0, row.ms ?? 0) };
}

/** Each genre's or mood's share (0 to 1) of the range's tagged hours. A song with two tags counts toward both. */
export function tagShares(db: Db, column: "genres" | "moods", range: Range): Map<string, number> {
  const rows = db.all<{ value: string; ms: number }>(sql`
    select j.value as value, sum(${MS}) as ms from ${TAGGED}, json_each(tg.${sql.raw(column)}) j
    where ${musicWhere(range)} group by j.value`);
  const total = db.all<{ ms: number | null }>(sql`select sum(${MS}) as ms from ${TAGGED} where ${musicWhere(range)}`)[0]?.ms ?? 0;
  return new Map(rows.map((r) => [r.value, total ? r.ms / total : 0]));
}

export const genreSeries =(db: Db, { range, period }: { range: Range; period: Period }) => bySeries(db, "genres", range, period);
export const moodSeries = (db: Db, { range, period }: { range: Range; period: Period }) => bySeries(db, "moods", range, period);

export function energyByHour(db: Db, { range }: { range: Range }) {
  const rows = db.all<{ hour: number; energy: number; valence: number; listens: number }>(sql`
    select p.hour, avg(tg.energy) as energy, avg(tg.valence) as valence, count(*) as listens
    from ${TAGGED} where ${musicWhere(range)} and ${LISTEN}
    group by p.hour`);
  return {
    coverage: tagCoverage(db, range),
    hours: Array.from({ length: 24 }, (_, hour) => {
      const r = rows.find((x) => x.hour === hour);
      return {
        hour,
        energy: r ? Math.round(r.energy * 100) / 100 : null,
        valence: r ? Math.round(r.valence * 100) / 100 : null,
        listens: r?.listens ?? 0,
      };
    }),
  };
}
