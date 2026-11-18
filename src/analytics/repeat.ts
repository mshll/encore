import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { daysIn, shiftDay } from "../digest/periods";
import { LISTEN, MUSIC, musicWhere, songStatsSql, songWithStats, type SongRow } from "./common";

/**
 * On repeat: a song with at least `minListens` listens in the last `recentDays` days (today included) and at least
 * `lift` times its usual for that many days. Its usual is its listens in the `baselineDays` before, scaled to
 * `recentDays` by the days of those the history covers (0 when it covers none).
 */
export const ON_REPEAT = { recentDays: 14, baselineDays: 182, minListens: 5, lift: 2 } as const;

/** Songs played far more in the last two weeks than usual, by listens above their usual, then listens, then song key. */
export function onRepeat(db: Db, { today, limit }: { today: string; limit: number }) {
  const { recentDays, baselineDays, minListens, lift } = ON_REPEAT;
  const recentFrom = shiftDay(today, -(recentDays - 1));
  const baseline = { from: shiftDay(recentFrom, -baselineDays), to: shiftDay(recentFrom, -1) };
  const start = db.all<{ day: string | null }>(sql`select min(p.day) as day from plays p where ${musicWhere({})}`)[0]?.day ?? null;
  const covered = start === null || start > baseline.to ? 0 : daysIn({ from: start > baseline.from ? start : baseline.from, to: baseline.to });
  const counts = db.all<{ song_key: string; recent: number; before: number }>(sql`
    select t.song_key, sum(p.day >= ${recentFrom}) as recent, sum(p.day < ${recentFrom}) as before
    from ${MUSIC} where ${musicWhere({ from: baseline.from, to: today })} and ${LISTEN}
    group by t.song_key having recent >= ${minListens}`);
  const ranked = counts
    .map((c) => ({ songKey: c.song_key, recent: c.recent, usual: covered ? (c.before * recentDays) / covered : 0 }))
    .filter((c) => c.recent >= lift * c.usual)
    .sort((a, b) => b.recent - b.usual - (a.recent - a.usual) || b.recent - a.recent || a.songKey.localeCompare(b.songKey))
    .slice(0, limit);
  if (ranked.length === 0) return { rules: ON_REPEAT, from: recentFrom, to: today, items: [] };
  const keys = sql.join(
    ranked.map((r) => sql`${r.songKey}`),
    sql`, `,
  );
  const songs = new Map(
    db.all<SongRow>(songStatsSql(musicWhere({ from: recentFrom, to: today }, sql`t.song_key in (${keys})`))).map((r) => [r.song_key, songWithStats(r)]),
  );
  return {
    rules: ON_REPEAT,
    from: recentFrom,
    to: today,
    items: ranked.map((r) => ({ ...songs.get(r.songKey)!, usualListens: Math.round(r.usual * 10) / 10 })),
  };
}
