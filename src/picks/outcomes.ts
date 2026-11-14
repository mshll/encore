import { desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { picks } from "../db/schema";
import { songPlaysSince } from "../library/outcomes";
import type { SpotifyClient } from "../spotify/client";

const SETTLE_MS = 7 * 86_400_000;
const LIBRARY_CHECK_BATCH = 20;

export function refreshPickOutcomes(db: Db) {
  const rows = db.select({ id: picks.id, songKey: picks.songKey, createdAt: picks.createdAt }).from(picks).all();
  db.transaction((tx) => {
    for (const p of rows) {
      const plays = songPlaysSince(db, p.songKey, p.createdAt);
      tx.update(picks)
        .set({
          plays: plays.length,
          finished: plays.filter((x) => x.outcome === "finished").length,
          playDays: new Set(plays.map((x) => x.day)).size,
          firstPlayedAt: plays[0]?.ts ?? null,
        })
        .where(eq(picks.id, p.id))
        .run();
    }
  });
  return { picks: rows.length };
}

export async function refreshPickLibraryState(db: Db, spotify: SpotifyClient, now: number) {
  const recent = db
    .select({ id: picks.id, uri: picks.uri })
    .from(picks)
    .where(gt(picks.createdAt, now - 8 * SETTLE_MS))
    .orderBy(desc(picks.createdAt))
    .limit(LIBRARY_CHECK_BATCH)
    .all();
  if (recent.length === 0) return { checked: 0 };
  const contains = await spotify.libraryContains(recent.map((r) => r.uri));
  db.transaction((tx) => {
    recent.forEach((r, i) => tx.update(picks).set({ inLibrary: contains[i] ?? null }).where(eq(picks.id, r.id)).run());
  });
  return { checked: recent.length };
}

export const isHit = (p: { finished: number; playDays: number; inLibrary: boolean | null; state: string }) =>
  p.finished > 0 && (p.playDays >= 2 || p.inLibrary === true || p.state === "saved");

export function pickStats(db: Db, now: number) {
  const settled = db
    .select()
    .from(picks)
    .all()
    .filter((p) => p.createdAt <= now - SETTLE_MS);
  const played = settled.filter((p) => p.plays > 0).length;
  const hits = settled.filter(isHit).length;
  return { settled: settled.length, played, hits, hitRate: settled.length ? Math.round((hits / settled.length) * 1000) / 1000 : null };
}

export function pickOutcomeSummary(db: Db): string {
  const rows = db.all<{ name: string; artist: string; state: string; plays: number; finished: number; play_days: number; in_library: number | null; distance: string }>(sql`
    select name, artist, state, plays, finished, play_days, in_library, distance from picks order by created_at desc limit 40`);
  if (rows.length === 0) return "Weekly picks: none yet.";
  const describe = (r: (typeof rows)[number]) => {
    const hit = isHit({ finished: r.finished, playDays: r.play_days, inLibrary: r.in_library === null ? null : r.in_library === 1, state: r.state });
    return `${r.name} - ${r.artist} [${r.distance}, ${r.state}, plays ${r.plays}, finished ${r.finished}, ${hit ? "HIT" : "no hit"}]`;
  };
  return `Weekly picks, newest first (a hit = finished at least once and replayed on another day, saved to the library, or marked saved): ${rows.map(describe).join("; ")}`;
}
