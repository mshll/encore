import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";

describe("config", () => {
  test("derives redirect URI, RP ID and cookie security from the public URL; empty values mean unset", () => {
    const config = loadConfig({ PUBLIC_BASE_URL: "https://spotify.example.com", SPOTIFY_REDIRECT_URI: "", SETUP_TOKEN: "" });
    expect(config).toMatchObject({ spotifyRedirectUri: "https://spotify.example.com/callback", rpId: "spotify.example.com", secureCookies: true, setupToken: undefined });
  });

  test("starts with no env at all: every setting can come from the dashboard", () => {
    expect(loadConfig({})).toMatchObject({ envSettings: {}, secretsKey: undefined, jobsEnabled: true });
  });

  test("validates setting env vars at boot and keeps them as overrides in field units", () => {
    const config = loadConfig({ SPOTIFY_CLIENT_ID: "id", TIMEZONE: "Asia/Kuwait", POLL_INTERVAL_SECONDS: "120", PICKS_PLAYLIST: "true", WEEKEND_DAYS: "6,7" });
    expect(config.envSettings).toEqual({ spotifyClientId: "id", timezone: "Asia/Kuwait", pollIntervalSeconds: 120, picksPlaylist: true, weekendDays: [6, 7] });
  });

  test("fails fast on invalid values", () => {
    expect(() => loadConfig({ ADMIN_TOKEN: "short" })).toThrow("ADMIN_TOKEN");
    expect(() => loadConfig({ TIMEZONE: "Mars/Base" })).toThrow("TIMEZONE");
    expect(() => loadConfig({ POLL_INTERVAL_SECONDS: "abc" })).toThrow("POLL_INTERVAL_SECONDS");
    expect(() => loadConfig({ SECRETS_KEY: "too-short" })).toThrow("SECRETS_KEY");
    expect(() => loadConfig({ LLM_MODEL: "claude-unknown" })).toThrow("no price for claude-unknown");
  });
});
