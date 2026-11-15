import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { getJobState } from "../../jobs/state";
import { SPOTIFY_SCOPES } from "../../spotify/auth";
import type { Env } from "../context";

const iso = (ts: number | null | undefined) => (ts ? new Date(ts).toISOString() : null);

/** What a first-run wizard needs for each step after sign-in. The steps before it (setup token, passkey) read `GET /api/auth/session`. */
export const onboardingRoutes = new Hono<Env>().get("/", (c) => {
  const { db, config, settings, spotifyAuth, services, passkeys } = c.var.deps;
  const current = settings.get();
  const source = (key: string) => {
    const entry = settings.entry(key)!;
    return { source: entry.source, locked: entry.source === "env" };
  };
  const auth = spotifyAuth.status();
  const plays = db.all<{ total: number; exported: number }>(sql`select count(*) as total, coalesce(sum(source = 'export'), 0) as exported from plays`)[0]!;
  const steps = {
    passkey: { required: true, done: passkeys.count() > 0, passkeys: passkeys.count() },
    spotifyApp: { required: true, done: Boolean(current.spotifyClientId), redirectUri: config.spotifyRedirectUri, ...source("spotifyClientId") },
    spotifyConnect: {
      required: true,
      done: auth.connected,
      userId: auth.userId,
      missingScopes: auth.connected ? SPOTIFY_SCOPES.filter((s) => !auth.scopes.includes(s)) : SPOTIFY_SCOPES,
    },
    locale: { required: true, done: settings.entry("timezone")!.source !== "default", timezone: current.timezone, ...source("timezone"), playsStored: plays.total },
    import: { required: true, done: plays.exported > 0, plays: plays.total, exportPlays: plays.exported, lastImportAt: iso(getJobState(db, "import")?.lastSuccessAt) },
    claude: { required: false, done: services.llm.configured, ...source("claudeApiKey") },
    discord: {
      required: false,
      done: current.discord !== null,
      interactionsUrl: `${config.publicBaseUrl}/api/discord/interactions`,
      commandsRegistrable: Boolean(current.discord?.botToken && current.discord.guildId),
    },
    mcp: { required: false, done: current.mcpToken !== undefined || current.mcpOAuth, url: `${config.publicBaseUrl}/mcp`, ...source("mcpToken") },
  };
  return c.json({
    complete: Object.values(steps).every((step) => !step.required || step.done),
    order: Object.keys(steps),
    steps,
    secretStorage: { available: settings.canStoreSecrets, envVar: "SECRETS_KEY" },
  });
});
