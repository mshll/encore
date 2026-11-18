import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { hours, iso, playsWhere, type Range } from "./common";

const EPISODE_MS = sql.raw("coalesce(p.ms_played, 0)");

/** Podcast listening: plays of kind `episode`, by show, and the latest episodes. */
export function podcasts(db: Db, { range, limit }: { range: Range; limit: number }) {
  const where = playsWhere("episode", range);
  const shows = db.all<{ show: string | null; ms: number; plays: number; episodes: number; first_ts: number; last_ts: number }>(sql`
    select p.show_name as show, sum(${EPISODE_MS}) as ms, count(*) as plays, count(distinct coalesce(p.episode_uri, p.episode_name)) as episodes,
      min(p.ts) as first_ts, max(p.ts) as last_ts
    from plays p where ${where} group by p.show_name order by ms desc, show limit ${limit}`);
  const recent = db.all<{ ts: number; day: string; show: string | null; episode: string | null; uri: string | null; ms: number }>(sql`
    select p.ts, p.day, p.show_name as show, p.episode_name as episode, p.episode_uri as uri, ${EPISODE_MS} as ms
    from plays p where ${where} order by p.ts desc, p.id desc limit ${limit}`);
  const total = db.all<{ ms: number | null; plays: number }>(sql`select sum(${EPISODE_MS}) as ms, count(*) as plays from plays p where ${where}`)[0]!;
  return {
    hours: hours(total.ms ?? 0),
    plays: total.plays,
    shows: shows.map((s) => ({ show: s.show, hours: hours(s.ms), plays: s.plays, episodes: s.episodes, firstPlayed: iso(s.first_ts), lastPlayed: iso(s.last_ts) })),
    recent: recent.map((r) => ({ ts: iso(r.ts)!, day: r.day, show: r.show, episode: r.episode, uri: r.uri, minutes: r.ms / 60_000 })),
  };
}
