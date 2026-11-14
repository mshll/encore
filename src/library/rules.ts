import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { musicWhere, rate, songStatsSql, type SongRow } from "../analytics/common";
import { momentSplit } from "../analytics/skips";
import type { Db, DbOrTx } from "../db/client";
import { cleanupProposals, libraryPlans, RULE_KINDS, type PlanAction, type RuleKind } from "../db/schema";
import { entryEvidence, loadLibrary, monthYear, plainReason, type LibraryEntry, type LibrarySnapshot } from "./analysis";

export const CLEANUP_RULES = {
  savedGraceDays: 30,
  playlistSkipMinPlays: 8,
  playlistSkipRateAtLeast: 0.9,
  dislikeMinPlays: 8,
  dislikeMinContextPlays: 5,
  /** listens / plays at or below this. A skip flag after minutes of listening is not a cut-short play (Sinnerman: 5 listens of 8 plays, all flagged skipped). */
  dislikeMaxListenRatio: 0.2,
};

/** What each rule plan is called and does by default. Skip rules also need the song out of rotation (no listen in 90 days): skips alone never put a song in a plan. */
export const RULES: Record<RuleKind, { title: string; summary: string; action: PlanAction }> = {
  saved_never_played: { title: "Liked songs never played", summary: "Liked more than 30 days ago and never played past 30 seconds.", action: "archive" },
  saved_dislike: { title: "Liked songs rarely played through", summary: "Started often, past 30 seconds at most one time in five, and not played in 3 months.", action: "archive" },
  playlist_skipped: { title: "Playlist songs rarely played through", summary: "Cut short nine times in ten or more, past 30 seconds at most one time in five, and not played in 3 months.", action: "archive" },
  playlist_duplicate: { title: "Extra copies in playlists", summary: "The same song more than once in one playlist. The first copy stays.", action: "dedupe" },
};

/** Creates the four rule plans once and gives every rule item from before plans its plan. Safe to run on every start. */
export function ensureRulePlans(db: DbOrTx, now: number) {
  for (const kind of RULE_KINDS) {
    db.insert(libraryPlans)
      .values({ source: "rule", ruleKind: kind, title: RULES[kind].title, summary: RULES[kind].summary, status: "open", createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: libraryPlans.ruleKind, set: { title: RULES[kind].title, summary: RULES[kind].summary } })
      .run();
  }
  db.run(sql`update cleanup_proposals set plan_id = (select id from library_plans where rule_kind = cleanup_proposals.kind) where plan_id is null and kind != 'plan'`);
}

export function rulePlanIds(db: Db): Record<RuleKind, number> {
  const rows = db.select({ id: libraryPlans.id, kind: libraryPlans.ruleKind }).from(libraryPlans).where(eq(libraryPlans.source, "rule")).all();
  return Object.fromEntries(rows.map((r) => [r.kind, r.id])) as Record<RuleKind, number>;
}

export const listenRatio = (stats: SongRow | undefined) => (stats && stats.plays > 0 ? stats.listens / stats.plays : null);

export type Proposal = { key: string; kind: RuleKind; playlistId: string | null; uri: string; reason: string; evidence: Record<string, unknown> };

const times = (n: number) => (n === 1 ? "once" : `${n} times`);
const outOfRotation = (e: LibraryEntry) => e.class === "dormant" || e.class === "fading";

function songStats(db: Db): Map<string, SongRow> {
  return new Map(db.all<SongRow>(songStatsSql(musicWhere({}))).map((r) => [r.song_key, r]));
}

function cutShortReason(snapshot: LibrarySnapshot, e: LibraryEntry, st: SongRow) {
  return `Started ${times(st.plays)}, past 30 seconds ${times(st.listens)}; last played ${monthYear(e.stats!.lastListen!, snapshot.timezone)}`;
}

