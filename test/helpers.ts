import { Passkeys } from "../src/auth/passkeys";
import { loadConfig } from "../src/config";
import { createApp } from "../src/http/app";
import { createJobs } from "../src/jobs/definitions";
import { createServices } from "../src/services";
import { SpotifyAuth } from "../src/spotify/auth";
import type { LlmTransport } from "../src/llm/client";
import { SpotifyClient } from "../src/spotify/client";
import { openDb, type Db } from "../src/db/client";
import { spotifyAuth as spotifyAuthTable } from "../src/db/schema";
import { insertPlays, upsertTracks, type PlayInput, type TrackInput } from "../src/plays/store";

export const TZ = "Asia/Kuwait";

export const testConfig = (env: Record<string, string> = {}) =>
  loadConfig({
    SPOTIFY_CLIENT_ID: "test-client",
    PUBLIC_BASE_URL: "http://localhost:8888",
    SETUP_TOKEN: "setup-token-setup-token-123",
    ADMIN_TOKEN: "admin-token-admin-token-123",
    JOBS_ENABLED: "false",
    ...env,
  });

export const testDb = () => openDb(":memory:");

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

export function testApp(env: Record<string, string> = {}, fetchFn: typeof fetch = fetch, transport: LlmTransport | null = null) {
  const db = testDb();
  const config = testConfig(env);
  const spotifyAuth = new SpotifyAuth(db, config, fetchFn);
  const spotify = new SpotifyClient(db, spotifyAuth, config, fetchFn);
  const services = createServices(db, config, spotify, Date.now, transport);
  const jobs = createJobs(db, config, spotifyAuth, spotify, services);
  const llm = services.llm;
  const app = createApp({ db, config, passkeys: new Passkeys(db, config), spotifyAuth, spotify, jobs, services, discord: null, now: Date.now });
  const request = (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const { json, ...rest } = init;
    return app.request(path, json === undefined ? rest : { method: "POST", ...rest, body: JSON.stringify(json), headers: { "content-type": "application/json", ...rest.headers } });
  };
  return { db, config, app, request, services, spotify, spotifyAuth, jobs, llm };
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
    .values({ id: 1, accessToken: "access", refreshToken: "refresh", expiresAt: Date.now() + 3_600_000, scope: "", spotifyUserId: userId, updatedAt: 0 })
    .run();
}

export const noContent = () => new Response(null, { status: 204 });
