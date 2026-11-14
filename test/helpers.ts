import { Passkeys } from "../src/auth/passkeys";
import { loadConfig, type Config } from "../src/config";
import { DiscordHost } from "../src/discord";
import { createApp } from "../src/http/app";
import { createJobs } from "../src/jobs/definitions";
import { createServices } from "../src/services";
import { SettingsStore } from "../src/settings/store";
import { SpotifyAuth } from "../src/spotify/auth";
import type { LlmKeyCheck, LlmTransport } from "../src/llm/client";
import { SpotifyClient } from "../src/spotify/client";
import { openDb, type Db } from "../src/db/client";
import { spotifyAuth as spotifyAuthTable } from "../src/db/schema";
import { insertPlays, upsertTracks, type PlayInput, type TrackInput } from "../src/plays/store";

export const TZ = "Asia/Kuwait";

export const testConfig = (env: Record<string, string> = {}) =>
  loadConfig({
    SPOTIFY_CLIENT_ID: "test-client",
    TIMEZONE: TZ,
    PUBLIC_BASE_URL: "http://localhost:8888",
    SETUP_TOKEN: "setup-token-setup-token-123",
    ADMIN_TOKEN: "admin-token-admin-token-123",
    JOBS_ENABLED: "false",
    SPOTIFY_MIN_INTERVAL_MS: "0",
    ...env,
  });

export const testDb = () => openDb(":memory:");

export const testSettings = (db: Db, config: Config, now?: () => number) => new SettingsStore(db, config, now);

export const uri = (id: string) => `spotify:track:${id.padStart(22, "0")}`;

export function track(id: string, name: string, artist: string, album: string | null, extra: Partial<TrackInput> = {}): TrackInput {
  return { uri: uri(id), name, artist, album, ...extra };
}

let counter = 0;

export function play(ts: string, trackUri: string, msPlayed: number | null, extra: Partial<PlayInput> = {}): PlayInput {
  const source = extra.source ?? (msPlayed === null ? "api" : "export");
  return {
    dedupeKey: `test:${++counter}`,
    ts: Date.parse(ts),
    kind: "track",
    trackUri,
    msPlayed,
    skipped: source === "api" ? null : false,
    shuffle: source === "api" ? null : false,
    reasonStart: source === "api" ? null : "trackdone",
    reasonEnd: source === "api" ? null : "trackdone",
    device: source === "api" ? "unknown" : "ios",
    connCountry: source === "api" ? null : "KW",
    source,
    ...extra,
  };
}

export function seed(db: Db, tracks: TrackInput[], plays: PlayInput[]) {
  upsertTracks(db, tracks);
  insertPlays(db, plays, TZ);
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export type TestAppOptions = { llmKeyCheck?: LlmKeyCheck };

export function testApp(env: Record<string, string> = {}, fetchFn: typeof fetch = fetch, transport: LlmTransport | null = null, options: TestAppOptions = {}) {
  const db = testDb();
  const config = testConfig(env);
  const settings = testSettings(db, config);
  const spotifyAuth = new SpotifyAuth(db, config, settings, fetchFn);
  const spotify = new SpotifyClient(db, spotifyAuth, settings, fetchFn);
  const services = createServices(db, config, settings, spotify, { llmTransport: transport, llmKeyCheck: options.llmKeyCheck });
  const jobs = createJobs(db, settings, spotifyAuth, spotify, services);
  const llm = services.llm;
  const discord = new DiscordHost(settings, { db, config, settings, services, now: Date.now }, fetchFn);
  const app = createApp({ db, config, settings, passkeys: new Passkeys(db, config), spotifyAuth, spotify, jobs, services, discord, now: Date.now });
  const request = (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const { json, ...rest } = init;
    return app.request(path, json === undefined ? rest : { method: "POST", ...rest, body: JSON.stringify(json), headers: { "content-type": "application/json", ...rest.headers } });
  };
  return { db, config, settings, app, request, services, spotify, spotifyAuth, jobs, llm, discord };
}

export type FetchCall = { url: string; method: string; body: unknown };

export function routeFetch(routes: (call: FetchCall) => Response | Promise<Response> | undefined) {
  const calls: FetchCall[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const res = await routes(call);
    if (!res) throw new Error(`Unexpected fetch ${call.method} ${call.url}`);
    return res;
  }) as typeof fetch;
  return { fn, calls };
}

export function connectSpotify(db: Db, userId: string | null = "owner") {
  db.insert(spotifyAuthTable)
    .values({ id: 1, accessToken: "access", refreshToken: "refresh", expiresAt: Date.now() + 3_600_000, scope: "", spotifyUserId: userId, clientId: "test-client", updatedAt: 0 })
    .run();
}

export const noContent = () => new Response(null, { status: 204 });
