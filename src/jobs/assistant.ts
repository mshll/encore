import { eq } from "drizzle-orm";
import { picks } from "../db/schema";
import { isDigestDue, generateDigest, digestPeriod, type DigestKind } from "../digest/service";
import type { FeatureContext } from "../llm/context";
import { LlmBudgetExceededError } from "../llm/errors";
import { refreshPickLibraryState, refreshPickOutcomes } from "../picks/outcomes";
import { generatePicks, weekOf } from "../picks/service";
import { localTime } from "../plays/localTime";
import { refreshSetOutcomes } from "../sets/outcomes";
import type { SpotifyAuth } from "../spotify/auth";
import { SpotifyApiError, SpotifyBlockedError } from "../spotify/errors";
import type { Job } from "./scheduler";
import { getJobState, setJobState } from "./state";

const HOUR_MS = 3_600_000;
const MAX_ATTEMPTS_PER_PERIOD = 2;
const LIBRARY_CHECK_EVERY_MS = 24 * HOUR_MS;

export type AssistantJobs = { picks: Job; digest: Job; outcomes: Job };

export function isPicksDue(ctx: FeatureContext, now: number): boolean {
  const { db, config } = ctx;
  const t = localTime(now, config.timezone);
  const slot = config.llm.picksSlot;
  const reached = t.weekday > slot.weekday || (t.weekday === slot.weekday && t.hour >= slot.hour);
  return reached && !db.select({ id: picks.id }).from(picks).where(eq(picks.week, weekOf(now, config.timezone))).get();
}

/** Allows at most two attempts per period so a run that keeps failing doesn't spend every hour. */
function claimAttempt(ctx: FeatureContext, name: string, period: string): boolean {
  const data = getJobState(ctx.db, name)?.data as { period: string; attempts: number } | undefined;
  const attempts = data?.period === period ? data.attempts : 0;
  if (attempts >= MAX_ATTEMPTS_PER_PERIOD) return false;
  setJobState(ctx.db, name, { data: { period, attempts: attempts + 1 } });
  return true;
}

async function guarded(run: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof LlmBudgetExceededError) return { skipped: "budget_exceeded", month: error.month };
    throw error;
  }
}

export function createAssistantJobs(ctx: FeatureContext, spotifyAuth: SpotifyAuth): AssistantJobs {
  const { db, config, llm, spotify } = ctx;
  return {
    picks: {
      name: "picks",
      intervalMs: HOUR_MS,
      run: () =>
        guarded(async () => {
          if (!llm.configured) return { skipped: "llm_not_configured" };
          if (!spotifyAuth.status().connected) return { skipped: "spotify_not_connected" };
          const now = ctx.now();
          if (!isPicksDue(ctx, now)) return { skipped: "not_due" };
          const week = weekOf(now, config.timezone);
          if (!claimAttempt(ctx, "picks_attempts", week)) return { skipped: "attempts_exhausted", week };
          const result = await generatePicks(ctx);
          return { week: result.week, picks: result.picks.length };
        }),
    },
    digest: {
      name: "digest",
      intervalMs: HOUR_MS,
      run: () =>
        guarded(async () => {
          if (!llm.configured) return { skipped: "llm_not_configured" };
          const now = ctx.now();
          const today = localTime(now, config.timezone).day;
          const generated: string[] = [];
          for (const kind of ["weekly", "monthly"] as DigestKind[]) {
            if (!isDigestDue(db, kind, config.timezone, config.llm.digestSlot, now)) continue;
            const key = digestPeriod(kind, today).key;
            if (!claimAttempt(ctx, `digest_${kind}_attempts`, key)) continue;
            await generateDigest(ctx, kind);
            generated.push(`${kind}:${key}`);
          }
          return generated.length ? { generated } : { skipped: "not_due" };
        }),
    },
    outcomes: {
      name: "outcomes",
      intervalMs: HOUR_MS,
      run: async () => {
        const result: Record<string, unknown> = { ...refreshSetOutcomes(db), ...refreshPickOutcomes(db) };
        const now = ctx.now();
        const lastCheck = (getJobState(db, "pick_library_check")?.lastSuccessAt ?? 0) as number;
        if (spotifyAuth.status().connected && now - lastCheck >= LIBRARY_CHECK_EVERY_MS) {
          try {
            result.library = await refreshPickLibraryState(db, spotify, now);
            setJobState(db, "pick_library_check", { lastSuccessAt: now });
          } catch (error) {
            if (!(error instanceof SpotifyBlockedError || error instanceof SpotifyApiError)) throw error;
            result.library = { error: error.message };
          }
        }
        return result;
      },
    },
  };
}
