import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { livingPlaylists, livingRefreshes, type LivingTrack } from "../db/schema";
import { withArtwork } from "../library/artwork";
import { buildRule } from "./engine";
import { isLivingKind } from "./kinds";
import { replaceMerge } from "./merge";
import { patchRow, refreshLiving, requireLivingRow, WRITE_SCOPE, type LivingDeps, type RefreshOutcome } from "./refresh";
import { ruleSchema, type UserRule } from "./rules";
import { periodOf } from "./schedule";

export const ruleInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  about: z.string().trim().max(300).nullish(),
  rule: ruleSchema,
});
export type RuleInput = z.infer<typeof ruleInputSchema>;

export class BuiltinPlaylistError extends Error {
  constructor(readonly id: string) {
    super(`${id} is built in: its rule cannot be changed or deleted`);
  }
}

function requireRuleRow(db: Db, id: string, now: number) {
  if (isLivingKind(id)) throw new BuiltinPlaylistError(id);
  return requireLivingRow(db, id, now);
}

/** A new rule playlist, off: switching it on makes the Spotify playlist. */
export function createRulePlaylist(db: Db, input: RuleInput, now: number): string {
  const id = `rule-${randomBytes(5).toString("hex")}`;
  db.insert(livingPlaylists)
    .values({ kind: id, name: input.name, about: input.about ?? null, rule: input.rule, definedAt: now, frozen: false, enabled: false, updatedAt: now })
    .run();
  return id;
}

/**
 * Saves the new rule. A playlist that is on, not frozen and in Spotify is refreshed at once (with its name and description
 * when they changed); otherwise the next scheduled refresh uses the new rule.
 */
export async function updateRulePlaylist(deps: LivingDeps, id: string, input: RuleInput): Promise<RefreshOutcome | null> {
  const now = deps.now();
  const row = requireRuleRow(deps.db, id, now);
  const about = input.about ?? null;
  const renamed = row.name !== input.name || row.about !== about;
  patchRow(deps.db, id, { name: input.name, about, rule: input.rule, checkedAt: null }, now);
  const live = row.enabled && !row.frozen && row.removedAt === null && row.playlistId !== null;
  if (!live || !deps.spotify.connected() || !deps.spotify.hasScope(WRITE_SCOPE)) return null;
  return refreshLiving(deps, id, "manual", { details: renamed });
}

/** Forgets the rule and its refreshes. Its Spotify playlist stays in the owner's account as it is. */
export function deleteRulePlaylist(db: Db, id: string, now: number): { id: string; url: string } | null {
  const row = requireRuleRow(db, id, now);
  db.transaction((tx) => {
    tx.delete(livingRefreshes).where(eq(livingRefreshes.kind, id)).run();
    tx.delete(livingPlaylists).where(eq(livingPlaylists.kind, id)).run();
  });
  return row.playlistId && row.playlistUrl && row.removedAt === null ? { id: row.playlistId, url: row.playlistUrl } : null;
}

export function setLivingFrozen(db: Db, id: string, frozen: boolean, now: number): void {
  requireLivingRow(db, id, now);
  patchRow(db, id, { frozen }, now);
}

/** What a new playlist with this rule would hold now. Reads the database only: nothing is saved and Spotify is not called. */
export function previewRule(deps: LivingDeps, rule: UserRule): { count: number; songs: (LivingTrack & { artistImageUrl: string | null })[] } {
  const now = deps.now();
  const { timezone } = deps.settings.get();
  const songs = replaceMerge(buildRule(deps.db, rule, { now, timezone, seed: `preview:${periodOf(rule.schedule, now, timezone)}` }), rule.limit);
  return { count: songs.length, songs: withArtwork(deps.db, songs) };
}