export function computeProposals(db: Db, now: number, settings: { timezone: string; historyStart?: string | null; weekendDays: readonly number[] }): Proposal[] {
  const snapshot = loadLibrary(db, now, settings);
  const stats = songStats(db);
  const cutShort = new Set(
    momentSplit(db, { range: {}, minPlays: CLEANUP_RULES.dislikeMinPlays, minContextPlays: CLEANUP_RULES.dislikeMinContextPlays, limit: 1_000_000, only: "dislike", weekendDays: settings.weekendDays }).songs.map(
      (s) => s.songKey,
    ),
  );
  const proposals: Proposal[] = [];
  const graceCutoff = now - CLEANUP_RULES.savedGraceDays * 86_400_000;
  for (const e of snapshot.liked) {
    const st = stats.get(e.songKey);
    const evidence = { ...entryEvidence(e), savedAt: entryEvidence(e).addedAt };
    if (e.class === "never" && e.addedAt! < graceCutoff) {
      proposals.push({ key: `saved_never_played:${e.uri}`, kind: "saved_never_played", playlistId: null, uri: e.uri, reason: plainReason(snapshot, e), evidence });
      continue;
    }
    const ratio = listenRatio(st);
    if (st && cutShort.has(e.songKey) && outOfRotation(e) && ratio !== null && ratio <= CLEANUP_RULES.dislikeMaxListenRatio)
      proposals.push({
        key: `saved_dislike:${e.uri}`,
        kind: "saved_dislike",
        playlistId: null,
        uri: e.uri,
        reason: cutShortReason(snapshot, e, st),
        evidence: { ...evidence, skips: st.skips, skipRate: rate(st.skips, st.skip_known), listenRatio: rate(st.listens, st.plays) },
      });
  }

  const items = db.all<{ playlist_id: string; position: number; uri: string }>(sql`select playlist_id, position, uri from playlist_items order by playlist_id, position`);
  for (const e of snapshot.playlistEntries) {
    if (e.where.kind !== "playlist") continue;
    const { id: playlistId, name: playlistName } = e.where;
    const group = items.filter((i) => i.playlist_id === playlistId && e.positions.includes(i.position));
    const st = stats.get(e.songKey);
    const evidence = { ...entryEvidence(e), playlistId, playlistName, positions: e.positions };
    const ratio = listenRatio(st);
    if (
      st &&
      outOfRotation(e) &&
      st.skip_known >= CLEANUP_RULES.playlistSkipMinPlays &&
      st.skips / st.skip_known >= CLEANUP_RULES.playlistSkipRateAtLeast &&
      ratio !== null &&
      ratio <= CLEANUP_RULES.dislikeMaxListenRatio
    ) {
      proposals.push({
        key: `playlist_skipped:${playlistId}:${e.songKey}`,
        kind: "playlist_skipped",
        playlistId,
        uri: e.uri,
        reason: cutShortReason(snapshot, e, st),
        evidence: { ...evidence, skips: st.skips, skipRate: rate(st.skips, st.skip_known), uris: [...new Set(group.map((g) => g.uri))] },
      });
    }
    if (group.length > 1) {
      proposals.push({
        key: `playlist_duplicate:${playlistId}:${e.songKey}`,
        kind: "playlist_duplicate",
        playlistId,
        uri: e.uri,
        reason: `${group.length} copies in ${playlistName}; the first stays`,
        evidence: { ...evidence, keep: { position: group[0]!.position, uri: group[0]!.uri }, duplicates: group.slice(1).map((g) => ({ position: g.position, uri: g.uri })) },
      });
    }
  }
  return proposals;
}

/** Rebuilds the open items of the rule plans. Dismissed and applied items keep their status; an item skipped as stale opens again. */
export function refreshProposals(db: Db, now: number, settings: { timezone: string; historyStart?: string | null; weekendDays: readonly number[] }) {
  ensureRulePlans(db, now);
  const plans = rulePlanIds(db);
  const proposals = computeProposals(db, now, settings);
  db.transaction((tx) => {
    for (const p of proposals) {
      tx.insert(cleanupProposals)
        .values({ ...p, planId: plans[p.kind], action: RULES[p.kind].action, status: "open", createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: cleanupProposals.key,
          set: { uri: p.uri, reason: p.reason, evidence: p.evidence, status: "open", updatedAt: now },
          setWhere: inArray(cleanupProposals.status, ["open", "skipped"]),
        })
        .run();
    }
    const keys = proposals.map((p) => p.key);
    tx.delete(cleanupProposals)
      .where(and(inArray(cleanupProposals.status, ["open", "skipped"]), inArray(cleanupProposals.kind, [...RULE_KINDS]), keys.length ? notInArray(cleanupProposals.key, keys) : undefined))
      .run();
  });
  return proposalCounts(db);
}

export function proposalCounts(db: Db): Record<RuleKind, number> {
  const rows = db.all<{ kind: RuleKind; n: number }>(sql`select kind, count(*) as n from cleanup_proposals where status = 'open' and kind != 'plan' group by kind`);
  return Object.fromEntries(RULE_KINDS.map((k) => [k, rows.find((r) => r.kind === k)?.n ?? 0])) as Record<RuleKind, number>;
}

