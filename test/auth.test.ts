import { describe, expect, test } from "bun:test";
import { passkeys } from "../src/db/schema";
import { SoftAuthenticator } from "./authenticator";
import { testApp } from "./helpers";

const SETUP = "setup-token-setup-token-123";
const ADMIN = "admin-token-admin-token-123";

const cookieFrom = (res: Response) => res.headers.get("set-cookie")!.split(";")[0]!;

async function registerFirst(request: ReturnType<typeof testApp>["request"], authenticator: SoftAuthenticator) {
  const options = (await (await request("/api/auth/register/options", { json: { setupToken: SETUP } })).json()) as { challenge: string };
  return request("/api/auth/register/verify", { json: { setupToken: SETUP, response: await authenticator.register(options.challenge) } });
}

describe("auth gating", () => {
  test("health and session status are public, data routes are not", async () => {
    const { request } = testApp();
    expect((await request("/api/health")).status).toBe(200);
    expect(await (await request("/api/auth/session")).json()).toEqual({ authenticated: false, setupRequired: true });
    for (const path of ["/api/status", "/api/stats/overview", "/api/history", "/api/spotify/authorize", "/api/entities/artist?name=x", "/api/search?q=x", "/api/nope"]) {
      const res = await request(path);
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unauthenticated");
    }
    expect((await request("/api/import", { method: "POST" })).status).toBe(401);
  });

  test("first passkey needs the setup token", async () => {
    const { request } = testApp();
    expect((await request("/api/auth/register/options", { json: {} })).status).toBe(403);
    expect((await request("/api/auth/register/options", { json: { setupToken: "wrong-token-wrong-token-1" } })).status).toBe(403);
    expect((await request("/api/auth/register/options", { json: { setupToken: SETUP } })).status).toBe(200);
  });

  test("first passkey is impossible when no setup token is configured", async () => {
    const { request } = testApp({ SETUP_TOKEN: "" });
    expect((await request("/api/auth/register/options", { json: { setupToken: "" } })).status).toBe(403);
  });

  test("full passkey ceremony: register, log in, use the session, log out", async () => {
    const { request, config } = testApp();
    const authenticator = new SoftAuthenticator(config.publicBaseUrl, config.rpId);
    const registered = await registerFirst(request, authenticator);
    expect(registered.status).toBe(200);
    expect(registered.headers.get("set-cookie")).toContain("HttpOnly");

    const options = (await (await request("/api/auth/login/options", { method: "POST" })).json()) as { challenge: string };
    const login = await request("/api/auth/login/verify", { json: { response: await authenticator.login(options.challenge) } });
    expect(login.status).toBe(200);
    const cookie = cookieFrom(login);
    expect(login.headers.get("set-cookie")).toContain("SameSite=Lax");

    expect((await request("/api/stats/overview", { headers: { cookie } })).status).toBe(200);
    expect(await (await request("/api/auth/session", { headers: { cookie } })).json()).toEqual({ authenticated: true, setupRequired: false });

    await request("/api/auth/logout", { method: "POST", headers: { cookie } });
    expect((await request("/api/stats/overview", { headers: { cookie } })).status).toBe(401);
  });

  test("a login challenge cannot be replayed", async () => {
    const { request, config } = testApp();
    const authenticator = new SoftAuthenticator(config.publicBaseUrl, config.rpId);
    await registerFirst(request, authenticator);
    const options = (await (await request("/api/auth/login/options", { method: "POST" })).json()) as { challenge: string };
    const response = await authenticator.login(options.challenge);
    expect((await request("/api/auth/login/verify", { json: { response } })).status).toBe(200);
    expect((await request("/api/auth/login/verify", { json: { response } })).status).toBe(400);
  });

  test("after the first passkey, the setup token no longer allows registration; a session does", async () => {
    const { request, db, config } = testApp();
    db.insert(passkeys).values({ id: "existing", publicKey: "AA", counter: 0, createdAt: 0 }).run();
    expect((await request("/api/auth/register/options", { json: { setupToken: SETUP } })).status).toBe(401);

    const fresh = testApp();
    const authenticator = new SoftAuthenticator(fresh.config.publicBaseUrl, fresh.config.rpId);
    const cookie = cookieFrom(await registerFirst(fresh.request, authenticator));
    expect((await fresh.request("/api/auth/register/options", { json: {}, headers: { cookie } })).status).toBe(200);
    expect(config.secureCookies).toBe(false);
  });

  test("admin token works on tagging routes and not on read routes", async () => {
    const { request } = testApp();
    const admin = { authorization: `Bearer ${ADMIN}` };
    expect((await request("/api/tags/vocabulary", { headers: admin })).status).toBe(200);
    expect((await request("/api/tags/pending", { headers: admin })).status).toBe(200);
    expect((await request("/api/tags/pending", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await request("/api/tags/pending")).status).toBe(401);
    for (const path of ["/api/stats/overview", "/api/status", "/api/history"]) {
      expect((await request(path, { headers: admin })).status).toBe(401);
    }
  });

  test("secure cookies in production", async () => {
    const { request, config } = testApp({ PUBLIC_BASE_URL: "https://spotify.example.com" });
    expect(config.rpId).toBe("spotify.example.com");
    const authenticator = new SoftAuthenticator(config.publicBaseUrl, config.rpId);
    const res = await registerFirst(request, authenticator);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Secure");
  });
});
