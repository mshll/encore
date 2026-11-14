import { describe, expect, test } from "bun:test";
import { createSession } from "../src/auth/sessions";
import { digests, llmCalls, plays, shares, spotifyAuth } from "../src/db/schema";
import { generateDigest } from "../src/digest/service";
import { play, seed, testApp, track, uri } from "./helpers";

const ORIGIN = "https://encore.example";
const SECRET_DEVICE = "Owner-Secret-Device-7731";
const SECRET_USER = "owner-spotify-id-5521";

async function setup(env: Record<string, string> = {}) {
  const t = testApp({ PUBLIC_BASE_URL: "https://encore.example", ...env });
  const cookie = `__Host-encore_session=${createSession(t.db)}`;
  seed(
    t.db,
    [track("w1", "Woods", "Mac Miller", null), track("w2", "Good News", "Mac Miller", null), track("k1", "Ghost Town", "Kanye West", null)],
    Array.from({ length: 12 }, (_, i) => play(`2026-01-${String(i + 3).padStart(2, "0")}T20:00:00Z`, uri(i % 3 === 0 ? "k1" : i % 2 ? "w1" : "w2"), 200_000, { platformRaw: SECRET_DEVICE, connCountry: "ZQ" })),
  );
  t.db.insert(spotifyAuth).values({ id: 1, accessToken: "tok", refreshToken: "ref", expiresAt: 9e15, scope: "", spotifyUserId: SECRET_USER, clientId: "c", updatedAt: 0 }).run();
  t.db.insert(llmCalls).values({ ts: Date.now(), month: "2026-11", feature: "digest", requestedModel: "m", model: "m", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, usd: 4.3217, stopReason: "end_turn", durationMs: 1 }).run();
  const recap = await generateDigest(t.services.assistant, "monthly", "2026-01");
  const make = async (body: Record<string, unknown> = {}) => {
    const res = await t.app.request("/api/shares", { method: "POST", headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ kind: "recap", ref: recap.id, ...body }) });
    return (await res.json()) as { url: string; share: { id: number; views: number; status: string } };
  };
  const open = (path: string, headers: Record<string, string> = {}) => t.app.request(path, { headers });
  return { ...t, cookie, recap, make, open };
}

const pathOf = (url: string) => new URL(url).pathname;
const randomToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

