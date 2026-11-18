import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { hours, LISTEN, MS, MUSIC, musicWhere, periodExpr, rate, type Range, songIdentities, withArtistImages } from "./common";

const TOP_ARTISTS = 10;

/** Each local week (Monday start) in the range: distinct artists with a listen, and the share of the week's hours on its 10 most played artists. */
export function variety(db: Db, { range }: { range: Range }) {
  const weeks = db.all<{ week: string; artists: number; ms: number; top_ms: number }>(sql`
    with a as (
      select ${periodExpr("week")} as week, t.artist, sum(${MS}) as ms, max(${LISTEN}) as listened
      from ${MUSIC} where ${musicWhere(range)} group by week, t.artist),
    r as (select *, row_number() over (partition by week order by ms desc, artist) as rn from a)
    select week, sum(listened) as artists, sum(ms) as ms, sum(case when rn <= ${TOP_ARTISTS} then ms else 0 end) as top_ms
    from r group by week order by week`);
  const items = weeks.map((w) => ({ week: w.week, artists: w.artists, hours: hours(w.ms), topShare: rate(w.top_ms, w.ms) }));
  const shares = items.flatMap((w) => (w.topShare === null ? [] : [w.topShare]));
  return {
    topArtists: TOP_ARTISTS,
    weeks: items,
    averageArtists: items.length ? Math.round((items.reduce((s, w) => s + w.artists, 0) / items.length) * 10) / 10 : null,
    averageTopShare: shares.length ? Math.round((shares.reduce((s, v) => s + v, 0) / shares.length) * 1000) / 1000 : null,
  };
}

/**
 * A month is a peak for an artist or song in a year when it holds at least the floor and `ratio` times the mean of that
 * year's other months with any music. A year with music in fewer than `minMonths` months is not judged.
 */
export const SEASON_RULES = { artistHours: 1, songListens: 5, ratio: 3, minYears: 2, minMonths: 6 } as const;

type Amount = { key: string; year: number; month: number; amount: number };
type Season = { month: number; years: number[]; amount: number };

/** For each key, the calendar months that peaked in at least `minYears` years, with the years and the amount in them. */
function seasonsOf(rows: Amount[], floor: number, covered: (year: number) => number): Map<string, Season[]> {
  const years = new Map<string, Map<number, number[]>>();
  for (const r of rows) {
    const byYear = years.get(r.key) ?? new Map<number, number[]>();
    const months = byYear.get(r.year) ?? Array.from({ length: 12 }, () => 0);
    months[r.month - 1] = r.amount;
    byYear.set(r.year, months);
    years.set(r.key, byYear);
  }
  const out = new Map<string, Season[]>();
  for (const [key, byYear] of years) {
    const peaks = new Map<number, Season>();
    for (const [year, months] of byYear) {
      const span = covered(year);
      if (span < SEASON_RULES.minMonths) continue;
      const total = months.reduce((a, b) => a + b, 0);
      months.forEach((amount, i) => {
        if (amount < floor || amount < SEASON_RULES.ratio * ((total - amount) / (span - 1))) return;
        const season = peaks.get(i + 1) ?? { month: i + 1, years: [], amount: 0 };
        season.years.push(year);
        season.amount += amount;
        peaks.set(i + 1, season);
      });
    }
    const seasons = [...peaks.values()].filter((s) => s.years.length >= SEASON_RULES.minYears).map((s) => ({ ...s, years: s.years.sort((a, b) => a - b) }));
    if (seasons.length) out.set(key, seasons.sort((a, b) => a.month - b.month));
  }
  return out;
}

const yearsIn = (seasons: Season[]) => seasons.reduce((n, s) => n + s.years.length, 0);
const rank = <T extends { seasons: Season[]; amount: number }>(a: T, b: T) => yearsIn(b.seasons) - yearsIn(a.seasons) || b.amount - a.amount;

/** Artists (by hours) and songs (by listens) that return in the same calendar months across years. */
export function seasonal(db: Db, { range, limit }: { range: Range; limit: number }) {
  const artistRows = db.all<{ key: string; year: string; month: string; ms: number }>(sql`
    select t.artist as key, substr(p.day, 1, 4) as year, substr(p.day, 6, 2) as month, sum(${MS}) as ms
    from ${MUSIC} where ${musicWhere(range)} group by key, year, month`);
  const songRows = db.all<{ key: string; year: string; month: string; listens: number }>(sql`
    select t.song_key as key, substr(p.day, 1, 4) as year, substr(p.day, 6, 2) as month, sum(${LISTEN}) as listens
    from ${MUSIC} where ${musicWhere(range)} group by key, year, month`);
  const active = new Map<number, Set<string>>();
  for (const r of artistRows) active.set(Number(r.year), (active.get(Number(r.year)) ?? new Set()).add(r.month));
  const covered = (year: number) => active.get(year)?.size ?? 0;
  const artistSeasons = seasonsOf(
    artistRows.map((r) => ({ key: r.key, year: Number(r.year), month: Number(r.month), amount: r.ms })),
    SEASON_RULES.artistHours * 3_600_000,
    covered,
  );
  const songSeasons = seasonsOf(
    songRows.map((r) => ({ key: r.key, year: Number(r.year), month: Number(r.month), amount: r.listens })),
    SEASON_RULES.songListens,
    covered,
  );
  const artists = [...artistSeasons]
    .map(([artist, seasons]) => ({ artist, seasons, amount: seasons.reduce((s, x) => s + x.amount, 0) }))
    .sort(rank)
    .slice(0, limit)
    .map(({ artist, seasons, amount }) => ({ artist, hours: hours(amount), seasons: seasons.map((s) => ({ month: s.month, years: s.years, hours: hours(s.amount) })) }));
  const songKeys = [...songSeasons]
    .map(([songKey, seasons]) => ({ songKey, seasons, amount: seasons.reduce((s, x) => s + x.amount, 0) }))
    .sort(rank)
    .slice(0, limit);
  const byKey = songIdentities(db, songKeys.map((s) => s.songKey));
  return {
    rules: SEASON_RULES,
    artists: withArtistImages(db, artists),
    songs: songKeys.map(({ songKey, seasons, amount }) => {
      return { ...byKey.get(songKey)!, listens: amount, seasons: seasons.map((s) => ({ month: s.month, years: s.years, listens: s.amount })) };
    }),
  };
}
