import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { enrichmentProgress } from "../../ingest/live/enrich";
import { getJobState, type JobState } from "../../jobs/state";
import { budgetStatus, spendByFeature } from "../../llm/ledger";
import { SPOTIFY_SCOPES } from "../../spotify/auth";
import { tagCoverage } from "../../tags/service";
import type { Env } from "../context";

const iso = (ts: number | null | undefined) => (ts ? new Date(ts).toISOString() : null);
const job = (state: JobState | undefined) => ({
  lastRunAt: iso(state?.lastRunAt),
  lastSuccessAt: iso(state?.lastSuccessAt),
  lastError: state?.lastError ?? null,
  lastResult: state?.data ?? null,
});

export const statusRoutes = new Hono<Env>().get("/", (c) => {
  const { db, spotifyAuth, spotify, config, services, now } = c.var.deps;
  const { llm } = services;
  const budget = budgetStatus(db, config.timezone, config.llm.monthlyBudgetUsd, now());
  const auth = spotifyAuth.status();
  const gate = spotify.gate();
  const importState = getJobState(db, "import");
  const counts = db.all<{ plays: number; music: number; api: number; live: number }>(
    sql`select count(*) as plays, coalesce(sum(kind = 'track'), 0) as music, coalesce(sum(source = 'api'), 0) as api, coalesce(sum(source = 'live'), 0) as live from plays`,
  )[0]!;
  return c.json({
    timezone: config.timezone,
    spotify: {
      connected: auth.connected,
      userId: auth.userId,
      scopes: auth.scopes,
      missingScopes: auth.connected ? SPOTIFY_SCOPES.filter((s) => !auth.scopes.includes(s)) : SPOTIFY_SCOPES,
      paused: gate && { reason: gate.reason, until: iso(gate.blockedUntil), since: iso(gate.at) },
      pacing: { minIntervalMs: config.spotifyIntervalMs, queued: spotify.pacer.pending(), calls: spotify.pacer.calls },
    },
    poll: job(getJobState(db, "poll")),
    enrichment: { ...enrichmentProgress(db), ...job(getJobState(db, "enrich")), art: job(getJobState(db, "art")) },
    import: importState ? { lastImportAt: iso(importState.lastSuccessAt), result: importState.data } : null,
    tags: tagCoverage(db),
    live: { watch: job(getJobState(db, "watch")), radar: job(getJobState(db, "radar")), library: job(getJobState(db, "library")) },
    plays: counts,
    llm: {
      configured: llm.configured,
      model: llm.model,
      month: budget.month,
      spentUsd: budget.spentUsd,
      capUsd: budget.capUsd,
      remainingUsd: budget.remainingUsd,
      exhausted: budget.exhausted,
      byFeature: spendByFeature(db, budget.month).map((f) => ({ feature: f.feature, calls: f.calls, usd: f.usd })),
      jobs: { picks: job(getJobState(db, "picks")), digest: job(getJobState(db, "digest")), outcomes: job(getJobState(db, "outcomes")) },
    },
  });
});
