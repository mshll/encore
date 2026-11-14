import { loadConfig } from "../src/config";
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
