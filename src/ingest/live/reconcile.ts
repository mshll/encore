import { sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import { plays } from "../../db/schema";
import { deviceFromSpotify } from "../../plays/device";
import { insertPlays, type PlayInput } from "../../plays/store";
import { exportCoveredUntil } from "../export/import";
import type { FinishedPlay } from "./observe";

// One real play can reach the table twice: from the watcher (source 'live') and from recently-played (source 'api').
// They are the same play when the api timestamp falls inside the live play's window below. The live row wins.
export const MATCH_BEFORE_MS = 15_000;
export const MATCH_AFTER_MS = 60_000;

export type LiveResult = { inserted: number; replacedApi: number; coveredByExport: number };

export function livePlayInput(play: FinishedPlay): PlayInput {
  return {
    dedupeKey: `live:${play.startedAt}:${play.trackUri}`,
    ts: play.endedAt,
    kind: "track",
    trackUri: play.trackUri,
    msPlayed: play.msPlayed,
    reasonStart: play.reasonStart,
    reasonEnd: play.reasonEnd,
    skipped: play.skipped,
    shuffle: play.shuffle,
    device: deviceFromSpotify(play.deviceType, play.deviceName),
    platformRaw: `${play.deviceType}: ${play.deviceName}`,
    source: "live",
    contextUri: play.contextUri,
  };
}

function nearestApiMatch(tx: DbOrTx, trackUri: string, ts: number, msPlayed: number): number | undefined {
  return tx.all<{ id: number }>(sql`
    select id from plays where source = 'api' and track_uri = ${trackUri}
      and ts between ${ts - msPlayed - MATCH_BEFORE_MS} and ${ts + MATCH_AFTER_MS}
    order by abs(ts - ${ts}) limit 1`)[0]?.id;
}

export function coveredByLive(db: DbOrTx, trackUri: string, apiTs: number): boolean {
  return (
    db.all(sql`
      select 1 from plays where source = 'live' and track_uri = ${trackUri}
        and ${apiTs} between ts - coalesce(ms_played, 0) - ${MATCH_BEFORE_MS} and ts + ${MATCH_AFTER_MS}
      limit 1`).length > 0
  );
}

export function recordLivePlays(db: Db, finished: FinishedPlay[], timezone: string): LiveResult {
  const cutoff = exportCoveredUntil(db) ?? -Infinity;
  const fresh = finished.filter((p) => p.endedAt > cutoff);
  return db.transaction((tx) => {
    let replacedApi = 0;
    let inserted = 0;
    for (const play of fresh) {
      const input = livePlayInput(play);
      if (insertPlays(tx, [input], timezone) === 0) continue;
      inserted++;
      const match = nearestApiMatch(tx, play.trackUri, play.endedAt, play.msPlayed);
      if (match !== undefined) {
        tx.delete(plays).where(sql`${plays.id} = ${match}`).run();
        replacedApi++;
      }
    }
    return { inserted, replacedApi, coveredByExport: finished.length - fresh.length };
  });
}
