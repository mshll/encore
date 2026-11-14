import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { llmCalls, type LlmFeature } from "../db/schema";
import { localTime } from "../plays/localTime";
import type { CallCost } from "./cost";
import { LlmBudgetExceededError } from "./errors";

export type LedgerEntry = CallCost & {
  ts: number;
  feature: LlmFeature;
  ref: string | null;
  requestedModel: string;
  model: string;
  stopReason: string | null;
  durationMs: number;
};

export const monthOf = (ts: number, timezone: string) => localTime(ts, timezone).day.slice(0, 7);

const round = (usd: number) => Math.round(usd * 10_000) / 10_000;

export function recordCall(db: Db, timezone: string, entry: LedgerEntry) {
  db.insert(llmCalls)
    .values({ ...entry, month: monthOf(entry.ts, timezone) })
    .run();
}

export function monthSpend(db: Db, month: string): number {
  return db.select({ usd: sql<number>`coalesce(sum(${llmCalls.usd}), 0)` }).from(llmCalls).where(eq(llmCalls.month, month)).get()?.usd ?? 0;
}

export function assertWithinBudget(db: Db, timezone: string, capUsd: number, now: number) {
  const month = monthOf(now, timezone);
  const spent = monthSpend(db, month);
  if (spent >= capUsd) throw new LlmBudgetExceededError(month, spent, capUsd);
}

export function budgetStatus(db: Db, timezone: string, capUsd: number, now: number) {
  const month = monthOf(now, timezone);
  const spent = monthSpend(db, month);
  return { month, spentUsd: round(spent), capUsd, remainingUsd: round(Math.max(0, capUsd - spent)), exhausted: spent >= capUsd };
}

export function spendByFeature(db: Db, month: string) {
  return db
    .select({
      feature: llmCalls.feature,
      calls: sql<number>`count(*)`,
      usd: sql<number>`sum(${llmCalls.usd})`,
      inputTokens: sql<number>`sum(${llmCalls.inputTokens})`,
      outputTokens: sql<number>`sum(${llmCalls.outputTokens})`,
      cacheReadTokens: sql<number>`sum(${llmCalls.cacheReadTokens})`,
      cacheWriteTokens: sql<number>`sum(${llmCalls.cacheWriteTokens})`,
      webSearches: sql<number>`sum(${llmCalls.webSearches})`,
    })
    .from(llmCalls)
    .where(eq(llmCalls.month, month))
    .groupBy(llmCalls.feature)
    .orderBy(desc(sql`sum(${llmCalls.usd})`))
    .all()
    .map((r) => ({ ...r, usd: round(r.usd) }));
}

export function spendDetail(db: Db, month: string, limit: number) {
  const recent = db
    .select()
    .from(llmCalls)
    .where(eq(llmCalls.month, month))
    .orderBy(desc(llmCalls.ts), desc(llmCalls.id))
    .limit(limit)
    .all()
    .map(({ month: _month, ...r }) => ({ ...r, ts: new Date(r.ts).toISOString(), usd: round(r.usd) }));
  return { month, byFeature: spendByFeature(db, month), recent };
}
