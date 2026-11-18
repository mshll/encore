import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { MUSIC, musicWhere, rate, type Range } from "./common";

/** How a play began, from the export's `reason_start`. Unlike the skip context `startMode`, going back is its own kind, not a choice. */
const START_SQL = sql.raw(`(case
  when p.reason_start in ('clickrow', 'playbtn') then 'chosen'
  when p.reason_start = 'trackdone' then 'playedOn'
  when p.reason_start in ('fwdbtn', 'backbtn') then 'nextBack'
  else 'other' end)`);
/** Only export rows carry Spotify's own start reason and shuffle flag; live rows infer theirs and API rows have none. */
const COUNTED = sql.raw("(p.source = 'export' and p.reason_start is not null)");

type Counts = { plays: number; chosen: number; playedOn: number; nextBack: number; other: number; shuffled: number };

const COUNTS = sql`count(*) as plays,
  coalesce(sum(${START_SQL} = 'chosen'), 0) as chosen,
  coalesce(sum(${START_SQL} = 'playedOn'), 0) as playedOn,
  coalesce(sum(${START_SQL} = 'nextBack'), 0) as nextBack,
  coalesce(sum(${START_SQL} = 'other'), 0) as other,
  coalesce(sum(p.shuffle = 1), 0) as shuffled`;

const shares = (c: Counts) => ({
  chosen: rate(c.chosen, c.plays),
  playedOn: rate(c.playedOn, c.plays),
  nextBack: rate(c.nextBack, c.plays),
  other: rate(c.other, c.plays),
  shuffled: rate(c.shuffled, c.plays),
});

/** How plays in the range began, overall and by local month, counted over export plays with a start reason. */
export function playStarts(db: Db, { range }: { range: Range }) {
  const all = db.all<{ plays: number }>(sql`select count(*) as plays from ${MUSIC} where ${musicWhere(range)}`)[0]!.plays;
  const totals = db.all<Counts>(sql`select ${COUNTS} from ${MUSIC} where ${musicWhere(range, COUNTED)}`)[0]!;
  const months = db.all<Counts & { month: string }>(sql`
    select substr(p.day, 1, 7) as month, ${COUNTS} from ${MUSIC} where ${musicWhere(range, COUNTED)} group by month order by month`);
  return {
    coverage: { plays: all, counted: totals.plays, share: rate(totals.plays, all) },
    totals: { ...totals, shares: shares(totals) },
    months: months.map((m) => ({ ...m, shares: shares(m) })),
  };
}
