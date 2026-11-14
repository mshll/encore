import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { livingPlaylists, livingRefreshes, releases, releaseTracks, settings as settingsTable, type LivingKind, type LivingStatus, type LivingTrack, type LivingTrigger } from "../db/schema";
import { getJobState } from "../jobs/state";
import { localTime } from "../plays/localTime";
import { songKey } from "../plays/song";
import { playlistDescription } from "../sets/playlist";
import type { SettingsSource } from "../settings/settings";
import type { SpotifyClient } from "../spotify/client";
import { SpotifyApiError, SpotifyBlockedError, SpotifyNotConnectedError } from "../spotify/errors";
import { NEW_RELEASE_DAYS, replaceMerge, rollingMerge, type BuildContext } from "./build";
import { livingCover, livingCoverKey } from "./cover";
import { LIVING, LIVING_CAP, LIVING_ORDER } from "./kinds";
import { currentContext } from "./playing";
import { isDue, type LivingRow } from "./schedule";
import { closeYear } from "./year";

export type LivingDeps = { db: Db; spotify: SpotifyClient; settings: SettingsSource; now: () => number };
export type CoverStatus = "uploaded" | "unchanged" | "missing_scope" | "failed";
export type RefreshOutcome = { kind: LivingKind; status: LivingStatus | "off"; calls: number; cover?: CoverStatus };

export const WRITE_SCOPE = "playlist-modify-private";
const UPLOAD_SCOPE = "ugc-image-upload";
/** Tracks taken from each new release: one album tracks call per release, once. */
export const RELEASE_TRACKS = 3;
/** Album track lists fetched per job run, to spread the calls. */
const RELEASES_PER_RUN = 3;
const OLD_PICKS_MIRROR = "picks_playlist";

export class MissingScopeError extends Error {
  constructor(readonly scope: string) {
    super(`Spotify access is missing the ${scope} permission`);
  }
}

/** The kind's row, made on first use. The picks row takes over the playlist of the old picks mirror, so no second one is made. */
export function livingRow(db: Db, kind: LivingKind, now: number): LivingRow {
  const row = db.select().from(livingPlaylists).where(eq(livingPlaylists.kind, kind)).get();
  if (row) return row;
  const mirror = kind === "picks" ? (getJobState(db, OLD_PICKS_MIRROR)?.data as { playlistId: string; url: string } | undefined) : undefined;
  const mirrorOn = db.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, "picksPlaylist")).get()?.value === true;
  const fresh: LivingRow = {
    kind,
    enabled: Boolean(mirror && mirrorOn),
    playlistId: mirror?.playlistId ?? null,
    playlistUrl: mirror?.url ?? null,
    createdAt: mirror ? now : null,
    removedAt: null,
    coverUploadKey: null,
    status: null,
    error: null,
    attemptedAt: null,
    checkedAt: null,
    updatedAt: now,
  };
  db.insert(livingPlaylists).values(fresh).onConflictDoNothing().run();
  return db.select().from(livingPlaylists).where(eq(livingPlaylists.kind, kind)).get()!;
}

export const livingRows = (db: Db, now: number): LivingRow[] => LIVING_ORDER.map((kind) => livingRow(db, kind, now));

function patchRow(db: Db, kind: LivingKind, patch: Partial<LivingRow>, now: number) {
  db.update(livingPlaylists)
    .set({ ...patch, updatedAt: now })
    .where(eq(livingPlaylists.kind, kind))
    .run();
}

/** Contents encore last wrote to this Spotify playlist. */
export function currentItems(db: Db, kind: LivingKind, playlistId: string | null): LivingTrack[] {
  if (!playlistId) return [];
  return (
    db
      .select({ items: livingRefreshes.items })
      .from(livingRefreshes)
      .where(and(eq(livingRefreshes.kind, kind), eq(livingRefreshes.playlistId, playlistId)))
      .orderBy(desc(livingRefreshes.id))
      .limit(1)
      .get()?.items ?? []
  );
}

