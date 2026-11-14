import { describe, expect, test } from "bun:test";
import { createSession } from "../src/auth/sessions";
import { passkeys } from "../src/db/schema";
import { LlmKeyRejectedError, type LlmKeyCheck } from "../src/llm/client";
import type { SettingFieldView, SettingsView } from "../src/settings/view";
import { connectSpotify, jsonResponse, play, routeFetch, seed, testApp, track, uri } from "./helpers";

const SECRETS_KEY = "s".repeat(40);
const CLAUDE_KEY = "sk-ant-api03-secret-value-WXYZ";
const MCP_TOKEN = "mcp-token-from-env-0123456789";
const DISCORD = { DISCORD_APPLICATION_ID: "123", DISCORD_PUBLIC_KEY: "a".repeat(64), DISCORD_OWNER_ID: "42" };

type Options = { env?: Record<string, string>; fetchFn?: typeof fetch; llmKeyCheck?: LlmKeyCheck };

function signedIn({ env = {}, fetchFn = fetch, llmKeyCheck }: Options = {}) {
  const app = testApp({ SPOTIFY_CLIENT_ID: "", TIMEZONE: "", SECRETS_KEY, ...env }, fetchFn, null, { llmKeyCheck });
  const cookie = `encore_session=${createSession(app.db)}`;
  const get = (path: string) => app.request(path, { headers: { cookie } });
  const send = (method: string, path: string, json: unknown) =>
    app.app.request(path, { method, body: JSON.stringify(json), headers: { cookie, "content-type": "application/json" } });
  return { ...app, get, send };
}

const field = (view: SettingsView, key: string): SettingFieldView => view.groups.flatMap((g) => g.fields).find((f) => f.key === key)!;

describe("GET /api/settings", () => {
  test("needs a session", async () => {
    const { request } = testApp();

    expect((await request("/api/settings")).status).toBe(401);
  });

  test("groups fields with value, source, lock and validation metadata", async () => {
    const { get } = signedIn({ env: { HOME_COUNTRY: "KW" } });

    const view = (await (await get("/api/settings")).json()) as SettingsView;

    expect(view.groups.map((g) => g.id)).toEqual(["spotify", "locale", "claude", "picks", "digest", "dj", "discord", "mcp", "access", "jobs"]);
    expect(field(view, "homeCountry")).toMatchObject({ value: "KW", source: "env", locked: true, env: "HOME_COUNTRY" });
    expect(field(view, "pollIntervalSeconds")).toMatchObject({ value: 300, default: 300, source: "default", locked: false, min: 60, unit: "seconds", type: "integer" });
    expect(field(view, "claudeModel").options).toContain("claude-opus-5-5");
    expect(field(view, "timezone").options).toContain("Asia/Kuwait");
  });

  test("never returns a secret, from env or from the store; only set, source and the last four characters", async () => {
    const { get, send } = signedIn({ env: { MCP_TOKEN } });
    await send("PATCH", "/api/settings", { claudeApiKey: CLAUDE_KEY });

    const res = await get("/api/settings");
    const text = await res.clone().text();
    const view = (await res.json()) as SettingsView;

    expect(text).not.toContain(CLAUDE_KEY);
    expect(text).not.toContain(MCP_TOKEN);
    expect(field(view, "claudeApiKey")).toMatchObject({ secret: true, value: null, default: null, set: true, source: "db", hint: "WXYZ" });
    expect(field(view, "mcpToken")).toMatchObject({ value: null, set: true, source: "env", locked: true, hint: "6789" });
  });
});

