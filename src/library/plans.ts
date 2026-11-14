import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { cleanupBatches, cleanupProposals, libraryPlans, ownedPlaylists, type PlanAction, type PlanSource, type RuleKind } from "../db/schema";
import { entryEvidence, groupEntries, plainReason, type LibraryEntry, type LibrarySnapshot, type SongGroup } from "./analysis";
import { RULES } from "./rules";

export class PlanNotFoundError extends Error {}
export class PlanSelectionError extends Error {
  constructor(
    message: string,
    readonly ids: number[] = [],
  ) {
    super(message);
  }
}

type Item = typeof cleanupProposals.$inferSelect;
type Plan = typeof libraryPlans.$inferSelect;

/** The actions that take a song out of where it is; the owner can switch these between archive and remove. */
export const TAKE_OUT: readonly PlanAction[] = ["archive", "remove"];

export const actionOf = (item: Pick<Item, "action" | "kind">): PlanAction => item.action ?? (item.kind in RULES ? RULES[item.kind as RuleKind].action : "archive");

export type NewItem = { action: PlanAction; playlistId: string | null; uri: string; reason: string; evidence: Record<string, unknown> };

export function createPlan(db: Db, input: { source: PlanSource; title: string; summary: string; items: NewItem[] }, now: number): number {
  return db.transaction((tx) => {
    const id = tx.insert(libraryPlans).values({ source: input.source, title: input.title, summary: input.summary, status: "open", createdAt: now, updatedAt: now }).returning().get().id;
    insertItems(tx, id, input.items, now);
    return id;
  });
}

