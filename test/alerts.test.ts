import { describe, expect, test } from "bun:test";
import { currentIncidents, diffIncidents, type AlertSnapshot } from "../src/alerts/incidents";
import { AlertMonitor, NoAlertChannelsError } from "../src/alerts/monitor";
import { BACKUP_JOB } from "../src/backup/service";
import { DiscordHost } from "../src/discord";
import { setJobState } from "../src/jobs/state";
import { secretValues } from "../src/settings/redact";
import { SpotifyAuth } from "../src/spotify/auth";
import type { SpotifyGate } from "../src/spotify/client";
import { connectSpotify, jsonResponse, routeFetch, testConfig, testDb, testSettings, type FetchCall } from "./helpers";

const NTFY_TOKEN = "tk_ntfy-token-0123456789abcdef";
const TOPIC = "encore-alerts-topic-0123";
const WEBHOOK = "https://discord.com/api/webhooks/123/webhook-token-0123456789";
const HOUR = 3_600_000;
const START = Date.parse("2026-11-18T09:00:00Z");

const snapshot = (patch: Partial<AlertSnapshot> = {}): AlertSnapshot => ({
  now: START,
  timezone: "UTC",
  spotifyConnected: true,
  pollLastSuccessAt: START,
  pollLastError: null,
  pollStaleMs: 2 * HOUR,
  authError: null,
  quotaLocks: [],
  backupError: null,
  claude: { configured: true, exhausted: false, month: "2026-11", spentUsd: 0, capUsd: 100 },
  ...patch,
});

function monitor(env: Record<string, string> = {}, answer: (call: FetchCall) => Response = () => new Response("ok")) {
  const db = testDb();
  const config = testConfig({ SECRETS_KEY: "k".repeat(40), ALERT_NTFY_TOPIC: TOPIC, ALERT_NTFY_TOKEN: NTFY_TOKEN, ...env });
  const settings = testSettings(db, config);
  const { fn, calls } = routeFetch(answer);
  let clock = START;
  let gates: SpotifyGate[] = [];
  const spotifyAuth = new SpotifyAuth(db, config, settings, fn, () => clock);
  const alerts = new AlertMonitor({
    db,
    settings,
    secrets: () => secretValues(settings),
    spotifyAuth,
    spotify: { gates: () => gates.filter((g) => g.blockedUntil > clock) },
    discord: new DiscordHost(settings, { db, config, settings, services: undefined as never, now: () => clock }, fn),
    pollEnabled: true,
    fetchFn: fn,
    now: () => clock,
  });
  const ntfyCalls = () => calls.filter((c) => c.url.startsWith("https://ntfy.sh/"));
  return {
    db,
    alerts,
    calls,
    ntfyCalls,
    spotifyAuth,
    advance: (ms: number) => (clock += ms),
    setGates: (next: SpotifyGate[]) => (gates = next),
  };
}

describe("incidents", () => {
  test("a poll is stale only past the threshold while Spotify is connected", () => {
    const late = START - 3 * HOUR;

    const keys = [snapshot({ pollLastSuccessAt: late }), snapshot({ pollLastSuccessAt: START - HOUR }), snapshot({ pollLastSuccessAt: late, spotifyConnected: false })].map((s) =>
      currentIncidents(s).map((i) => i.key),
    );

    expect(keys).toEqual([["poll_stale"], [], []]);
  });

  test("diff opens new incidents and resolves cleared ones", () => {
    const open = { backup: { title: "Backup failed", recovery: "Backups work again.", since: 0 }, claude_cap: { title: "Cap", recovery: "ok", since: 0 } };

    const diff = diffIncidents(open, currentIncidents(snapshot({ backupError: "disk full", quotaLocks: [{ route: "GET /tracks/:id", until: START + HOUR }] })));

    expect({ opened: diff.opened.map((i) => i.key), resolved: diff.resolved.map((i) => i.key) }).toEqual({ opened: ["quota:GET /tracks/:id"], resolved: ["claude_cap"] });
  });
});