describe("share links", () => {
  test("a link carries a 256-bit token that is stored only as its hash", async () => {
    const { make, db } = await setup();

    const { url } = await make();

    const token = pathOf(url).split("/")[2]!;
    expect([url.startsWith("https://encore.example/s/"), token.length]).toEqual([true, 43]);
    expect(JSON.stringify(db.select().from(shares).all())).not.toContain(token);
  });

  test("the page renders the frozen recap with link preview tags pointing at the card", async () => {
    const { make, open, recap } = await setup();
    const { url } = await make();

    const html = await (await open(pathOf(url))).text();

    expect(html).toContain(`<h1>${recap.page.headline}</h1>`);
    expect(html).toContain(`<meta property="og:image" content="${url}/card.png">`);
    expect(html).toContain(`<meta name="twitter:card" content="summary_large_image">`);
    expect(html).toContain(`<meta name="robots" content="noindex, nofollow, noarchive">`);
  });

  test("the page is sent with no-index, no-referrer, no caching and the strict policy, and has no script", async () => {
    const { make, open } = await setup();
    const { url } = await make();

    const res = await open(pathOf(url));

    expect([res.headers.get("x-robots-tag"), res.headers.get("referrer-policy"), res.headers.get("cache-control")]).toEqual(["noindex, nofollow, noarchive", "no-referrer", "no-store"]);
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect((await res.text()).toLowerCase()).not.toContain("<script");
  });

  test("a wrong, malformed, revoked or expired token all get the same 404", async () => {
    const t = await setup();
    const revoked = await t.make();
    await t.app.request(`/api/shares/${revoked.share.id}`, { method: "DELETE", headers: { cookie: t.cookie, origin: ORIGIN } });
    const expiring = await t.make({ expiresInDays: 1 });
    t.db.update(shares).set({ expiresAt: Date.now() - 1 }).run();

    const answers = await Promise.all([`/s/${randomToken()}`, "/s/short", pathOf(revoked.url), pathOf(expiring.url)].map((p) => t.open(p)));

    expect(answers.map((r) => r.status)).toEqual([404, 404, 404, 404]);
    expect(new Set(await Promise.all(answers.map((r) => r.text()))).size).toBe(1);
  });

  test("the card and the snapshot answer only for a live link", async () => {
    const t = await setup();
    const { url, share } = await t.make();

    const card = await t.open(`${pathOf(url)}/card.png`);
    await t.app.request(`/api/shares/${share.id}`, { method: "DELETE", headers: { cookie: t.cookie, origin: ORIGIN } });

    expect([card.status, card.headers.get("content-type")]).toEqual([200, "image/png"]);
    expect([(await t.open(`${pathOf(url)}/card.png`)).status, (await t.open(`${pathOf(url)}/snapshot.json`)).status]).toEqual([404, 404]);
  });

  test("changing or deleting plays and the recap after sharing leaves the page as it was", async () => {
    const t = await setup();
    const { url } = await t.make();
    const before = await (await t.open(pathOf(url))).text();

    t.db.delete(plays).run();
    t.db.delete(digests).run();

    expect(await (await t.open(pathOf(url))).text()).toBe(before);
  });

  test("no private field reaches the page or the snapshot", async () => {
    const t = await setup();
    const { url } = await t.make();

    const html = await (await t.open(pathOf(url))).text();
    const json = await (await t.open(`${pathOf(url)}/snapshot.json`)).text();

    for (const body of [html, json]) {
      for (const secret of [SECRET_DEVICE, SECRET_USER, "4.32", "usd", "\"model\"", "songKey", "ZQ", "refId", "periodKey", "createdAt"]) expect(body).not.toContain(secret);
    }
  });

  test("the owner's session cookie changes nothing", async () => {
    const t = await setup();
    const { url } = await t.make();

    const stranger = await (await t.open(pathOf(url))).text();
    const owner = await (await t.open(pathOf(url), { cookie: t.cookie })).text();

    expect(owner).toBe(stranger);
  });

  test("the owner's list shows when each link was made and how often it was opened, never the token", async () => {
    const t = await setup();
    const { url } = await t.make();
    await t.open(pathOf(url));
    await t.open(pathOf(url));

    const list = (await (await t.app.request(`/api/shares?kind=recap&ref=${t.recap.id}`, { headers: { cookie: t.cookie } })).json()) as { items: { views: number; status: string; createdAt: string }[] };

    expect(list.items.map((i) => [i.views, i.status])).toEqual([[2, "active"]]);
    expect(JSON.stringify(list)).not.toContain(pathOf(url).split("/")[2]!);
  });

  test("making a link needs the owner's session", async () => {
    const t = await setup();

    const res = await t.app.request("/api/shares", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ kind: "recap", ref: t.recap.id }) });

    expect(res.status).toBe(401);
  });

  test("one client probing tokens is cut off after 60 requests a minute", async () => {
    const t = await setup();
    const probe = () => t.open(`/s/${randomToken()}`, { "x-forwarded-for": "203.0.113.9" });

    for (let i = 0; i < 60; i++) await probe();

    expect([(await probe()).status, (await t.open(`/s/${randomToken()}`, { "x-forwarded-for": "203.0.113.10" })).status]).toEqual([429, 404]);
  });
});

describe("share card", () => {
  test("the owner can download a recap's card in both formats", async () => {
    const t = await setup();

    const wide = await t.app.request(`/api/digests/${t.recap.id}/card`, { headers: { cookie: t.cookie } });
    const square = await t.app.request(`/api/digests/${t.recap.id}/card?format=square`, { headers: { cookie: t.cookie } });

    expect([wide.headers.get("content-type"), wide.headers.get("content-disposition"), square.headers.get("content-disposition")]).toEqual([
      "image/png",
      'attachment; filename="encore-january-2026.png"',
      'attachment; filename="encore-january-2026-square.png"',
    ]);
  });
});
