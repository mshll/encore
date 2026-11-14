import { desc, eq } from "drizzle-orm";
import { ask } from "../ask/service";
import type { Db } from "../db/client";
import { digests, picks, type PickState } from "../db/schema";
import { renderDigest, type DigestKind } from "../digest/service";
import type { FeatureContext } from "../llm/context";
import { generatePicks, PicksExistError, pickViews, weekOf, weekPicks } from "../picks/service";
import { setPickState } from "../picks/state";
import { createSet } from "../sets/service";

/**
 * Plain entry points for chat integrations (for example a Discord bot). They take the same
 * FeatureContext as the HTTP routes and throw the same typed errors (LlmBudgetExceededError, ...).
 */

export type SetSummary = {
  id: number;
  title: string;
  description: string;
  tracks: number;
  newTracks: number;
  lines: string[];
  reply: string | null;
};

export async function createSetFromText(ctx: FeatureContext, text: string): Promise<SetSummary> {
  const { set, reply } = await createSet(ctx, text);
  return {
    id: set.id,
    title: set.title,
    description: set.description,
    tracks: set.items.length,
    newTracks: set.items.filter((i) => i.kind === "new").length,
    lines: set.items.map((i) => `${i.position}. ${i.name} - ${i.artist}${i.kind === "new" ? " (new)" : ""}: ${i.reason}`),
    reply,
  };
}

export type PicksSummary = ReturnType<typeof weekPicks>;

/** This week's picks; generates them first when `generate` is set and none exist yet. */
export async function currentPicks(ctx: FeatureContext, options: { generate?: boolean } = {}): Promise<PicksSummary> {
  const week = weekOf(ctx.now(), ctx.config.timezone);
  const exists = ctx.db.select({ id: picks.id }).from(picks).where(eq(picks.week, week)).get();
  if (!exists && options.generate) {
    try {
      return await generatePicks(ctx);
    } catch (error) {
      if (!(error instanceof PicksExistError)) throw error;
    }
  }
  return weekPicks(ctx.db, week, ctx.now());
}

export function updatePickState(ctx: FeatureContext, pickId: number, state: PickState) {
  return pickViews(ctx.db, [setPickState(ctx.db, pickId, state, ctx.now())])[0]!;
}

export async function askText(ctx: FeatureContext, question: string, threadId: number | null = null): Promise<{ threadId: number; text: string }> {
  const { threadId: id, answer } = await ask(ctx, question, threadId);
  return { threadId: id, text: answer };
}

/** The newest stored digest of `kind` (any kind when omitted), rendered as one message, or null. */
export function latestDigest(db: Db, kind?: DigestKind) {
  const row = db
    .select({ id: digests.id })
    .from(digests)
    .where(kind ? eq(digests.kind, kind) : undefined)
    .orderBy(desc(digests.toDay), desc(digests.id))
    .limit(1)
    .get();
  return row ? renderDigest(db, row.id) : null;
}
