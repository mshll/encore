import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { setItems, sets } from "../db/schema";
import { songPlaysSince } from "../library/outcomes";

export function refreshSetOutcomes(db: Db) {
  const items = db
    .select({ id: setItems.id, songKey: setItems.songKey, since: sql<number>`coalesce(${sets.savedAt}, ${sets.createdAt})` })
    .from(setItems)
    .innerJoin(sets, eq(sets.id, setItems.setId))
    .all();
  let updated = 0;
  db.transaction((tx) => {
    for (const item of items) {
      const plays = songPlaysSince(db, item.songKey, item.since);
      tx.update(setItems)
        .set({
          playsAfter: plays.length,
          finished: plays.filter((p) => p.outcome === "finished").length,
          skipped: plays.filter((p) => p.outcome === "skipped").length,
          firstPlayedAt: plays[0]?.ts ?? null,
        })
        .where(eq(setItems.id, item.id))
        .run();
      updated++;
    }
  });
  return { items: updated };
}

export function setOutcomeSummary(db: Db): string {
  const rows = db.all<{ kind: string; items: number; played: number; finished: number; skipped: number }>(sql`
    select kind, count(*) as items, sum(plays_after > 0) as played, sum(finished) as finished, sum(skipped) as skipped
    from set_items group by kind order by kind`);
  if (rows.length === 0) return "Sets: none built yet.";
  const parts = rows.map((r) => `${r.kind} songs: ${r.items} placed, ${r.played} played since, ${r.finished} finished plays, ${r.skipped} skipped plays`);
  const skippedNew = db.all<{ name: string; artist: string }>(sql`
    select name, artist from set_items where kind = 'new' and skipped > 0 and finished = 0 order by first_played_at desc limit 8`);
  const keptNew = db.all<{ name: string; artist: string }>(sql`
    select name, artist from set_items where kind = 'new' and finished > 0 order by finished desc limit 8`);
  return [
    `Sets: ${parts.join("; ")}.`,
    keptNew.length ? `New songs from sets that were finished: ${keptNew.map((s) => `${s.name} - ${s.artist}`).join("; ")}.` : "",
    skippedNew.length ? `New songs from sets that were only skipped: ${skippedNew.map((s) => `${s.name} - ${s.artist}`).join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
