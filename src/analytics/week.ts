import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { historyStart } from "../digest/facts";
import { latestKey, periodSpan, shiftDay, shiftKey } from "../digest/periods";
import type { LocalTime } from "../plays/localTime";
import { hours, LISTEN, MS, MUSIC, musicWhere, rate } from "./common";
import { overview } from "./overview";

/** How many earlier weeks make "usual". */
export const USUAL_WEEKS = 4;

type Totals = { ms: number; plays: number; listens: number };

/** Plays from `from` up to `day` at `hour`, inclusive: the same stretch of an earlier week as this week so far. */
function stretch(db: Db, from: string, day: string, hour: number): Totals {
  return db.all<Totals>(sql`
    select coalesce(sum(${MS}), 0) as ms, count(*) as plays, coalesce(sum(${LISTEN}), 0) as listens
    from ${MUSIC} where ${musicWhere({ from, to: day })} and (p.day < ${day} or p.hour <= ${hour})`)[0]!;
}

const msByDay = (db: Db, from: string, to: string) =>
  new Map(db.all<{ day: string; ms: number }>(sql`select p.day as day, sum(${MS}) as ms from ${MUSIC} where ${musicWhere({ from, to })} group by p.day`).map((r) => [r.day, r.ms]));

/**
 * Each day of the week: its hours (null for days still to come) and the usual for that day, the mean of the whole
 * same weekday in each of `backs` (days back to the earlier weeks the usual counts); null when there are none.
 */
function weekDays(db: Db, from: string, today: string, backs: number[]) {
  const byDay = msByDay(db, shiftDay(from, -7 * USUAL_WEEKS), today);
  return Array.from({ length: 7 }, (_, i) => {
    const day = shiftDay(from, i);
    const usual = backs.length ? hours(backs.reduce((sum, back) => sum + (byDay.get(shiftDay(day, -back)) ?? 0), 0) / backs.length) : null;
    return { day, hours: day <= today ? hours(byDay.get(day) ?? 0) : null, usual };
  });
}

/** Listens this week of a song already listened to earlier this week (by time of play), over all listens this week. */
function repeats(db: Db, from: string, today: string) {
  const row = db.all<{ listens: number; repeats: number }>(sql`
    select count(*) as listens, coalesce(sum(n > 1), 0) as repeats from (
      select row_number() over (partition by t.song_key order by p.ts, p.id) as n
      from ${MUSIC} where ${musicWhere({ from, to: today })} and ${LISTEN})`)[0]!;
  return { listens: row.listens, repeats: row.repeats, share: rate(row.repeats, row.listens) };
}

/** The recap week that holds `today`. */
export const currentWeek = (today: string, recapWeekday: number) => periodSpan("weekly", shiftKey("weekly", latestKey("weekly", today, recapWeekday), 1));

/**
 * This week so far against the owner's usual. The week is the recap week that holds `now` (weeks end the day before
 * the recap weekday, as in `digest/periods`). Usual is the mean of the same stretch, to the same hour, of the
 * `USUAL_WEEKS` weeks before, counting only weeks the history covers whole; null when there are none.
 */
export function weekSoFar(db: Db, { now, recapWeekday }: { now: LocalTime; recapWeekday: number }) {
  const today = now.day;
  const { from, to } = currentWeek(today, recapWeekday);
  const start = historyStart(db);
  const backs = Array.from({ length: USUAL_WEEKS }, (_, i) => 7 * (i + 1)).filter((back) => start !== null && shiftDay(from, -back) >= start);
  const earlier = backs.map((back) => stretch(db, shiftDay(from, -back), shiftDay(today, -back), now.hour));
  const mean = (pick: (t: Totals) => number) => earlier.reduce((sum, t) => sum + pick(t), 0) / earlier.length;
  const week = overview(db, { range: { from, to: today } });
  return {
    from,
    to,
    today,
    hours: week.hours,
    plays: week.plays,
    listens: week.listens,
    usual: earlier.length ? { hours: hours(mean((t) => t.ms)), plays: Math.round(mean((t) => t.plays)), listens: Math.round(mean((t) => t.listens)), weeks: earlier.length } : null,
    topArtist: week.topArtist,
    topTrack: week.topTrack,
    days: weekDays(db, from, today, backs),
    repeats: repeats(db, from, today),
  };
}
