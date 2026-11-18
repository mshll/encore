import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { livingRefreshes } from "../db/schema";
import { withArtwork } from "../library/artwork";
import { livingCoverUrl } from "./cover";
import { specOf } from "./kinds";
import { currentItems, livingRows, nextItems, requireLivingRow, WRITE_SCOPE, type LivingDeps } from "./refresh";
import { nextRefreshDay, type LivingRow } from "./schedule";

const HISTORY = 30;
/** Songs the list shows of each playlist. */
const LIST_SONGS = 5;
const iso = (ts: number | null) => (ts === null ? null : new Date(ts).toISOString());

function lastChange(db: Db, row: LivingRow) {
  if (!row.playlistId) return null;
  return (
    db
      .select({ at: livingRefreshes.at })
      .from(livingRefreshes)
      .where(and(eq(livingRefreshes.kind, row.kind), eq(livingRefreshes.playlistId, row.playlistId)))
      .orderBy(desc(livingRefreshes.id))
      .limit(1)
      .get()?.at ?? null
  );
}

function summary(deps: LivingDeps, row: LivingRow) {
  return withSongs(deps, row, 0).summary;
}

/** The playlist's summary and its first `songs` songs: what is in it now, else what a refresh would put in it. */
function withSongs(deps: LivingDeps, row: LivingRow, songs: number) {
  const spec = specOf(row);
  const now = deps.now();
  const { timezone } = deps.settings.get();
  const live = row.removedAt === null ? row.playlistId : null;
  const next = nextItems(deps, row);
  const current = currentItems(deps.db, row.kind, live);
  const summary = {
    kind: row.kind,
    builtin: spec.builtin,
    name: spec.name,
    about: spec.about({ now, timezone }),
    mode: spec.rule.rolling ? "rolling" : "replace",
    schedule: spec.rule.schedule,
    cap: spec.rule.limit,
    rule: spec.rule,
    enabled: row.enabled,
    frozen: row.frozen,
    playlist: live && row.playlistUrl ? { id: live, url: row.playlistUrl } : null,
    removedAt: iso(row.removedAt),
    coverUrl: livingCoverUrl(spec),
    status: row.status,
    error: row.error,
    attemptedAt: iso(row.attemptedAt),
    checkedAt: iso(row.checkedAt),
    changedAt: iso(live ? lastChange(deps.db, row) : null),
    nextRefresh: row.enabled && !row.frozen ? nextRefreshDay(spec.rule.schedule, row.checkedAt, now, timezone) : null,
    count: current.length,
    available: next.length,
  };
  return { summary, songs: songs ? withArtwork(deps.db, (current.length ? current : next).slice(0, songs)) : [] };
}

export function livingList(deps: LivingDeps) {
  const { spotify } = deps;
  return {
    spotify: { connected: spotify.connected(), canWrite: spotify.hasScope(WRITE_SCOPE), canUploadCovers: spotify.hasScope("ugc-image-upload") },
    items: livingRows(deps.db, deps.now()).map((row) => {
      const s = withSongs(deps, row, LIST_SONGS);
      return { ...s.summary, songs: s.songs };
    }),
  };
}

/** One playlist with what is in it now, or what a refresh would put in it while it has nothing, and its refreshes. */
export function livingDetail(deps: LivingDeps, kind: string) {
  const row = requireLivingRow(deps.db, kind, deps.now());
  const live = row.removedAt === null ? row.playlistId : null;
  const items = currentItems(deps.db, kind, live);
  const history = deps.db
    .select()
    .from(livingRefreshes)
    .where(eq(livingRefreshes.kind, kind))
    .orderBy(desc(livingRefreshes.id))
    .limit(HISTORY)
    .all();
  return {
    ...summary(deps, row),
    items: withArtwork(deps.db, items),
    preview: items.length ? [] : withArtwork(deps.db, nextItems(deps, row)),
    history: history.map((h) => ({
      id: h.id,
      at: new Date(h.at).toISOString(),
      trigger: h.trigger,
      count: h.items.length,
      added: h.added,
      removed: h.removed,
      current: h.playlistId === live,
    })),
  };
}

/** The full contents a past refresh left in the playlist. */
export function livingRefresh(db: Db, kind: string, id: number) {
  const row = db
    .select()
    .from(livingRefreshes)
    .where(and(eq(livingRefreshes.kind, kind), eq(livingRefreshes.id, id)))
    .get();
  if (!row) return null;
  return { id: row.id, at: new Date(row.at).toISOString(), trigger: row.trigger, items: withArtwork(db, row.items), added: row.added, removed: row.removed };
}
