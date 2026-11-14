import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";

describe("config", () => {
  test("derives redirect URI, RP ID and cookie security from the public URL; empty values mean unset", () => {
    const config = loadConfig({ SPOTIFY_CLIENT_ID: "id", PUBLIC_BASE_URL: "https://spotify.mshl.me", SPOTIFY_REDIRECT_URI: "", SETUP_TOKEN: "" });
    expect(config).toMatchObject({ spotifyRedirectUri: "https://spotify.mshl.me/callback", rpId: "spotify.mshl.me", secureCookies: true, setupToken: undefined });
  });

  test("paces Web API calls 2 s apart, enrichment every 120 s and album art every 4 s by default", () => {
    expect(loadConfig({ SPOTIFY_CLIENT_ID: "id" })).toMatchObject({ spotifyIntervalMs: 2000, enrichIntervalMs: 120_000, enrichBatchSize: 1, artIntervalMs: 4000 });
  });

  test("fails fast on invalid values", () => {
    expect(() => loadConfig({})).toThrow("SPOTIFY_CLIENT_ID");
    expect(() => loadConfig({ SPOTIFY_CLIENT_ID: "id", ADMIN_TOKEN: "short" })).toThrow("ADMIN_TOKEN");
    expect(() => loadConfig({ SPOTIFY_CLIENT_ID: "id", TIMEZONE: "Mars/Base" })).toThrow("TIMEZONE");
  });
});
