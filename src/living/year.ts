import { and, desc, eq } from "drizzle-orm";
import { recapPlaylistAbout, recapPlaylistName, recapPlaylistRow, uploadRecapCover, type RecapPlaylistRow } from "../digest/cover";
import { livingPlaylists, livingRefreshes, recapPlaylists, type LivingTrack } from "../db/schema";
import { localTime } from "../plays/localTime";
import { playlistDescription } from "../sets/playlist";
import { SpotifyApiError, SpotifyBlockedError } from "../spotify/errors";
import { yearTracks } from "./build";
import { LIVING_CAP } from "./kinds";
import { currentContext } from "./playing";
import type { LivingRow } from "./schedule";
import type { LivingDeps, RefreshOutcome } from "./refresh";

const sameUris = (a: LivingTrack[], b: LivingTrack[]) => a.length === b.length && a.every((t, i) => t.uri === b[i]!.uri);

function lastWrite(deps: LivingDeps, playlistId: string): { at: number; items: LivingTrack[] } | null {
  return (
    deps.db
      .select({ at: livingRefreshes.at, items: livingRefreshes.items })
      .from(livingRefreshes)
      .where(and(eq(livingRefreshes.kind, "this-year"), eq(livingRefreshes.playlistId, playlistId)))
      .orderBy(desc(livingRefreshes.id))
      .limit(1)
      .get() ?? null
  );
}

/**
 * At the first refresh in a new year, This year so far becomes the playlist of the year it holds: its songs set to that
 * whole year, renamed after the year, given the year's recap cover and recorded as the year's recap playlist. The
 * living row then lets go of it, so the refresh that follows starts a new playlist for the new year.
 *
 * Returns "closed" after closing, an outcome when the refresh has to stop here (the playlist is playing, or Spotify
 * failed), and null when there is nothing to close. When the year already has a playlist of its own (saved from its
 * recap), nothing is closed and the playlist carries on into the new year.
 */
export async function closeYear(deps: LivingDeps, row: LivingRow): Promise<"closed" | RefreshOutcome | null> {
  const { db, spotify } = deps;
  const live = row.removedAt === null ? row.playlistId : null;
  if (row.kind !== "this-year" || !live || !row.playlistUrl) return null;
  const now = deps.now();
  const { timezone, watcherIdleMs } = deps.settings.get();
  const last = lastWrite(deps, live);
  if (!last) return null;
  const year = localTime(last.at, timezone).day.slice(0, 4);
  if (year >= localTime(now, timezone).day.slice(0, 4) || recapPlaylistRow(db, "yearly", year)) return null;
  const patch = (p: Partial<LivingRow>) => db.update(livingPlaylists).set({ ...p, updatedAt: now }).where(eq(livingPlaylists.kind, "this-year")).run();
  if (currentContext(db, now, watcherIdleMs) === `spotify:playlist:${live}`) {
    patch({ status: "deferred", error: null, attemptedAt: now });
    return { kind: "this-year", status: "deferred", calls: 0 };
  }

  const whole = yearTracks(db, { from: `${year}-01-01`, to: `${year}-12-31` }, LIVING_CAP);
  const items = whole.length ? whole : last.items;
  let calls = 0;
  try {
    await spotify.updatePlaylistDetails(live, { name: recapPlaylistName("yearly", year), description: playlistDescription(recapPlaylistAbout("yearly", year)) });
    calls++;
    if (!sameUris(last.items, items)) {
      await spotify.replacePlaylistItems(live, items.map((t) => t.uri));
      calls++;
    }
  } catch (error) {
    if (error instanceof SpotifyApiError && error.status === 404) return null;
    if (!(error instanceof SpotifyApiError || error instanceof SpotifyBlockedError)) throw error;
    patch({ status: "failed", error: error.message, attemptedAt: now });
    return { kind: "this-year", status: "failed", calls };
  }

  const recap: RecapPlaylistRow = { kind: "yearly", periodKey: year, playlistId: live, playlistUrl: row.playlistUrl, source: "living", coverUploadKey: null, savedAt: now };
  db.insert(recapPlaylists).values(recap).onConflictDoNothing().run();
  const cover = await uploadRecapCover(deps, recap, items);
  if (cover === "uploaded" || cover === "failed") calls++;
  db.insert(livingRefreshes)
    .values({
      kind: "this-year",
      playlistId: live,
      trigger: "year-end",
      items,
      added: items.filter((t) => !last.items.some((c) => c.songKey === t.songKey)),
      removed: last.items.filter((c) => !items.some((t) => t.songKey === c.songKey)),
      calls,
      at: now,
    })
    .run();
  patch({ playlistId: null, playlistUrl: null, createdAt: null, coverUploadKey: null, status: null, error: null });
  return "closed";
}
