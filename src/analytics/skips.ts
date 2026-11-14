import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { dayTypeSql, HOUR_BUCKET, MUSIC, musicWhere, rate, type Range, SHUFFLE, songStatsSql, songWithStats, START_MODE, STATS, stats, type SongRow, type StatsRow, withArtistImages } from "./common";

export const contextDimensions = (weekendDays: readonly number[]) => ({
  hourBucket: HOUR_BUCKET,
  dayType: dayTypeSql(weekendDays),
  shuffle: SHUFFLE,
  device: sql.raw("p.device"),
  startMode: START_MODE,
});

export type ContextDimension = keyof ReturnType<typeof contextDimensions>;

export const SPLIT_RULES = {
  keeperBelow: 0.25,
  dislikeAtLeast: 0.75,
  worksAtMost: 1 / 3,
  failsAtLeast: 2 / 3,
};

export type MomentClass = "keeper" | "wrong_moment" | "dislike" | "mixed";

type ContextRow = { song_key: string; dimension: ContextDimension; value: string; plays: number; skips: number };

export type ContextStat = { dimension: ContextDimension; value: string; plays: number; skips: number; skipRate: number };

export function skipProfile(db: Db, where: SQL, weekendDays: readonly number[]) {
  const known = sql`${where} and p.skipped is not null`;
  return Object.fromEntries(
    Object.entries(contextDimensions(weekendDays)).map(([dimension, expr]) => {
      const rows = db.all<{ value: string; plays: number; skips: number }>(sql`
        select ${expr} as value, count(*) as plays, sum(p.skipped = 1) as skips
        from ${MUSIC} where ${known} and ${expr} is not null group by value order by plays desc`);
      return [dimension, rows.map((r) => ({ value: r.value, plays: r.plays, skips: r.skips, skipRate: rate(r.skips, r.plays) }))];
    }),
  ) as Record<ContextDimension, { value: string; plays: number; skips: number; skipRate: number | null }[]>;
}

export function skips(db: Db, { range, minPlays, limit }: { range: Range; minPlays: number; limit: number }) {
  const where = musicWhere(range);
  const summary = db.all<StatsRow>(sql`select ${STATS} from ${MUSIC} where ${where}`)[0]!;
  const songs = sql`select * from (${songStatsSql(where)}) where skip_known >= ${minPlays}`;
  const list = (order: string, filter = "1") =>
    db.all<SongRow>(sql`select * from (${songs}) where ${sql.raw(filter)} order by ${sql.raw(order)}, song_key limit ${limit}`).map(songWithStats);
  const artists = db.all<StatsRow & { artist: string }>(sql`
    select t.artist, ${STATS} from ${MUSIC} where ${where}
    group by t.artist having skip_known >= ${minPlays}
    order by 1.0 * skips / skip_known desc, skip_known desc, t.artist limit ${limit}`);
  return {
    minPlays,
    summary: { plays: summary.plays, skips: summary.skips, skipRate: rate(summary.skips, summary.skip_known), quickSkips: summary.quick_skips },
    mostSkippedTracks: list("1.0 * skips / skip_known desc, skip_known desc"),
    mostSkippedArtists: withArtistImages(
      db,
      artists.map((a) => ({ artist: a.artist, ...stats(a) })),
    ),
    quickSkips: list("quick_skips desc, skip_known desc", "quick_skips > 0"),
    neverSkipped: list("skip_known desc", "skips = 0"),
  };
}

export function classify(skipRate: number, contexts: ContextStat[]): MomentClass {
  const works = contexts.some((c) => c.skipRate <= SPLIT_RULES.worksAtMost);
  const fails = contexts.some((c) => c.skipRate >= SPLIT_RULES.failsAtLeast);
  if (skipRate < SPLIT_RULES.keeperBelow) return "keeper";
  if (works && fails) return "wrong_moment";
  if (skipRate >= SPLIT_RULES.dislikeAtLeast && !works) return "dislike";
  return "mixed";
}

export function momentSplit(
  db: Db,
  {
    range,
    minPlays,
    minContextPlays,
    limit,
    only,
    weekendDays,
  }: { range: Range; minPlays: number; minContextPlays: number; limit: number; only?: MomentClass; weekendDays: readonly number[] },
) {
  const where = sql`${musicWhere(range)} and p.skipped is not null`;
  const songs = db.all<SongRow>(sql`select * from (${songStatsSql(where)}) where skip_known >= ${minPlays}`);
  const eligible = sql`t.song_key in (select song_key from (${songStatsSql(where)}) where skip_known >= ${minPlays})`;
  const contextRows = db.all<ContextRow>(
    sql.join(
      Object.entries(contextDimensions(weekendDays)).map(
        ([dimension, expr]) => sql`
          select t.song_key, ${dimension} as dimension, ${expr} as value, count(*) as plays, sum(p.skipped = 1) as skips
          from ${MUSIC} where ${where} and ${eligible} and ${expr} is not null
          group by t.song_key, value having count(*) >= ${minContextPlays}`,
      ),
      sql` union all `,
    ),
  );
  const contextsBySong = new Map<string, ContextStat[]>();
  for (const r of contextRows) {
    const list = contextsBySong.get(r.song_key) ?? [];
    list.push({ dimension: r.dimension, value: r.value, plays: r.plays, skips: r.skips, skipRate: r.skips / r.plays });
    contextsBySong.set(r.song_key, list);
  }
  const counts: Record<MomentClass, number> = { keeper: 0, wrong_moment: 0, dislike: 0, mixed: 0 };
  const classified = songs.map((row) => {
    const contexts = contextsBySong.get(row.song_key) ?? [];
    const skipRate = row.skips / row.skip_known;
    const cls = classify(skipRate, contexts);
    counts[cls]++;
    const byRate = [...contexts].sort((a, b) => a.skipRate - b.skipRate || b.plays - a.plays);
    const round = (c: ContextStat | undefined) => c && { ...c, skipRate: rate(c.skips, c.plays)! };
    return { ...songWithStats(row), class: cls, bestContext: round(byRate[0]) ?? null, worstContext: round(byRate[byRate.length - 1]) ?? null };
  });
  return {
    params: { minPlays, minContextPlays, ...SPLIT_RULES },
    eligibleSongs: songs.length,
    counts,
    songs: classified
      .filter((s) => !only || s.class === only)
      .sort((a, b) => b.plays - a.plays || a.songKey.localeCompare(b.songKey))
      .slice(0, limit),
  };
}