function placedKeys(db: Db, kind: LivingKind, playlistId: string | null): Set<string> {
  if (!playlistId) return new Set();
  const rows = db
    .select({ items: livingRefreshes.items })
    .from(livingRefreshes)
    .where(and(eq(livingRefreshes.kind, kind), eq(livingRefreshes.playlistId, playlistId)))
    .all();
  return new Set(rows.flatMap((r) => r.items.map((t) => t.songKey)));
}

function buildContext(deps: LivingDeps): BuildContext {
  return { now: deps.now(), timezone: deps.settings.get().timezone };
}

/** The playlist's contents after a refresh now, from the database alone. */
export function nextItems(deps: LivingDeps, row: LivingRow): LivingTrack[] {
  const spec = LIVING[row.kind];
  const playlistId = row.removedAt === null ? row.playlistId : null;
  const candidates = spec.build(deps.db, buildContext(deps));
  if (spec.mode === "replace") return replaceMerge(candidates, LIVING_CAP);
  return rollingMerge(currentItems(deps.db, row.kind, playlistId), candidates, { cap: LIVING_CAP, perRefresh: spec.perRefresh ?? LIVING_CAP, placed: placedKeys(deps.db, row.kind, playlistId) });
}

export function livingDescription(kind: LivingKind, ctx: BuildContext): string {
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: ctx.timezone }).format(ctx.now);
  return playlistDescription(`${LIVING[kind].about(ctx)}. Updated ${date} by encore.`);
}

const sameUris = (a: LivingTrack[], b: LivingTrack[]) => a.length === b.length && a.every((t, i) => t.uri === b[i]!.uri);
const isGone = (error: unknown) => error instanceof SpotifyApiError && error.status === 404;

function assertCanWrite(spotify: SpotifyClient) {
  if (!spotify.connected()) throw new SpotifyNotConnectedError();
  if (!spotify.hasScope(WRITE_SCOPE)) throw new MissingScopeError(WRITE_SCOPE);
}

async function uploadCover(deps: LivingDeps, kind: LivingKind, playlistId: string): Promise<{ status: CoverStatus; calls: number }> {
  const key = livingCoverKey(kind);
  if (livingRow(deps.db, kind, deps.now()).coverUploadKey === key) return { status: "unchanged", calls: 0 };
  if (!deps.spotify.hasScope(UPLOAD_SCOPE)) return { status: "missing_scope", calls: 0 };
  try {
    await deps.spotify.uploadPlaylistCover(playlistId, await livingCover(kind));
    patchRow(deps.db, kind, { coverUploadKey: key }, deps.now());
    return { status: "uploaded", calls: 1 };
  } catch (error) {
    console.error(`Living playlist ${kind}: cover was not uploaded: ${error instanceof Error ? error.message : String(error)}`);
    return { status: "failed", calls: 1 };
  }
}

const inFlight = new Map<LivingKind, Promise<RefreshOutcome>>();

/**
 * Brings the kind's Spotify playlist up to date: made on the first refresh, then always updated in place.
 * Writes nothing when the contents are the same, when the new list is empty, or while the playlist is the
 * playback context (deferred until the next run). Spotify failures are recorded on the row, not thrown.
 */
export function refreshLiving(deps: LivingDeps, kind: LivingKind, trigger: LivingTrigger): Promise<RefreshOutcome> {
  const running = inFlight.get(kind);
  if (running) return running;
  const pending = refresh(deps, kind, trigger).finally(() => inFlight.delete(kind));
  inFlight.set(kind, pending);
  return pending;
}

