import { sql } from "drizzle-orm";
import { MUSIC, OUTCOME, type PlayOutcome } from "../analytics/common";
import type { Db } from "../db/client";

export function songPlaysSince(db: Db, songKey: string, since: number) {
  return db.all<{ ts: number; day: string; outcome: PlayOutcome | null }>(sql`
    select p.ts, p.day, ${OUTCOME} as outcome
    from ${MUSIC}
    where p.kind = 'track' and t.song_key = ${songKey} and p.ts > ${since}
    order by p.ts`);
}
