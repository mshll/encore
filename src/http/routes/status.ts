import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { enrichmentProgress } from "../../ingest/live/enrich";
import { getJobState, type JobState } from "../../jobs/state";
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
  const { db, spotifyAuth, spotify, config } = c.var.deps;
  const auth = spotifyAuth.status();
  const gate = spotify.gate();
  const importState = getJobState(db, "import");
  const counts = db.all<{ plays: number; music: number; api: number }>(
    sql`select count(*) as plays, coalesce(sum(kind = 'track'), 0) as music, coalesce(sum(source = 'api'), 0) as api from plays`,
  )[0]!;
  return c.json({
    timezone: config.timezone,
    spotify: {
      connected: auth.connected,
      userId: auth.userId,
      scopes: auth.scopes,
      missingScopes: auth.connected ? SPOTIFY_SCOPES.filter((s) => !auth.scopes.includes(s)) : SPOTIFY_SCOPES,
      paused: gate && { reason: gate.reason, until: iso(gate.blockedUntil), since: iso(gate.at) },
    },
    poll: job(getJobState(db, "poll")),
    enrichment: { ...enrichmentProgress(db), ...job(getJobState(db, "enrich")), art: job(getJobState(db, "art")) },
    import: importState ? { lastImportAt: iso(importState.lastSuccessAt), result: importState.data } : null,
    tags: tagCoverage(db),
    plays: counts,
  });
});