function insertItems(tx: DbOrTx, planId: number, items: NewItem[], now: number) {
  if (items.length === 0) return;
  tx.insert(cleanupProposals)
    .values(
      items.map((i) => ({
        key: `plan:${planId}:${i.action}:${i.playlistId ?? "liked"}:${i.uri}`,
        kind: "plan" as const,
        planId,
        action: i.action,
        playlistId: i.playlistId,
        uri: i.uri,
        reason: i.reason,
        evidence: i.evidence,
        status: "open" as const,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing()
    .run();
}

/** Replaces the open items of a plan, keeping the owner's unticks and action switches on items that stay. */
export function replaceItems(db: Db, planId: number, items: NewItem[], now: number) {
  db.transaction((tx) => {
    const before = tx
      .select()
      .from(cleanupProposals)
      .where(and(eq(cleanupProposals.planId, planId), eq(cleanupProposals.status, "open")))
      .all();
    const owner = new Map(before.map((b) => [`${b.playlistId ?? "liked"}:${b.uri}`, b]));
    tx.delete(cleanupProposals)
      .where(and(eq(cleanupProposals.planId, planId), eq(cleanupProposals.status, "open")))
      .run();
    insertItems(
      tx,
      planId,
      items.map((i) => {
        const prior = owner.get(`${i.playlistId ?? "liked"}:${i.uri}`);
        return prior && TAKE_OUT.includes(i.action) && prior.action && TAKE_OUT.includes(prior.action) ? { ...i, action: prior.action } : i;
      }),
      now,
    );
    for (const b of before.filter((b) => !b.included)) {
      tx.update(cleanupProposals)
        .set({ included: false })
        .where(and(eq(cleanupProposals.planId, planId), eq(cleanupProposals.uri, b.uri), b.playlistId ? eq(cleanupProposals.playlistId, b.playlistId) : isNull(cleanupProposals.playlistId)))
        .run();
    }
    tx.update(libraryPlans).set({ updatedAt: now }).where(eq(libraryPlans.id, planId)).run();
  });
}

const CLASS_TITLES = { active: "Active songs", fading: "Fading songs", dormant: "Dormant songs", never: "Never played songs" } as const;

function groupTitle(g: SongGroup, place: string): string {
  if (g.kind === "unsaved") return "Played a lot, not liked";
  if (g.kind === "duplicates") return `Extra copies in ${place}`;
  const head = g.classes?.length === 1 ? CLASS_TITLES[g.classes[0]!] : "Songs";
  return [head, g.artist ? `by ${g.artist}` : null, `in ${place}`, g.savedMonth ? `from ${g.savedMonth}` : null].filter(Boolean).join(" ");
}

function placeName(snapshot: LibrarySnapshot, where: string) {
  return where === "liked" ? "liked songs" : (snapshot.playlists.find((p) => p.id === where)?.name ?? "a playlist");
}

const itemFrom = (snapshot: LibrarySnapshot, e: LibraryEntry, action: PlanAction): NewItem => ({
  action,
  playlistId: action === "save" || e.where.kind === "liked" ? null : e.where.id,
  uri: e.uri,
  reason: action === "dedupe" ? `${e.positions.length} copies in ${e.where.kind === "playlist" ? e.where.name : "the playlist"}; the first stays` : plainReason(snapshot, e),
  evidence: { ...entryEvidence(e), ...(e.where.kind === "playlist" ? { playlistId: e.where.id, playlistName: e.where.name, positions: e.positions } : {}) },
});

/** A plan for the songs behind one figure of the analysis: archive them, keep one copy of each, or like them. */
export function planFromGroup(db: Db, snapshot: LibrarySnapshot, group: SongGroup, now: number): number {
  const entries = groupEntries(snapshot, group);
  if (entries.length === 0) throw new PlanSelectionError("No songs in this group");
  const action: PlanAction = group.kind === "unsaved" ? "save" : group.kind === "duplicates" ? "dedupe" : "archive";
  const place = group.kind === "unsaved" ? "" : placeName(snapshot, group.where);
  return createPlan(db, { source: "analysis", title: groupTitle(group, place), summary: "", items: entries.map((e) => itemFrom(snapshot, e, action)) }, now);
}

function getPlanRow(db: Db, id: number): Plan {
  const plan = db.select().from(libraryPlans).where(eq(libraryPlans.id, id)).get();
  if (!plan) throw new PlanNotFoundError();
  return plan;
}

const iso = (ts: number | null) => (ts === null ? null : new Date(ts).toISOString());

function itemView(i: Item, names: Map<string, string>) {
  return {
    id: i.id,
    action: actionOf(i),
    where: i.playlistId ? { kind: "playlist" as const, id: i.playlistId, name: names.get(i.playlistId) ?? (i.evidence.playlistName as string | undefined) ?? "Playlist" } : { kind: "liked" as const },
    uri: i.uri,
    included: i.included,
    status: i.status,
    reason: i.reason ?? "",
    evidence: i.evidence,
  };
}

const playlistNames = (db: Db) => new Map(db.select({ id: ownedPlaylists.id, name: ownedPlaylists.name }).from(ownedPlaylists).all().map((p) => [p.id, p.name]));

function planSummary(db: Db, plan: Plan) {
  const rows = db.all<{ status: string; included: number; n: number }>(sql`select status, included, count(*) as n from cleanup_proposals where plan_id = ${plan.id} group by status, included`);
  const n = (status: string, included?: number) => rows.filter((r) => r.status === status && (included === undefined || r.included === included)).reduce((s, r) => s + r.n, 0);
  const running = db
    .select({ id: cleanupBatches.id })
    .from(cleanupBatches)
    .where(and(eq(cleanupBatches.planId, plan.id), eq(cleanupBatches.status, "running")))
    .get();
  return {
    id: plan.id,
    source: plan.source,
    ruleKind: plan.ruleKind,
    title: plan.title,
    summary: plan.summary,
    status: plan.status,
    counts: { open: n("open"), selected: n("open", 1), dismissed: n("dismissed"), applied: n("applied"), skipped: n("skipped") },
    runningBatchId: running?.id ?? null,
    createdAt: iso(plan.createdAt),
    updatedAt: iso(plan.updatedAt),
  };
}

export function listPlans(db: Db) {
  const plans = db.select().from(libraryPlans).orderBy(desc(libraryPlans.updatedAt), desc(libraryPlans.id)).all();
  return { items: plans.map((p) => planSummary(db, p)) };
}

export const ITEM_STATUSES = ["open", "dismissed", "applied", "skipped"] as const;

export function getPlan(db: Db, id: number, page: { status: (typeof ITEM_STATUSES)[number]; limit: number; offset: number }) {
  const plan = getPlanRow(db, id);
  const where = and(eq(cleanupProposals.planId, id), eq(cleanupProposals.status, page.status));
  const names = playlistNames(db);
  const items = db
    .select()
    .from(cleanupProposals)
    .where(where)
    .orderBy(sql`coalesce(${cleanupProposals.playlistId}, '')`, cleanupProposals.action, cleanupProposals.id)
    .limit(page.limit)
    .offset(page.offset)
    .all();
  const groups = db.all<{ action: PlanAction | null; kind: string; playlist_id: string | null; n: number; selected: number }>(sql`
    select action, kind, playlist_id, count(*) as n, sum(included) as selected from cleanup_proposals
    where plan_id = ${id} and status = ${page.status} group by action, kind, playlist_id order by coalesce(playlist_id, ''), action`);
  const merged = new Map<string, { action: PlanAction; where: ReturnType<typeof itemView>["where"]; items: number; selected: number }>();
  for (const g of groups) {
    const action = actionOf({ action: g.action, kind: g.kind as Item["kind"] });
    const key = `${action}:${g.playlist_id ?? ""}`;
    const prior = merged.get(key);
    const where = g.playlist_id ? { kind: "playlist" as const, id: g.playlist_id, name: names.get(g.playlist_id) ?? "Playlist" } : { kind: "liked" as const };
    merged.set(key, { action, where, items: (prior?.items ?? 0) + g.n, selected: (prior?.selected ?? 0) + g.selected });
  }
  return {
    ...planSummary(db, plan),
    groups: [...merged.values()],
    page: { status: page.status, total: db.select({ n: count() }).from(cleanupProposals).where(where).get()!.n, limit: page.limit, offset: page.offset },
    items: items.map((i) => itemView(i, names)),
  };
}

function openItems(db: Db, planId: number, ids: number[] | "all") {
  const rows = db
    .select()
    .from(cleanupProposals)
    .where(and(eq(cleanupProposals.planId, planId), eq(cleanupProposals.status, "open"), ids === "all" ? undefined : inArray(cleanupProposals.id, ids)))
    .all();
  if (ids !== "all") {
    const missing = ids.filter((id) => !rows.some((r) => r.id === id));
    if (missing.length) throw new PlanSelectionError("Some items are not open in this plan", missing);
  }
  return rows;
}

/** Ticks or unticks items, or switches take-out items between archive and remove. `ids: "all"` covers every open item. */
export function updateItems(db: Db, planId: number, change: { ids: number[] | "all"; included?: boolean; action?: "archive" | "remove" }, now: number) {
  const plan = getPlanRow(db, planId);
  if (plan.status !== "open") throw new PlanSelectionError("The plan is not open");
  const rows = openItems(db, planId, change.ids);
  const targets = change.action ? rows.filter((r) => TAKE_OUT.includes(actionOf(r))) : rows;
  if (change.action && change.ids !== "all" && targets.length !== rows.length)
    throw new PlanSelectionError("Only songs taken out can switch between archive and remove", rows.filter((r) => !targets.includes(r)).map((r) => r.id));
  const ids = targets.map((r) => r.id);
  if (ids.length)
    db.update(cleanupProposals)
      .set({ ...(change.included === undefined ? {} : { included: change.included }), ...(change.action ? { action: change.action } : {}), updatedAt: now })
      .where(inArray(cleanupProposals.id, ids))
      .run();
  return { updated: ids.length };
}

/** A rule plan stays open; dismissing it dismisses its open items (or the given ones). Another plan is dismissed whole. */
export function dismissPlan(db: Db, planId: number, ids: number[] | "all", now: number) {
  const plan = getPlanRow(db, planId);
  if (plan.source !== "rule" && ids === "all") {
    db.update(libraryPlans).set({ status: "dismissed", updatedAt: now }).where(eq(libraryPlans.id, planId)).run();
    return { dismissed: openItems(db, planId, "all").length };
  }
  const rows = openItems(db, planId, ids);
  if (rows.length)
    db.update(cleanupProposals)
      .set({ status: "dismissed", updatedAt: now })
      .where(inArray(
        cleanupProposals.id,
        rows.map((r) => r.id),
      ))
      .run();
  return { dismissed: rows.length };
}

export function restorePlan(db: Db, planId: number, ids: number[] | "all", now: number) {
  const plan = getPlanRow(db, planId);
  if (plan.status === "dismissed") {
    db.update(libraryPlans).set({ status: "open", updatedAt: now }).where(eq(libraryPlans.id, planId)).run();
    return { restored: 0 };
  }
  const restored = db
    .update(cleanupProposals)
    .set({ status: "open", updatedAt: now })
    .where(and(eq(cleanupProposals.planId, planId), eq(cleanupProposals.status, "dismissed"), ids === "all" ? undefined : inArray(cleanupProposals.id, ids)))
    .returning({ id: cleanupProposals.id })
    .all().length;
  return { restored };
}
