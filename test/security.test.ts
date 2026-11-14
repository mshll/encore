import { describe, expect, test } from "bun:test";
import { createSession } from "../src/auth/sessions";
import { Passkeys } from "../src/auth/passkeys";
import { testApp, testConfig, testDb } from "./helpers";

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

describe("body limits", () => {
  const big = (bytes: number) => JSON.stringify({ pad: "x".repeat(bytes) });

  test("pre-auth routes take at most 64 KB", async () => {
    const { app } = testApp({ MCP_TOKEN: "mcp-token-mcp-token-mcp-token" });
    for (const path of ["/api/auth/login/verify", "/api/discord/interactions", "/mcp"]) {
      const res = await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: big(70 * 1024) });
      expect(res.status).toBe(413);
      expect(await errorCode(res)).toBe("body_too_large");
    }
  });

  test("other api routes take at most 1 MB; small bodies pass", async () => {
    const { post } = signedIn();
    const headers = { "content-type": "application/json", origin: "http://localhost:8888" };
    expect((await post("/api/radar/seen", headers, big(1100 * 1024))).status).toBe(413);
    expect((await post("/api/radar/seen", headers, `{${" ".repeat(900 * 1024)}}`)).status).toBe(200);
  });

  test("the declared length is enough to reject, before reading", async () => {
    const { app } = testApp();
    const res = await app.request("/api/auth/login/options", { method: "POST", headers: { "content-type": "application/json", "content-length": String(10 * 1024 * 1024) }, body: "{}" });
    expect(res.status).toBe(413);
  });
});

describe("import upload limits", () => {
  const multipart = (parts: { name: string; bytes: number }[]) => {
    const form = new FormData();
    for (const p of parts) form.append("files", new File(["x".repeat(p.bytes)], p.name));
    return form;
  };

  test("a part over the limit fails while the body is read", async () => {
    const { limitMultipartParts } = await import("../src/http/bodyLimits");
    const req = new Request("http://x/", { method: "POST", body: multipart([{ name: "a.json", bytes: 100 }, { name: "b.json", bytes: 5000 }]) });
    const limited = limitMultipartParts(req, 1000);
    await expect(limited.formData()).rejects.toThrow("A part exceeds 1000 bytes");
    const ok = limitMultipartParts(new Request("http://x/", { method: "POST", body: multipart([{ name: "a.json", bytes: 700 }, { name: "b.json", bytes: 700 }]) }), 1000);
    expect([...(await ok.formData()).getAll("files")]).toHaveLength(2);
  });

  test("the import route answers 413 for a file over 50 MB", async () => {
    const { app, cookie } = signedIn();
    const res = await app.request("/api/import", { method: "POST", headers: { cookie, origin: "http://localhost:8888" }, body: multipart([{ name: "Streaming_History_Audio_2026.json", bytes: 50 * 1024 * 1024 + 1 }]) });
    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe("file_too_large");
  });
});

describe("pre-auth hardening", () => {
  test("auth writes are limited to 20 a minute per client, session reads are not", async () => {
    const { app } = testApp();
    const hit = () => app.request("/api/auth/login/options", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" } });
    for (let i = 0; i < 20; i++) expect((await hit()).status).toBe(200);
    const blocked = await hit();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await app.request("/api/auth/login/options", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.10" } })).status).toBe(200);
    expect((await app.request("/api/auth/session", { headers: { "cf-connecting-ip": "203.0.113.9" } })).status).toBe(200);
  });

  test("the challenge store never grows past 1,000 entries", async () => {
    const passkeys = new Passkeys(testDb(), testConfig());
    for (let i = 0; i < 1005; i++) await passkeys.authenticationOptions();
    expect((passkeys as unknown as { challenges: Map<string, unknown> }).challenges.size).toBe(1000);
  });

  test("every response carries the security headers and API responses are not cached", async () => {
    const { app } = testApp();
    for (const path of ["/api/health", "/api/status"]) {
      const res = await app.request(path);
      expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  test("an https deployment uses a __Host- session cookie", async () => {
    const { app, db, config } = testApp({ PUBLIC_BASE_URL: "https://encore.example" });
    expect(config.secureCookies).toBe(true);
    const id = createSession(db);
    expect((await app.request("/api/status", { headers: { cookie: `__Host-encore_session=${id}` } })).status).toBe(200);
    expect((await app.request("/api/status", { headers: { cookie: `encore_session=${id}` } })).status).toBe(401);
  });
});
