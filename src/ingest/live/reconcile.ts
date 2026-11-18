import { sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import { plays } from "../../db/schema";
import { deviceFromSpotify } from "../../plays/device";
import { MATCH_AFTER_MS, MATCH_BEFORE_MS } from "../../plays/match";
import { insertPlays, type HistoryWindow, type PlayInput } from "../../plays/store";
import { exportCoveredUntil } from "../export/import";
import type { FinishedPlay } from "./observe";

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

function deletedAsApi(tx: DbOrTx, trackUri: string, ts: number, msPlayed: number): boolean {
  return (
    tx.all(sql`
      select 1 from play_tombstones where source = 'api' and track_uri = ${trackUri}
        and ts between ${ts - msPlayed - MATCH_BEFORE_MS} and ${ts + MATCH_AFTER_MS}
      limit 1`).length > 0
  );
}

export function coveredByLive(db: DbOrTx, trackUri: string, apiTs: number): boolean {
  return (
    db.all(sql`
      select 1 from (
        select track_uri, ts, ms_played from plays where source = 'live'
        union all select track_uri, ts, ms_played from play_tombstones where source = 'live'
      ) where track_uri = ${trackUri}
        and ${apiTs} between ts - coalesce(ms_played, 0) - ${MATCH_BEFORE_MS} and ts + ${MATCH_AFTER_MS}
      limit 1`).length > 0
  );
}

export function recordLivePlays(db: Db, finished: FinishedPlay[], window: HistoryWindow): LiveResult {
  const cutoff = exportCoveredUntil(db) ?? -Infinity;
  const fresh = finished.filter((p) => p.endedAt > cutoff);
  return db.transaction((tx) => {
    let replacedApi = 0;
    let inserted = 0;
    for (const play of fresh) {
      const input = livePlayInput(play);
      if (deletedAsApi(tx, play.trackUri, play.endedAt, play.msPlayed)) continue;
      if (insertPlays(tx, [input], window) === 0) continue;
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
