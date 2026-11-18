import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { shiftDay } from "../digest/periods";
import { hours, MS, MUSIC, musicWhere, withArtistImages } from "./common";
import { comebacks } from "./discovery";
import { currentStreak, KIND_ORDER, milestones, recordsSetIn } from "./records";

/** Days of history before the week that records and new artists need: with less, every week sets records and every artist is new. */
export const MOMENT_HISTORY_DAYS = 28;
/** A current run of days worth a moment. */
export const MOMENT_STREAK_DAYS = 7;
/** Most moments Home shows. */
export const MOMENTS_LIMIT = 3;

/** Artists whose first music play of all time falls in the span, by their hours in it. */
function newArtists(db: Db, span: { from: string; to: string }) {
  const rows = db.all<{ artist: string; ms: number }>(sql`
    select t.artist, sum(${MS}) as ms from ${MUSIC} where ${musicWhere(span)}
    and t.artist not in (select t.artist from ${MUSIC} where ${musicWhere({ to: shiftDay(span.from, -1) })})
    group by t.artist order by ms desc, t.artist`);
  return rows.map((r) => ({ artist: r.artist, hours: hours(r.ms) }));
}

/**
 * Up to `MOMENTS_LIMIT` facts about this week, at most one of each kind, in this order: an all-time record set this
 * week, the biggest milestone passed, artists heard for the first time, the current run of days, an artist back after
 * a long gap. Records and new artists need `MOMENT_HISTORY_DAYS` of history before the week.
 */
export function weekMoments(db: Db, { from, today }: { from: string; today: string }) {
  const span = { from, to: today };
  const start = db.all<{ day: string | null }>(sql`select min(p.day) as day from plays p where ${musicWhere({})}`)[0]?.day ?? null;
  if (!start) return [];
  const settled = start <= shiftDay(from, -MOMENT_HISTORY_DAYS);
  const out = [];
  const record = settled ? recordsSetIn(db, span)[0] : undefined;
  if (record) out.push({ kind: "record" as const, target: "records" as const, ...record });
  const milestone = milestones(db, { range: span, limit: 100 }).items.sort((a, b) => KIND_ORDER[b.kind] - KIND_ORDER[a.kind] || b.threshold - a.threshold)[0];
  if (milestone) out.push({ kind: "milestone" as const, target: "records" as const, milestone });
  const found = settled ? newArtists(db, span) : [];
  if (found.length) out.push({ kind: "newArtists" as const, target: "discovery" as const, count: found.length, artists: withArtistImages(db, found.slice(0, 3)) });
  const streak = currentStreak(db, today);
  if (streak && streak.days >= MOMENT_STREAK_DAYS) out.push({ kind: "streak" as const, target: "records" as const, ...streak });
  const back = comebacks(db, { range: span, limit: 1 }).items[0];
  if (back) out.push({ kind: "comeback" as const, target: "discovery" as const, comeback: back });
  return out.slice(0, MOMENTS_LIMIT);
}
