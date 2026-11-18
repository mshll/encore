import { describe, expect, test } from "bun:test";
import type { Answer } from "../src/answers/answer";
import { saveAnswer } from "../src/answers/store";
import { createSession } from "../src/auth/sessions";
import { llmThreads, shares } from "../src/db/schema";
import { createThread } from "../src/llm/threads";
import { testApp } from "./helpers";

const ORIGIN = "https://encore.example";
const OTHER_ANSWER = "Earlier-answer-text-4410";
const SONG_KEY = "woods|mac miller";

const ANSWER: Answer = {
  version: 1,
  blocks: [
    { type: "text", spans: [{ text: "Woods led January with " }, { text: "20", unchecked: true }, { text: " plays." }] },
    { type: "visual", id: "v1" },
  ],
  visuals: {
    v1: {
      kind: "ranked",
      title: "Most played songs in January",
      unit: { type: "count", noun: "plays" },
      rows: [
        { item: { kind: "song", name: "Woods", artist: "Mac Miller", songKey: SONG_KEY, uri: "spotify:track:0000000000000000000001", art: null }, value: 20 },
        { item: { kind: "artist", name: "Kanye West", art: null }, value: 12 },
      ],
    },
  },
  basis: "your plays in January 2026.",
};

function setup() {
  const t = testApp({ PUBLIC_BASE_URL: ORIGIN });
  const cookie = `__Host-encore_session=${createSession(t.db)}`;
  const threadId = createThread(
    t.db,
    "ask",
    ["s"],
    [
      { role: "user", content: "<owner_message>\nHi?\n</owner_message>\nOwner's local time: x." },
      { role: "assistant", content: [{ type: "text", text: OTHER_ANSWER }] },
      { role: "user", content: "<owner_message>\nWhat did I play most in January?\n</owner_message>\nOwner's local time: x." },
      { role: "assistant", content: [{ type: "text", text: "Woods led January with 20 plays.\n[[v1]]" }] },
    ],
    0,
  );
  saveAnswer(t.db, threadId, 3, ANSWER, 0);
  const post = (body: Record<string, unknown>) =>
    t.app.request("/api/shares", { method: "POST", headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) });
  const make = async (body: Record<string, unknown> = {}) => (await (await post({ kind: "answer", ref: threadId, turn: 3, ...body })).json()) as { url: string; share: { id: number; turn: number } };
  const open = (path: string) => t.app.request(path);
  return { ...t, cookie, threadId, post, make, open };
}

const pathOf = (url: string) => new URL(url).pathname;

describe("answer share links", () => {
  test("a link to an answer carries a 256-bit token stored only as its hash, and names its turn", async () => {
    const { make, db } = setup();

    const { url, share } = await make();

    const token = pathOf(url).split("/")[2]!;
    expect([token.length, share.turn, JSON.stringify(db.select().from(shares).all()).includes(token)]).toEqual([43, 3, false]);
  });

  test("the page shows the question, the prose and the ranked list, with no script", async () => {
    const { make, open } = setup();
    const { url } = await make();

    const html = await (await open(pathOf(url))).text();

    expect(html).toContain("<h1>What did I play most in January?</h1>");
    expect(html).toContain('<span class="unchecked">20<span class="sr"> (not in the data)</span></span>');
    expect(html).toContain('href="https://open.spotify.com/track/0000000000000000000001"');
    expect(html).toContain(`<meta property="og:image" content="${url}/card.png">`);
    expect(html.toLowerCase()).not.toContain("<script");
  });

  test("the card of a live link is a PNG", async () => {
    const { make, open } = setup();
    const { url } = await make();

    const card = await open(`${pathOf(url)}/card.png`);

    expect([card.status, card.headers.get("content-type")]).toEqual([200, "image/png"]);
  });

  test("nothing else from the thread reaches the page or the snapshot: no other turn, no song key, no thread id", async () => {
    const { make, open } = setup();
    const { url } = await make();

    const bodies = await Promise.all([open(pathOf(url)), open(`${pathOf(url)}/snapshot.json`)].map(async (r) => (await r).text()));

    for (const body of bodies) for (const secret of [OTHER_ANSWER, SONG_KEY, "songKey", "threadId", "Owner's local time", "owner_message"]) expect(body).not.toContain(secret);
  });

  test("deleting the thread after sharing leaves the page as it was", async () => {
    const t = setup();
    const { url } = await t.make();
    const before = await (await t.open(pathOf(url))).text();

    t.db.delete(llmThreads).run();

    expect(await (await t.open(pathOf(url))).text()).toBe(before);
  });

  test("a revoked answer link answers like an unknown one, and the owner's list for that answer shows it revoked", async () => {
    const t = setup();
    const { url, share } = await t.make();

    await t.app.request(`/api/shares/${share.id}`, { method: "DELETE", headers: { cookie: t.cookie, origin: ORIGIN } });
    const list = (await (await t.app.request(`/api/shares?kind=answer&ref=${t.threadId}&turn=3`, { headers: { cookie: t.cookie } })).json()) as { items: { status: string }[] };

    expect([(await t.open(pathOf(url))).status, list.items.map((i) => i.status)]).toEqual([404, ["revoked"]]);
  });

  test("a link with an expiry stops answering once it passes", async () => {
    const t = setup();
    const { url } = await t.make({ expiresInDays: 7 });

    t.db.update(shares).set({ expiresAt: Date.now() - 1 }).run();

    expect((await t.open(pathOf(url))).status).toBe(404);
  });

  test("a question turn, an unknown thread or a missing turn makes no link", async () => {
    const t = setup();

    const res = await Promise.all([t.post({ kind: "answer", ref: t.threadId, turn: 2 }), t.post({ kind: "answer", ref: 999, turn: 1 }), t.post({ kind: "answer", ref: t.threadId })]);

    expect(res.map((r) => r.status)).toEqual([404, 404, 400]);
  });
});