async function refresh(deps: LivingDeps, kind: LivingKind, trigger: LivingTrigger): Promise<RefreshOutcome> {
  const { db, spotify } = deps;
  const ctx = buildContext(deps);
  let row = livingRow(db, kind, ctx.now);
  if (!row.enabled) return { kind, status: "off", calls: 0 };
  assertCanWrite(spotify);
  const closed = await closeYear(deps, row);
  if (closed !== null && closed !== "closed") return closed;
  if (closed === "closed") row = livingRow(db, kind, ctx.now);
  const live = row.removedAt === null ? row.playlistId : null;
  const current = currentItems(db, kind, live);
  const next = nextItems(deps, row);
  const settle = (status: LivingStatus, patch: Partial<LivingRow> = {}) =>
    patchRow(db, kind, { status, error: null, attemptedAt: ctx.now, ...(status === "deferred" ? {} : { checkedAt: ctx.now }), ...patch }, ctx.now);

  if (!live && next.length === 0 && LIVING[kind].waitForSongs) {
    settle("empty");
    return { kind, status: "empty", calls: 0 };
  }
  if (live && next.length === 0) {
    settle("empty");
    return { kind, status: "empty", calls: 0 };
  }
  if (live && sameUris(current, next)) {
    const cover = await uploadCover(deps, kind, live);
    settle("unchanged");
    return { kind, status: "unchanged", calls: cover.calls, cover: cover.status };
  }
  if (live && currentContext(db, ctx.now, deps.settings.get().watcherIdleMs) === `spotify:playlist:${live}`) {
    settle("deferred");
    return { kind, status: "deferred", calls: 0 };
  }

  let calls = 0;
  let playlistId = live;
  try {
    const details = { name: LIVING[kind].name, description: livingDescription(kind, ctx) };
    if (!playlistId) {
      const created = await spotify.createPlaylist({ ...details, public: false });
      calls++;
      playlistId = created.id;
      patchRow(db, kind, { playlistId, playlistUrl: created.external_urls.spotify, createdAt: ctx.now, removedAt: null, coverUploadKey: null }, ctx.now);
    } else {
      await spotify.updatePlaylistDetails(playlistId, details);
      calls++;
    }
    if (next.length) {
      await spotify.replacePlaylistItems(playlistId, next.map((t) => t.uri));
      calls++;
    }
  } catch (error) {
    if (playlistId && isGone(error)) {
      patchRow(db, kind, { enabled: false, removedAt: ctx.now, status: "removed", error: null, attemptedAt: ctx.now }, ctx.now);
      return { kind, status: "removed", calls };
    }
    if (!(error instanceof SpotifyApiError || error instanceof SpotifyBlockedError)) throw error;
    patchRow(db, kind, { status: "failed", error: error.message, attemptedAt: ctx.now }, ctx.now);
    return { kind, status: "failed", calls };
  }

  const added = next.filter((t) => !current.some((c) => c.songKey === t.songKey));
  const removed = current.filter((c) => !next.some((t) => t.songKey === c.songKey));
  const cover = await uploadCover(deps, kind, playlistId);
  calls += cover.calls;
  db.insert(livingRefreshes).values({ kind, playlistId, trigger, items: next, added, removed, calls, at: ctx.now }).run();
  const status: LivingStatus = next.length ? "refreshed" : "empty";
  settle(status);
  return { kind, status, calls, cover: cover.status };
}