describe("alert monitor", () => {
  test("alerts once per incident and once on recovery", async () => {
    const { db, alerts, ntfyCalls } = monitor();
    setJobState(db, BACKUP_JOB, { lastError: "Could not write the snapshot: disk full" });

    await alerts.check();
    await alerts.check();
    setJobState(db, BACKUP_JOB, { lastError: null });
    await alerts.check();
    await alerts.check();

    expect(ntfyCalls().map((c) => c.body)).toEqual(["Could not write the snapshot: disk full", "Backups work again."]);
  });

  test("an unsent alert is tried again on the next check", async () => {
    let up = false;
    const { db, alerts, ntfyCalls } = monitor({}, () => new Response(null, { status: up ? 200 : 503 }));
    setJobState(db, BACKUP_JOB, { lastError: "boom" });

    const first = await alerts.check().catch((e: unknown) => (e as Error).message);
    up = true;
    await alerts.check();

    expect({ first, sent: ntfyCalls().length, open: alerts.open().map((i) => i.key) }).toEqual({ first: "Some alerts were not sent: ntfy answered 503", sent: 2, open: ["backup"] });
  });

  test("a quota lock alerts and recovers when the lock ends", async () => {
    const { alerts, ntfyCalls, setGates, advance } = monitor();
    setGates([{ route: "GET /artists/:id", reason: "quota_exceeded", blockedUntil: START + HOUR, at: START, clientId: "test-client" }]);

    await alerts.check();
    advance(2 * HOUR);
    await alerts.check();

    expect(ntfyCalls().map((c) => c.body)).toEqual([expect.stringContaining("Calls to GET /artists/:id are paused until"), "Calls to GET /artists/:id run again."]);
  });

  test("a revoked Spotify sign-in alerts and recovers on the next grant", async () => {
    let revoked = true;
    const { db, alerts, ntfyCalls, spotifyAuth } = monitor({}, (call) =>
      call.url.includes("accounts.spotify.com")
        ? revoked
          ? jsonResponse({ error: "invalid_grant", error_description: "Refresh token revoked" }, 400)
          : jsonResponse({ access_token: "a", refresh_token: "r", expires_in: 3600 })
        : new Response("ok"),
    );
    connectSpotify(db);

    await spotifyAuth.accessToken(true).catch(() => undefined);
    await alerts.check();
    revoked = false;
    connectSpotify(db);
    await spotifyAuth.accessToken(true);
    await alerts.check();

    expect(ntfyCalls().map((c) => c.body)).toEqual(["Spotify no longer accepts encore's sign-in. Connect Spotify again in Settings.", "Spotify is signed in again."]);
  });

  test("the Claude cap alerts when a key is set and the month is spent", async () => {
    const { alerts, ntfyCalls } = monitor({ ANTHROPIC_API_KEY: "sk-ant-key-0123456789", MONTHLY_BUDGET_USD: "0" });

    await alerts.check();

    expect(ntfyCalls()[0]?.body).toBe("$0.00 of $0.00 spent in 2026-11. AI features pause until next month or a higher budget.");
  });

  test("a secret in an error never reaches the alert text", async () => {
    const { db, alerts, ntfyCalls } = monitor();
    setJobState(db, BACKUP_JOB, { lastError: `upload failed with ${NTFY_TOKEN}` });

    await alerts.check();

    expect(ntfyCalls()[0]?.body).toBe("upload failed with [redacted]");
  });

  test("Send test reaches every channel and reports each", async () => {
    const { alerts, calls } = monitor({ ALERT_DISCORD_WEBHOOK_URL: WEBHOOK }, (call) => new Response(null, { status: call.url === WEBHOOK ? 404 : 200 }));

    const results = await alerts.sendTest();

    expect({ results, urls: calls.map((c) => c.url) }).toEqual({
      results: [
        { channel: "ntfy", ok: true },
        { channel: "discord_webhook", ok: false, error: "Discord webhook answered 404" },
      ],
      urls: [`https://ntfy.sh/${TOPIC}`, WEBHOOK],
    });
  });

  test("with no channel, checks skip and a test is refused", async () => {
    const { alerts } = monitor({ ALERT_NTFY_TOPIC: "" });

    const result = { check: await alerts.check(), test: await alerts.sendTest().catch((e: unknown) => e instanceof NoAlertChannelsError) };

    expect(result).toEqual({ check: { skipped: "no_channels" }, test: true });
  });
});
