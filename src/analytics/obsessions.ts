import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { LISTEN, MUSIC, musicWhere, type Range, songIdentities } from "./common";

/**
 * A song's burst is its 7 local days in a row with the most listens. It is an obsession when it holds at least
 * `minListens`, at least `ratio` times the song's usual weekly listens outside it, and the `fadeDays` after it hold at
 * most `fadeShare` of the burst.
 */
export const OBSESSION_RULES = { windowDays: 7, minListens: 8, ratio: 5, fadeDays: 28, fadeShare: 0.25 } as const;

const { windowDays, minListens, ratio, fadeDays, fadeShare } = OBSESSION_RULES;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

type Day = { day: string; listens: number };

/** The window of `windowDays` with the most listens, trimmed to its first and last listen day; the earliest on a tie. */
function burstOf(days: Day[]) {
  let best = { start: 0, end: 0, listens: 0 };
  let sum = 0;
  for (let end = 0, start = 0; end < days.length; end++) {
    sum += days[end]!.listens;
    while (daysBetween(days[start]!.day, days[end]!.day) >= windowDays) sum -= days[start++]!.listens;
    if (sum > best.listens) best = { start, end, listens: sum };
  }
  return best;
}

/** Short, intense bursts of one song that then faded, whose burst starts in the range; the biggest first. */
export function obsessions(db: Db, { range, today, limit }: { range: Range; today: string; limit: number }) {
  const rows = db.all<{ song_key: string; day: string; listens: number }>(sql`
    select t.song_key, p.day, count(*) as listens from ${MUSIC} where ${musicWhere({})} and ${LISTEN}
    group by t.song_key, p.day order by t.song_key, p.day`);
  const bySong = new Map<string, Day[]>();
  for (const r of rows) {
    const days = bySong.get(r.song_key) ?? [];
    days.push({ day: r.day, listens: r.listens });
    bySong.set(r.song_key, days);
  }
  const found: { songKey: string; from: string; to: string; listens: number; usualPerWeek: number; after: number }[] = [];
  for (const [songKey, days] of bySong) {
    const burst = burstOf(days);
    if (burst.listens < minListens) continue;
    const from = days[burst.start]!.day;
    const to = days[burst.end]!.day;
    if (daysBetween(to, today) < fadeDays) continue;
    if ((range.from && from < range.from) || (range.to && from > range.to)) continue;
    const total = days.reduce((n, d) => n + d.listens, 0);
    const weeksOutside = Math.max(1, (daysBetween(days[0]!.day, today) + 1 - windowDays) / 7);
    const usualPerWeek = (total - burst.listens) / weeksOutside;
    if (burst.listens < ratio * usualPerWeek) continue;
    const after = days.filter((d) => d.day > to && daysBetween(to, d.day) <= fadeDays).reduce((n, d) => n + d.listens, 0);
    if (after > fadeShare * burst.listens) continue;
    found.push({ songKey, from, to, listens: burst.listens, usualPerWeek: Math.round(usualPerWeek * 10) / 10, after });
  }
  const top = found.sort((a, b) => b.listens - a.listens || b.from.localeCompare(a.from)).slice(0, limit);
  const byKey = songIdentities(db, top.map((o) => o.songKey));
  return {
    rules: OBSESSION_RULES,
    items: top.map(({ songKey, ...o }) => ({ ...byKey.get(songKey)!, ...o })),
  };
}
