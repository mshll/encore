import { and, asc, desc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { livingPlaylists, livingRefreshes, releases, releaseTracks, settings as settingsTable, type LivingKind, type LivingStatus, type LivingTrack, type LivingTrigger } from "../db/schema";
import { getJobState } from "../jobs/state";
import { localTime } from "../plays/localTime";
import { songKey } from "../plays/song";
import { isReissue } from "../radar/reissue";
import { playlistDescription } from "../sets/playlist";
import type { SettingsSource } from "../settings/settings";
import type { SpotifyClient } from "../spotify/client";
import { SpotifyApiError, SpotifyBlockedError, SpotifyNotConnectedError } from "../spotify/errors";
import { buildRule, dayBefore, type BuildContext } from "./engine";
import { replaceMerge, rollingMerge } from "./merge";
import { livingCover, livingCoverKey } from "./cover";
import { isLivingKind, LIVING_ORDER, specOf, type LivingSpec } from "./kinds";
import { currentContext } from "./playing";
import { isDue, periodOf, type LivingRow } from "./schedule";
import { closeYear } from "./year";

export type LivingDeps = { db: Db; spotify: SpotifyClient; settings: SettingsSource; now: () => number };
export type CoverStatus = "uploaded" | "unchanged" | "missing_scope" | "failed";
export type RefreshOutcome = { kind: string; status: LivingStatus | "off"; calls: number; cover?: CoverStatus };

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

export class LivingNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`No playlist ${id}`);
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
    name: null,
    about: null,
    rule: null,
    definedAt: null,
    frozen: false,
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

/** A built-in kind's row, or a rule's row while the rule exists. */
export function findLivingRow(db: Db, id: string, now: number): LivingRow | null {
  if (isLivingKind(id)) return livingRow(db, id, now);
  return db.select().from(livingPlaylists).where(eq(livingPlaylists.kind, id)).get() ?? null;
}

export function requireLivingRow(db: Db, id: string, now: number): LivingRow {
  const row = findLivingRow(db, id, now);
  if (!row) throw new LivingNotFoundError(id);
  return row;
}

/** The built-ins in their order, then the owner's rules in the order they were made. */
export function livingRows(db: Db, now: number): LivingRow[] {
  const rules = db.select().from(livingPlaylists).where(isNotNull(livingPlaylists.definedAt)).orderBy(asc(livingPlaylists.definedAt), asc(livingPlaylists.kind)).all();
  return [...LIVING_ORDER.map((kind) => livingRow(db, kind, now)), ...rules];
}

export function patchRow(db: Db, kind: string, patch: Partial<LivingRow>, now: number) {
  db.update(livingPlaylists)
    .set({ ...patch, updatedAt: now })
    .where(eq(livingPlaylists.kind, kind))
    .run();
}

/** Contents encore last wrote to this Spotify playlist. */
export function currentItems(db: Db, kind: string, playlistId: string | null): LivingTrack[] {
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

function placedKeys(db: Db, kind: string, playlistId: string | null): Set<string> {
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
  const { rule } = specOf(row);
  const ctx = buildContext(deps);
  const playlistId = row.removedAt === null ? row.playlistId : null;
  const candidates = buildRule(deps.db, rule, { ...ctx, seed: `${row.kind}:${periodOf(rule.schedule, ctx.now, ctx.timezone) ?? ""}` });
  if (!rule.rolling) return replaceMerge(candidates, rule.limit);
  return rollingMerge(currentItems(deps.db, row.kind, playlistId), candidates, { cap: rule.limit, perRefresh: rule.rolling.perRefresh, placed: placedKeys(deps.db, row.kind, playlistId) });
}

export function livingDescription(spec: LivingSpec, ctx: BuildContext): string {
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: ctx.timezone }).format(ctx.now);
  return playlistDescription(`${spec.about(ctx)}. Updated ${date} by encore.`);
}

const sameUris = (a: LivingTrack[], b: LivingTrack[]) => a.length === b.length && a.every((t, i) => t.uri === b[i]!.uri);
const isGone = (error: unknown) => error instanceof SpotifyApiError && error.status === 404;

function assertCanWrite(spotify: SpotifyClient) {
  if (!spotify.connected()) throw new SpotifyNotConnectedError();
  if (!spotify.hasScope(WRITE_SCOPE)) throw new MissingScopeError(WRITE_SCOPE);
}

async function uploadCover(deps: LivingDeps, spec: LivingSpec, playlistId: string): Promise<{ status: CoverStatus; calls: number }> {
  const kind = spec.id;
  const key = livingCoverKey(spec);
  if (requireLivingRow(deps.db, kind, deps.now()).coverUploadKey === key) return { status: "unchanged", calls: 0 };
  if (!deps.spotify.hasScope(UPLOAD_SCOPE)) return { status: "missing_scope", calls: 0 };
  try {
    await deps.spotify.uploadPlaylistCover(playlistId, await livingCover(spec));
    patchRow(deps.db, kind, { coverUploadKey: key }, deps.now());
    return { status: "uploaded", calls: 1 };
  } catch (error) {
    console.error(`Living playlist ${kind}: cover was not uploaded: ${error instanceof Error ? error.message : String(error)}`);
    return { status: "failed", calls: 1 };
  }
}

const inFlight = new Map<string, Promise<RefreshOutcome>>();

/** `details`: write the name and description even when the songs are unchanged, after the owner renamed the playlist. */
export type RefreshOptions = { details?: boolean };