describe("PATCH /api/settings", () => {
  test("saves values and returns the new state with the changed keys", async () => {
    const { send, settings } = signedIn();

    const res = await send("PATCH", "/api/settings", { picksHour: 8, weekendDays: [6, 7] });
    const body = (await res.json()) as SettingsView & { changed: string[]; effects: unknown[] };

    expect(res.status).toBe(200);
    expect(body.changed).toEqual(["picksHour", "weekendDays"]);
    expect(field(body, "picksHour")).toMatchObject({ value: 8, source: "db" });
    expect(settings.get().llm.picksSlot.hour).toBe(8);
  });

  test("rejects invalid, unknown and env-locked values with one issue each and saves none of the patch", async () => {
    const { send, settings } = signedIn({ env: { HOME_COUNTRY: "KW" } });

    const res = await send("PATCH", "/api/settings", { picksHour: 8, digestHour: 30, homeCountry: "GB", nope: true });
    const body = (await res.json()) as { error: { code: string; details: { key: string; reason: string }[] } };

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("invalid_settings");
    expect(body.error.details.map((d) => [d.key, d.reason])).toEqual([
      ["digestHour", "invalid"],
      ["homeCountry", "locked"],
      ["nope", "unknown"],
    ]);
    expect(settings.entry("picksHour")!.source).toBe("default");
  });

  test("without SECRETS_KEY, secrets cannot be stored and the API says so", async () => {
    const { send, get } = signedIn({ env: { SECRETS_KEY: "" } });

    const res = await send("PATCH", "/api/settings", { claudeApiKey: CLAUDE_KEY });
    const view = (await (await get("/api/settings")).json()) as SettingsView;

    expect(((await res.json()) as { error: { details: { reason: string }[] } }).error.details[0]!.reason).toBe("secrets_key_missing");
    expect(view.secretStorage).toEqual({ available: false, envVar: "SECRETS_KEY" });
  });

  test("a new Spotify client id reports the disconnect; a timezone change reports that it applies forward only", async () => {
    const { send, db } = signedIn();
    await send("PATCH", "/api/settings", { spotifyClientId: "test-client" });
    connectSpotify(db);

    const res = await send("PATCH", "/api/settings", { spotifyClientId: "new-client", timezone: "Asia/Kuwait" });

    expect(((await res.json()) as { effects: unknown[] }).effects).toEqual([{ type: "spotify_disconnected" }, { type: "timezone_forward_only" }]);
  });

  test("setting the Discord bot token and guild registers the commands again", async () => {
    const { fn, calls } = routeFetch((call) => (call.url.includes("/guilds/9/commands") ? jsonResponse([{ id: "1", name: "now" }, { id: "2", name: "top" }]) : undefined));
    const { send } = signedIn({ env: DISCORD, fetchFn: fn });

    const res = await send("PATCH", "/api/settings", { discordBotToken: "bot-token", discordGuildId: "9" });

    expect(((await res.json()) as { effects: unknown[] }).effects).toEqual([{ type: "discord_commands_registered", count: 2 }]);
    expect(calls.map((c) => c.method)).toEqual(["PUT"]);
  });
});

describe("POST /api/settings/adopt-env", () => {
  type Adopted = SettingsView & { adopted: string[]; replaced: string[]; skipped: { key: string; reason: string }[] };

  test("needs a session", async () => {
    const { request } = testApp();

    expect((await request("/api/settings/adopt-env", { method: "POST" })).status).toBe(401);
  });

  test("rejects a cross-origin request", async () => {
    const { app, db, get } = signedIn({ env: { HOME_COUNTRY: "KW" } });
    const cookie = `encore_session=${createSession(db)}`;

    const res = await app.request("/api/settings/adopt-env", { method: "POST", headers: { cookie, origin: "https://evil.example" } });
    const view = (await (await get("/api/settings")).json()) as SettingsView;

    expect(res.status).toBe(403);
    expect(field(view, "homeCountry").stored).toBe(false);
  });

  test("stores env values without changing the source, never echoes a secret, and GET reports them as stored", async () => {
    const { send, get } = signedIn({ env: { HOME_COUNTRY: "KW", MCP_TOKEN } });

    const res = await send("POST", "/api/settings/adopt-env", {});
    const text = await res.clone().text();
    const body = (await res.json()) as Adopted;
    const view = (await (await get("/api/settings")).json()) as SettingsView;

    expect(res.status).toBe(200);
    expect(text).not.toContain(MCP_TOKEN);
    expect(body.adopted).toEqual(expect.arrayContaining(["homeCountry", "mcpToken"]));
    expect(body.skipped).toEqual([]);
    expect(field(view, "homeCountry")).toMatchObject({ value: "KW", source: "env", locked: true, stored: true });
    expect(field(view, "mcpToken")).toMatchObject({ value: null, source: "env", locked: true, stored: true });
    expect(field(view, "picksHour").stored).toBe(false);
  });

  test("without SECRETS_KEY, reports env secrets as skipped", async () => {
    const { send } = signedIn({ env: { SECRETS_KEY: "", MCP_TOKEN } });

    const body = (await (await send("POST", "/api/settings/adopt-env", {})).json()) as Adopted;

    expect(body.skipped).toEqual([
      { key: "mcpToken", reason: "secrets_key_missing" },
      { key: "adminToken", reason: "secrets_key_missing" },
    ]);
    expect(field(body, "mcpToken").stored).toBe(false);
  });
});

