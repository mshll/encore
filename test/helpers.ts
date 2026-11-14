import { Passkeys } from "../src/auth/passkeys";
import { loadConfig } from "../src/config";
import { createApp } from "../src/http/app";
import { createJobs } from "../src/jobs/definitions";
import { SpotifyAuth } from "../src/spotify/auth";
import { Llm, type LlmTransport } from "../src/llm/client";
import { SpotifyClient } from "../src/spotify/client";
import { openDb, type Db } from "../src/db/client";
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

export function testApp(env: Record<string, string> = {}, transport: LlmTransport | null = null) {
  const db = testDb();
  const config = testConfig(env);
  const spotifyAuth = new SpotifyAuth(db, config);
  const spotify = new SpotifyClient(db, spotifyAuth, config);
  const llm = new Llm(db, config, transport);
  const app = createApp({ db, config, passkeys: new Passkeys(db, config), spotifyAuth, spotify, jobs: createJobs(db, config, spotifyAuth, spotify), llm, now: Date.now });
  const request = (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const { json, ...rest } = init;
    return app.request(path, json === undefined ? rest : { method: "POST", ...rest, body: JSON.stringify(json), headers: { "content-type": "application/json", ...rest.headers } });
  };
  return { db, config, app, request, llm, spotify };
}
