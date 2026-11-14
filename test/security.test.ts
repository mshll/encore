import { describe, expect, test } from "bun:test";
import { createSession } from "../src/auth/sessions";
import { testApp } from "./helpers";

const ADMIN = "admin-token-admin-token-123";

function signedIn(env: Record<string, string> = {}) {
  const app = testApp(env);
  const cookie = `encore_session=${createSession(app.db)}`;
  const post = (path: string, headers: Record<string, string>, body?: string) => app.app.request(path, { method: "POST", headers: { cookie, ...headers }, body });
  return { ...app, cookie, post };
}

const errorCode = async (res: Response) => ((await res.json()) as { error?: { code: string } }).error?.code;

describe("cross-origin writes", () => {
  const json = { "content-type": "application/json" };

  test("same-origin writes pass, the way the web app sends them", async () => {
    const { post } = signedIn();
    expect((await post("/api/radar/seen", { ...json, origin: "http://localhost:8888" }, "{}")).status).toBe(200);
    expect((await post("/api/radar/seen", { ...json, "sec-fetch-site": "same-origin" }, "{}")).status).toBe(200);
    expect((await post("/api/dj/stop", { origin: "http://localhost:8888" })).status).toBe(404);
  });

  test("sibling subdomains and other sites are rejected", async () => {
    const { post } = signedIn({ PUBLIC_BASE_URL: "https://spotify.mshl.me" });
    for (const origin of ["https://evil.mshl.me", "https://evil.example", "null", "http://spotify.mshl.me"]) {
      const res = await post("/api/radar/seen", { ...json, origin }, "{}");
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe("cross_origin_rejected");
    }
    for (const site of ["same-site", "cross-site"]) expect((await post("/api/radar/seen", { ...json, "sec-fetch-site": site }, "{}")).status).toBe(403);
  });

  test("a body must be JSON, so a text/plain form post cannot reach a handler", async () => {
    const { post } = signedIn();
    const res = await post("/api/radar/seen", { "content-type": "text/plain", origin: "http://localhost:8888" }, "{}");
    expect(res.status).toBe(415);
    expect(await errorCode(res)).toBe("json_required");
  });

  test("admin bearer requests without a browser origin still work", async () => {
    const { app } = signedIn();
    const res = await app.request("/api/tags", { method: "POST", headers: { authorization: `Bearer ${ADMIN}`, ...json }, body: JSON.stringify({ tags: [] }) });
    expect(await errorCode(res)).not.toBe("cross_origin_rejected");
    const crossSite = await app.request("/api/tags", { method: "POST", headers: { authorization: `Bearer ${ADMIN}`, origin: "https://evil.example", ...json }, body: "{}" });
    expect(await errorCode(crossSite)).not.toBe("cross_origin_rejected");
  });

  test("the Discord interactions endpoint is not origin-checked", async () => {
    const { app } = signedIn();
    const res = await app.request("/api/discord/interactions", { method: "POST", headers: { origin: "https://discord.com", ...json }, body: "{}" });
    expect(await errorCode(res)).not.toBe("cross_origin_rejected");
  });

  test("reads are not origin-checked", async () => {
    const { app, cookie } = signedIn();
    expect((await app.request("/api/status", { headers: { cookie, origin: "https://evil.example" } })).status).toBe(200);
  });
});