describe("settings actions", () => {
  test("verifies a candidate Claude key without storing or echoing it", async () => {
    const seen: string[] = [];
    const check: LlmKeyCheck = async (apiKey) => {
      seen.push(apiKey);
      if (apiKey !== CLAUDE_KEY) throw new LlmKeyRejectedError("The API key was rejected");
    };
    const { send, settings } = signedIn({ llmKeyCheck: check });

    const good = await send("POST", "/api/settings/claude/verify", { apiKey: CLAUDE_KEY });
    const bad = await send("POST", "/api/settings/claude/verify", { apiKey: "sk-wrong" });

    expect(await good.json()).toEqual({ valid: true, model: "claude-opus-5-5" });
    expect(await bad.json()).toEqual({ valid: false, model: "claude-opus-5-5", message: "The API key was rejected" });
    expect(seen).toEqual([CLAUDE_KEY, "sk-wrong"]);
    expect(settings.get().llm.apiKey).toBeUndefined();
  });

  test("verifying with no key given and none set is a precondition error", async () => {
    const { send } = signedIn();

    const res = await send("POST", "/api/settings/claude/verify", {});

    expect([res.status, ((await res.json()) as { error: { code: string } }).error.code]).toEqual([409, "llm_not_configured"]);
  });

  test("registering Discord commands needs the bot token and guild id", async () => {
    const { send } = signedIn({ env: DISCORD });

    const res = await send("POST", "/api/settings/discord/register", {});

    expect([res.status, ((await res.json()) as { error: { code: string } }).error.code]).toEqual([409, "discord_registration_unavailable"]);
  });
});

describe("onboarding", () => {
  type Onboarding = { complete: boolean; order: string[]; steps: Record<string, { done: boolean; required: boolean } & Record<string, unknown>> };
  const done = (o: Onboarding) => Object.fromEntries(o.order.map((id) => [id, o.steps[id]!.done]));

  test("each step turns done as the owner completes it, and onboarding completes with the required ones", async () => {
    const { get, send, db } = signedIn();
    db.insert(passkeys).values({ id: "pk", publicKey: "AA", counter: 0, createdAt: 0 }).run();
    const read = async () => (await (await get("/api/onboarding")).json()) as Onboarding;

    const fresh = await read();
    await send("PATCH", "/api/settings", { spotifyClientId: "test-client", timezone: "Asia/Kuwait" });
    const configured = await read();
    connectSpotify(db);
    seed(db, [track("a", "A", "Artist", "Album")], [play("2026-01-01T10:00:00Z", uri("a"), 200_000)]);
    const finished = await read();

    expect(fresh.order).toEqual(["passkey", "spotifyApp", "spotifyConnect", "locale", "import", "claude", "discord", "mcp"]);
    expect(done(fresh)).toEqual({ passkey: true, spotifyApp: false, spotifyConnect: false, locale: false, import: false, claude: false, discord: false, mcp: false });
    expect(fresh.steps.spotifyApp).toMatchObject({ redirectUri: "http://localhost:8888/callback", source: "default", locked: false });
    expect(done(configured)).toMatchObject({ spotifyApp: true, locale: true, spotifyConnect: false });
    expect([finished.complete, finished.steps.import]).toEqual([true, expect.objectContaining({ done: true, exportPlays: 1 })]);
  });
});

describe("first-run auth", () => {
  test("the session route says whether a setup token is configured", async () => {
    const withToken = testApp();
    const without = testApp({ SETUP_TOKEN: "" });

    const states = await Promise.all([withToken, without].map(async (app) => (await (await app.request("/api/auth/session")).json()) as { setupTokenConfigured: boolean }));

    expect(states.map((s) => s.setupTokenConfigured)).toEqual([true, false]);
  });

  test("checks a setup token before the passkey step, and only while no passkey exists", async () => {
    const { request, db, config } = testApp();

    const wrong = await request("/api/auth/setup/verify", { json: { setupToken: "nope" } });
    const right = await request("/api/auth/setup/verify", { json: { setupToken: config.setupToken } });
    db.insert(passkeys).values({ id: "pk", publicKey: "AA", counter: 0, createdAt: 0 }).run();
    const after = await request("/api/auth/setup/verify", { json: { setupToken: config.setupToken } });

    expect([wrong.status, right.status, after.status]).toEqual([403, 200, 409]);
    expect(await right.json()).toEqual({ valid: true });
  });
});
