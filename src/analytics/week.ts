import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { historyStart } from "../digest/facts";
import { latestKey, periodSpan, shiftDay, shiftKey } from "../digest/periods";
import type { LocalTime } from "../plays/localTime";
import { hours, LISTEN, MS, MUSIC, musicWhere } from "./common";
import { overview } from "./overview";

/** How many earlier weeks make "usual". */
export const USUAL_WEEKS = 4;
/** Days the daily series covers, today included. */
export const RECENT_DAYS = 30;

type Totals = { ms: number; plays: number; listens: number };

/** Plays from `from` up to `day` at `hour`, inclusive: the same stretch of an earlier week as this week so far. */
function stretch(db: Db, from: string, day: string, hour: number): Totals {
  return db.all<Totals>(sql`
    select coalesce(sum(${MS}), 0) as ms, count(*) as plays, coalesce(sum(${LISTEN}), 0) as listens
    from ${MUSIC} where ${musicWhere({ from, to: day })} and (p.day < ${day} or p.hour <= ${hour})`)[0]!;
}

function daily(db: Db, today: string) {
  const from = shiftDay(today, -(RECENT_DAYS - 1));
  const byDay = new Map(
    db.all<{ day: string; ms: number }>(sql`select p.day as day, sum(${MS}) as ms from ${MUSIC} where ${musicWhere({ from, to: today })} group by p.day`).map((r) => [r.day, r.ms]),
  );
  return Array.from({ length: RECENT_DAYS }, (_, i) => {
    const day = shiftDay(from, i);
    return { day, hours: hours(byDay.get(day) ?? 0) };
  });
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
  const earlier = Array.from({ length: USUAL_WEEKS }, (_, i) => 7 * (i + 1))
    .filter((back) => start !== null && shiftDay(from, -back) >= start)
    .map((back) => stretch(db, shiftDay(from, -back), shiftDay(today, -back), now.hour));
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
    days: daily(db, today),
  };
}