/**
 * Brings the kind's Spotify playlist up to date: made on the first refresh, then always updated in place.
 * Writes nothing when the contents are the same, when the new list is empty, or while the playlist is the
 * playback context (deferred until the next run). Spotify failures are recorded on the row, not thrown.
 */
export function refreshLiving(deps: LivingDeps, kind: string, trigger: LivingTrigger, opts: RefreshOptions = {}): Promise<RefreshOutcome> {
  const running = inFlight.get(kind);
  if (running) return running;
  const pending = refresh(deps, kind, trigger, opts).finally(() => inFlight.delete(kind));
  inFlight.set(kind, pending);
  return pending;
}

async function refresh(deps: LivingDeps, kind: string, trigger: LivingTrigger, opts: RefreshOptions): Promise<RefreshOutcome> {
  const { db, spotify } = deps;
  const ctx = buildContext(deps);
  let row = requireLivingRow(db, kind, ctx.now);
  const spec = specOf(row);
  if (!row.enabled) return { kind, status: "off", calls: 0 };
  assertCanWrite(spotify);
  const closed = await closeYear(deps, row);
  if (closed !== null && closed !== "closed") return closed;
  if (closed === "closed") row = requireLivingRow(db, kind, ctx.now);
  const live = row.removedAt === null ? row.playlistId : null;
  const current = currentItems(db, kind, live);
  const next = nextItems(deps, row);
  const settle = (status: LivingStatus, patch: Partial<LivingRow> = {}) =>
    patchRow(db, kind, { status, error: null, attemptedAt: ctx.now, ...(status === "deferred" ? {} : { checkedAt: ctx.now }), ...patch }, ctx.now);

  if (!live && next.length === 0 && spec.waitForSongs) {
    settle("empty");
    return { kind, status: "empty", calls: 0 };
  }
  if (live && next.length === 0) {
    settle("empty");
    return { kind, status: "empty", calls: 0 };
  }
  if (live && sameUris(current, next)) {
    let calls = 0;
    if (opts.details) {
      try {
        await spotify.updatePlaylistDetails(live, { name: spec.name, description: livingDescription(spec, ctx) });
        calls++;
      } catch (error) {
        if (!(error instanceof SpotifyApiError || error instanceof SpotifyBlockedError)) throw error;
        patchRow(db, kind, { status: "failed", error: error.message, attemptedAt: ctx.now }, ctx.now);
        return { kind, status: "failed", calls: 1 };
      }
    }
    const cover = await uploadCover(deps, spec, live);
    settle("unchanged");
    return { kind, status: "unchanged", calls: calls + cover.calls, cover: cover.status };
  }
  if (live && currentContext(db, ctx.now, deps.settings.get().watcherIdleMs) === `spotify:playlist:${live}`) {
    settle("deferred");
    return { kind, status: "deferred", calls: 0 };
  }

  let calls = 0;
  let playlistId = live;
  try {
    const details = { name: spec.name, description: livingDescription(spec, ctx) };
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
  const cover = await uploadCover(deps, spec, playlistId);
  calls += cover.calls;
  db.insert(livingRefreshes).values({ kind, playlistId, trigger, items: next, added, removed, calls, at: ctx.now }).run();
  const status: LivingStatus = next.length ? "refreshed" : "empty";
  settle(status);
  return { kind, status, calls, cover: cover.status };
}

/** Refreshes Weekly picks after the picks changed, when it is on. A failure is logged and recorded, never thrown. */
export async function refreshPicksPlaylist(deps: LivingDeps): Promise<RefreshOutcome | null> {
  const row = livingRow(deps.db, "picks", deps.now());
  if (!row.enabled || row.frozen) return null;
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
export async function setLivingEnabled(deps: LivingDeps, kind: string, enabled: boolean): Promise<RefreshOutcome> {
  const now = deps.now();
  const row = requireLivingRow(deps.db, kind, now);
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
export async function fetchReleaseTracks(deps: LivingDeps, days: number): Promise<{ releases: number; calls: number }> {
  const { db, spotify } = deps;
  const ctx = buildContext(deps);
  const since = dayBefore(localTime(ctx.now, ctx.timezone).day, days);
  const due = db
    .select({ id: releases.id, artist: releases.artistName, name: releases.name, albumType: releases.albumType })
    .from(releases)
    .where(and(eq(releases.isNew, true), isNull(releases.tracksFetchedAt), gte(releases.releaseDate, since)))
    .orderBy(desc(releases.releaseDate), asc(releases.id))
    .all()
    .filter((r) => !isReissue(r))
    .slice(0, RELEASES_PER_RUN);
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
  const rows = livingRows(deps.db, now).filter((r) => isDue(specOf(r).rule.schedule, r, now, timezone));
  if (rows.length === 0) return { due: 0 };
  if (!deps.spotify.hasScope(WRITE_SCOPE)) return { due: rows.length, skipped: "missing_scope" };
  const result: Record<string, unknown> = { due: rows.length };
  const releaseDays = Math.max(0, ...rows.map((r) => specOf(r).rule.source).map((s) => (s.type === "releases" ? s.days : 0)));
  if (releaseDays > 0) {
    try {
      result.releaseTracks = await fetchReleaseTracks(deps, releaseDays);
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
export function markRemovedPlaylists(db: Db, listed: Set<string>, listingStartedAt: number, now: number): string[] {
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