/** Refreshes Weekly picks after the picks changed, when it is on. A failure is logged and recorded, never thrown. */
export async function refreshPicksPlaylist(deps: LivingDeps): Promise<RefreshOutcome | null> {
  if (!livingRow(deps.db, "picks", deps.now()).enabled) return null;
  try {
    return await refreshLiving(deps, "picks", "picks");
  } catch (error) {
    console.error(`Living playlist picks was not refreshed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** The kind's Spotify playlist while it exists in the owner's account. */
export function livingPlaylistLink(db: Db, kind: LivingKind, now: number): { playlistId: string; url: string } | null {
  const row = livingRow(db, kind, now);
  return row.playlistId && row.playlistUrl && row.removedAt === null ? { playlistId: row.playlistId, url: row.playlistUrl } : null;
}

/** Switching on makes the playlist (or a new one after it was deleted in Spotify) and fills it. Switching off only stops refreshes. */
export async function setLivingEnabled(deps: LivingDeps, kind: LivingKind, enabled: boolean): Promise<RefreshOutcome> {
  const now = deps.now();
  const row = livingRow(deps.db, kind, now);
  if (!enabled) {
    patchRow(deps.db, kind, { enabled: false }, now);
    return { kind, status: "off", calls: 0 };
  }
  assertCanWrite(deps.spotify);
  if (!row.enabled) patchRow(deps.db, kind, { enabled: true, status: null, error: null }, now);
  return refreshLiving(deps, kind, "enable");
}

/**
 * Stores the first tracks of new releases that have none yet, a few releases per run, one album tracks call each.
 * Only for releases the New from your artists playlist can still use.
 */
export async function fetchReleaseTracks(deps: LivingDeps): Promise<{ releases: number; calls: number }> {
  const { db, spotify } = deps;
  const ctx = buildContext(deps);
  const since = new Date(Date.parse(`${localTime(ctx.now, ctx.timezone).day}T00:00:00Z`) - NEW_RELEASE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const due = db
    .select({ id: releases.id, artist: releases.artistName })
    .from(releases)
    .where(and(eq(releases.isNew, true), isNull(releases.tracksFetchedAt), gte(releases.releaseDate, since)))
    .orderBy(desc(releases.releaseDate), asc(releases.id))
    .limit(RELEASES_PER_RUN)
    .all();
  let calls = 0;
  for (const release of due) {
    const page = await spotify.albumTracks(release.id, RELEASE_TRACKS);
    calls++;
    db.transaction((tx) => {
      page.items.slice(0, RELEASE_TRACKS).forEach((t, position) => {
        const artist = t.artists[0]?.name ?? release.artist;
        tx.insert(releaseTracks)
          .values({ releaseId: release.id, position, uri: t.uri, songKey: songKey(t.name, artist), name: t.name, artist })
          .onConflictDoNothing()
          .run();
      });
      tx.update(releases).set({ tracksFetchedAt: ctx.now }).where(eq(releases.id, release.id)).run();
    });
  }
  return { releases: due.length, calls };
}

/** One scheduler tick: fetch what New from your artists needs, then refresh every kind that is due. */
export async function runLiving(deps: LivingDeps): Promise<Record<string, unknown>> {
  const now = deps.now();
  const { timezone } = deps.settings.get();
  const rows = livingRows(deps.db, now).filter((r) => isDue(LIVING[r.kind].schedule, r, now, timezone));
  if (rows.length === 0) return { due: 0 };
  if (!deps.spotify.hasScope(WRITE_SCOPE)) return { due: rows.length, skipped: "missing_scope" };
  const result: Record<string, unknown> = { due: rows.length };
  if (rows.some((r) => r.kind === "new-releases")) {
    try {
      result.releaseTracks = await fetchReleaseTracks(deps);
    } catch (error) {
      if (!(error instanceof SpotifyApiError || error instanceof SpotifyBlockedError)) throw error;
      result.releaseTracks = { error: error.message };
    }
  }
  for (const row of rows) {
    const outcome = await refreshLiving(deps, row.kind, "schedule");
    result[row.kind] = { status: outcome.status, calls: outcome.calls };
  }
  return result;
}

/**
 * After a full listing of the owner's playlists, a living playlist made before the listing began that was not in it
 * has been deleted (unfollowed) in Spotify. Costs no call of its own.
 */
export function markRemovedPlaylists(db: Db, listed: Set<string>, listingStartedAt: number, now: number): LivingKind[] {
  const gone = db
    .select({ kind: livingPlaylists.kind, playlistId: livingPlaylists.playlistId, createdAt: livingPlaylists.createdAt })
    .from(livingPlaylists)
    .where(isNull(livingPlaylists.removedAt))
    .all()
    .filter((r) => r.playlistId && r.createdAt !== null && r.createdAt < listingStartedAt && !listed.has(r.playlistId))
    .map((r) => r.kind);
  if (gone.length) {
    db.update(livingPlaylists)
      .set({ enabled: false, removedAt: now, status: "removed", error: null, updatedAt: now })
      .where(inArray(livingPlaylists.kind, gone))
      .run();
  }
  return gone;
}
