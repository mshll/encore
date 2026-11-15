import { describe, expect, test } from "bun:test";
import { testApp, testConfig } from "./helpers";

const env = { PUBLIC_BASE_URL: "https://encore.example.com", REDIRECT_HOSTS: "spotify.example.com, old.example.com" };
const at = (host: string, path: string, init: RequestInit = {}) => testApp(env).request(`https://${host}${path}`, init);

describe("old addresses", () => {
  test("a page on an old address moves permanently to the same path on the public address", async () => {
    const res = await at("spotify.example.com", "/music/artists?from=2025-01-01");

    expect([res.status, res.headers.get("location")]).toEqual([301, "https://encore.example.com/music/artists?from=2025-01-01"]);
  });

  test("a share link on an old address moves too", async () => {
    const res = await at("old.example.com", "/s/abc");

    expect(res.headers.get("location")).toBe("https://encore.example.com/s/abc");
  });

  test("a POST on an old address is served, so Discord and MCP clients keep working", async () => {
    const res = await at("spotify.example.com", "/mcp", { method: "POST" });

    expect(res.status).not.toBe(301);
  });

  test("the public address and unlisted hosts are not redirected", async () => {
    const statuses = [(await at("encore.example.com", "/api/health")).status, (await at("localhost:3000", "/api/health")).status];

    expect(statuses).toEqual([200, 200]);
  });

  test("REDIRECT_HOSTS is a list of host names", () => {
    expect(testConfig(env).redirectHosts).toEqual(["spotify.example.com", "old.example.com"]);
  });
});
