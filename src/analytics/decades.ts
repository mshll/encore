import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { hours, MS, MUSIC, musicWhere, rate, type Range } from "./common";

const RELEASE_YEAR = sql.raw("cast(substr(t.release_date, 1, 4) as integer)");

/**
 * Hours by release decade, from `tracks.release_date`, and the listening age: the release year that half of the dated
 * hours fall on or before (a median of release years weighted by time played). Songs without a release date are left out;
 * `coverage` says how much that is.
 */
export function decades(db: Db, { range }: { range: Range }) {
  const rows = db.all<{ year: number; ms: number; plays: number }>(sql`
    select ${RELEASE_YEAR} as year, sum(${MS}) as ms, count(*) as plays
    from ${MUSIC} where ${musicWhere(range, sql`t.release_date is not null and ${RELEASE_YEAR} >= 1000`)}
    group by year order by year`);
  const all = db.all<{ ms: number | null; plays: number }>(sql`select sum(${MS}) as ms, count(*) as plays from ${MUSIC} where ${musicWhere(range)}`)[0]!;
  const datedMs = rows.reduce((s, r) => s + r.ms, 0);
  const datedPlays = rows.reduce((s, r) => s + r.plays, 0);
  const byDecade = new Map<number, { ms: number; plays: number }>();
  for (const r of rows) {
    const decade = Math.floor(r.year / 10) * 10;
    const d = byDecade.get(decade) ?? { ms: 0, plays: 0 };
    d.ms += r.ms;
    d.plays += r.plays;
    byDecade.set(decade, d);
  }
  let cumulative = 0;
  const median = datedMs > 0 ? (rows.find((r) => (cumulative += r.ms) * 2 >= datedMs)?.year ?? null) : null;
  return {
    decades: [...byDecade.entries()].map(([decade, d]) => ({ decade, hours: hours(d.ms), plays: d.plays, share: rate(d.ms, datedMs) })),
    listeningAge: median,
    coverage: { hoursDated: hours(datedMs), hoursTotal: hours(all.ms ?? 0), share: rate(datedMs, all.ms ?? 0), playsShare: rate(datedPlays, all.plays) },
  };
}
