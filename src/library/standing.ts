import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { libraryPlans, libraryStanding, STANDING_CADENCES } from "../db/schema";
import type { FeatureContext } from "../llm/context";
import { LlmBudgetExceededError } from "../llm/errors";
import { startPlanConversation } from "./planner";

export class StandingNotFoundError extends Error {}

type Cadence = (typeof STANDING_CADENCES)[number];
type Row = typeof libraryStanding.$inferSelect;

const DAY_MS = 86_400_000;
const PERIOD_MS: Record<Cadence, number> = { weekly: 7 * DAY_MS, monthly: 30 * DAY_MS };
const iso = (ts: number | null) => (ts === null ? null : new Date(ts).toISOString());

export const nextRunAt = (row: Pick<Row, "enabled" | "lastRunAt" | "cadence">, now: number) =>
  row.enabled ? (row.lastRunAt === null ? now : row.lastRunAt + PERIOD_MS[row.cadence]) : null;

const view = (row: Row, now: number) => ({
  id: row.id,
  instruction: row.instruction,
  cadence: row.cadence,
  enabled: row.enabled,
  lastRunAt: iso(row.lastRunAt),
  nextRunAt: iso(nextRunAt(row, now)),
  lastPlanId: row.lastPlanId,
  lastError: row.lastError,
});

export function listStanding(db: Db, now: number) {
  return db.select().from(libraryStanding).orderBy(asc(libraryStanding.id)).all().map((r) => view(r, now));
}

export function createStanding(db: Db, input: { instruction: string; cadence: Cadence; enabled?: boolean }, now: number) {
  const row = db
    .insert(libraryStanding)
    .values({ instruction: input.instruction, cadence: input.cadence, enabled: input.enabled ?? false, createdAt: now, updatedAt: now })
    .returning()
    .get();
  return view(row, now);
}

export function updateStanding(db: Db, id: number, patch: { instruction?: string; cadence?: Cadence; enabled?: boolean }, now: number) {
  const row = db.update(libraryStanding).set({ ...patch, updatedAt: now }).where(eq(libraryStanding.id, id)).returning().get();
  if (!row) throw new StandingNotFoundError();
  return view(row, now);
}

export function deleteStanding(db: Db, id: number) {
  if (db.delete(libraryStanding).where(eq(libraryStanding.id, id)).returning().all().length === 0) throw new StandingNotFoundError();
}

/**
 * Runs every enabled instruction that is due, one Claude conversation each. The plan waits for the owner; this path
 * never applies anything. The previous plan from the same instruction is dismissed when still open, so they don't pile up.
 */
export async function runDueStanding(ctx: FeatureContext): Promise<Record<string, unknown>> {
  const { db } = ctx;
  const now = ctx.now();
  const due = db
    .select()
    .from(libraryStanding)
    .where(eq(libraryStanding.enabled, true))
    .all()
    .filter((r) => nextRunAt(r, now)! <= now);
  const made: number[] = [];
  for (const row of due) {
    db.update(libraryStanding).set({ lastRunAt: now }).where(eq(libraryStanding.id, row.id)).run();
    try {
      const turn = await startPlanConversation(ctx, row.instruction, undefined, { id: row.id });
      if (row.lastPlanId && turn.planId)
        db.update(libraryPlans)
          .set({ status: "dismissed", updatedAt: now })
          .where(and(eq(libraryPlans.id, row.lastPlanId), eq(libraryPlans.status, "open")))
          .run();
      db.update(libraryStanding)
        .set({ lastPlanId: turn.planId ?? row.lastPlanId, lastError: turn.planId ? null : turn.reply })
        .where(eq(libraryStanding.id, row.id))
        .run();
      if (turn.planId) made.push(turn.planId);
    } catch (error) {
      if (error instanceof LlmBudgetExceededError) {
        db.update(libraryStanding).set({ lastError: "The monthly Claude budget is spent" }).where(eq(libraryStanding.id, row.id)).run();
        return { skipped: "budget_exceeded", month: error.month, plans: made };
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[library] standing instruction ${row.id} failed: ${message}`);
      db.update(libraryStanding)
        .set({ lastError: message })
        .where(eq(libraryStanding.id, row.id))
        .run();
    }
  }
  return due.length ? { ran: due.length, plans: made } : { skipped: "not_due" };
}
