import { sql } from "drizzle-orm";
import type { Db } from "../db/client";

export type PlayOutcome = "finished" | "skipped" | "unknown";

type Row = { ts: number; day: string; source: "export" | "api" | "live"; ms_played: number | null; skipped: number | null; reason_end: string | null; duration_ms: number | null; prev_ts: number | null };

const FINISHED_SHARE = 0.8;

/**
 * Export rows carry Spotify's skip flag and live rows an observed time played with an inferred one.
 * API rows (recently-played) have neither, so the listened time is estimated as the gap since the previous play.
 */
export function outcomeOf(r: Row): PlayOutcome {
  if (r.source !== "api") {
    if (r.skipped === 1) return "skipped";
    if (r.reason_end === "trackdone") return "finished";
    if (r.ms_played != null && r.duration_ms) return r.ms_played >= FINISHED_SHARE * r.duration_ms ? "finished" : "skipped";
    return r.skipped === 0 ? "finished" : "unknown";
  }
  if (r.prev_ts == null || !r.duration_ms) return "unknown";
  return r.ts - r.prev_ts >= FINISHED_SHARE * r.duration_ms ? "finished" : "skipped";
}

export function songPlaysSince(db: Db, songKey: string, since: number) {
  return db
    .all<Row>(sql`
      select p.ts, p.day, p.source, p.ms_played, p.skipped, p.reason_end, t.duration_ms,
        (select max(p2.ts) from plays p2 where p2.ts < p.ts) as prev_ts
      from plays p join tracks t on t.uri = p.track_uri
      where p.kind = 'track' and t.song_key = ${songKey} and p.ts > ${since}
      order by p.ts`)
    .map((r) => ({ ts: r.ts, day: r.day, outcome: outcomeOf(r) }));
}
