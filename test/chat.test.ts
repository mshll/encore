import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { MockLanguageModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { createSession } from "../src/auth/sessions";
import { parseTask } from "../src/chat/router";
import { attachConversation, deleteConversation, getConversation, listConversations, renameConversation, sendMessage } from "../src/chat/service";
import type { Db } from "../src/db/client";
import { libraryPlans, llmCalls, ownedPlaylists, playlistItems, ruleDrafts, savedTracks, sets } from "../src/db/schema";
import { monthOf } from "../src/llm/ledger";
import { LlmBudgetExceededError } from "../src/llm/errors";
import { sdkTransport } from "../src/llm/sdk";
import type { LlmTransport } from "../src/llm/types";
import { createSet } from "../src/sets/service";
import { songKey } from "../src/plays/song";
import { featureCtx, message, scripted, seedLibrary, text, toolCall, toolResults, usage } from "./llmFakes";
import { play, seed, testApp, TZ, uri } from "./helpers";

const START = "2026-11-14T09:00:00Z";
const NOW = Date.parse(START);
const WOODS = songKey("Woods", "Mac Miller");
const SURF = songKey("Surf", "Mac Miller");

const route = (task: string) => message([text(JSON.stringify({ task }))]);

function library(db: Db) {
  seedLibrary(db);
  seed(db, [], [play("2026-11-10T20:00:00Z", uri("s1"), 200_000)]);
  db.insert(savedTracks).values(["w1", "s1", "n1", "d1"].map((id) => ({ uri: uri(id), addedAt: NOW - 400 * 86_400_000, syncedAt: NOW }))).run();
  db.insert(ownedPlaylists).values({ id: "gym", name: "gym", snapshotId: "s0", itemCount: 2, syncedAt: NOW }).run();
  db.insert(playlistItems).values([uri("w1"), uri("s1")].map((u, position) => ({ playlistId: "gym", position, uri: u, addedAt: null }))).run();
}

function setup(...responses: Parameters<typeof scripted>) {
  const fake = scripted(...responses);
  const f = featureCtx(fake.transport, [], {}, START);
  library(f.db);
  return { ...f, fake };
}

const submitSet = (title: string, keys = [WOODS]) => toolCall("submit_set", { title, description: "Late.", items: keys.map((songKey) => ({ source: "library", songKey, reason: "Played through at night." })) });
const plan = {
  title: "Liked songs out of rotation",
  summary: "Archives liked songs not played in over 6 months.",
  groups: [{ filter: { where: "liked", lastPlayed: ["over 6 months ago"] }, action: "archive", reason: "Not played since January 2026" }],
};
const rule = (extra: Record<string, unknown> = {}) => ({ name: "Mac Miller lately", about: "The Mac Miller songs I play most.", rule: { source: { type: "history", window: { type: "all" } }, schedule: "weekly", ...extra } });

describe("chat routing", () => {
  test("each task the router names produces its outcome, stored on the conversation's turn", async () => {
    const { ctx, db } = setup(
      route("answer"),
      message([text("You played Woods 20 times.")]),
      route("set"),
      submitSet("Late drive"),
      route("plan"),
      toolCall("submit_plan", plan),
      route("rule"),
      toolCall("submit_rule", rule()),
      route("play"),
      toolCall("suggest_songs", { title: "Mac Miller now", songKeys: [WOODS, SURF] }),
    );

    const { conversationId } = await sendMessage(ctx, { conversationId: null, message: "How much did I play Woods?" });
    for (const m of ["A late drive set", "Clean up my liked songs", "A playlist of my Mac Miller", "Play some Mac Miller"]) await sendMessage(ctx, { conversationId, message: m });
    const turns = getConversation(db, conversationId).turns;

    expect(turns.map((t) => [t.task, t.outcome.kind])).toEqual([
      ["answer", "answer"],
      ["set", "set"],
      ["plan", "plan"],
      ["rule", "rule"],
      ["play", "play"],
    ]);
  });

  test("sets, plans and rule drafts point back at the conversation that made them", async () => {
    const { ctx, db } = setup(route("set"), submitSet("Late drive"), route("plan"), toolCall("submit_plan", plan), route("rule"), toolCall("submit_rule", rule()));

    const { conversationId } = await sendMessage(ctx, { conversationId: null, message: "A late drive set" });
    await sendMessage(ctx, { conversationId, message: "Clean up my liked songs" });
    await sendMessage(ctx, { conversationId, message: "A self-updating playlist" });

    expect([
      db.select({ c: sets.conversationId }).from(sets).get()?.c,
      db.select({ c: libraryPlans.conversationId }).from(libraryPlans).where(eq(libraryPlans.source, "claude")).get()?.c,
      db.select({ c: ruleDrafts.conversationId }).from(ruleDrafts).get()?.c,
    ]).toEqual([conversationId, conversationId, conversationId]);
  });

  test("the router is one small structured call with feature chat, offering refine only once something is attached", async () => {
    const { ctx, db, fake } = setup(route("set"), submitSet("Late drive"), route("refine"), submitSet("Late drive", [WOODS, SURF]));

    const { conversationId } = await sendMessage(ctx, { conversationId: null, message: "A late drive set" });
    await sendMessage(ctx, { conversationId, message: "Add Surf" });
    const enums = [fake.requests[0]!, fake.requests[2]!].map((r) => (r.jsonSchema as { properties: { task: { enum: string[] } } }).properties.task.enum);

    expect([enums, db.select({ feature: llmCalls.feature }).from(llmCalls).all().map((c) => c.feature).sort()]).toEqual([
      [
        ["answer", "set", "rule", "plan", "play"],
        ["answer", "set", "rule", "plan", "play", "refine"],
      ],
      ["chat", "chat", "sets", "sets"],
    ]);
  });

  test("an unreadable or unknown routing reply falls back to an answer, which changes nothing", () => {
    expect([parseTask("no json", ["answer", "set"]), parseTask('{"task":"delete"}', ["answer", "set"]), parseTask('```json\n{"task":"set"}\n```', ["answer", "set"])]).toEqual(["answer", "answer", "set"]);
  });

  test("the router reads the task through the AI SDK's structured output", async () => {
    const model = new MockLanguageModelV4({
      modelId: "claude-opus-5-5",
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start", id: "t" },
              { type: "text-delta", id: "t", delta: '{"task":"play"}' },
              { type: "text-end", id: "t" },
              { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: { inputTokens: { total: 300, noCache: 300, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 8, text: 8, reasoning: 0 } } },
            ],
          }),
        },
        { stream: simulateReadableStream({ chunks: [{ type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } }] }) },
      ],
    });
    const transport = sdkTransport({ id: "anthropic", model: () => model, webSearch: () => ({}) });
    const f = featureCtx(transport, [], {}, START);
    library(f.db);

    const failure = await sendMessage(f.ctx, { conversationId: null, message: "Play some Mac Miller" }).catch((e: unknown) => e);

    expect([(failure as Error).message, f.db.select({ feature: llmCalls.feature }).from(llmCalls).all().map((c) => c.feature)]).toEqual(["The AI finished without songs", ["chat", "play"]]);
  });
});

describe("conversations attached to a set or plan", () => {
  test("Change on a set made before conversations opens a new conversation attached to it, and the next message refines it", async () => {
    const { ctx, db } = setup(submitSet("Old set"), route("refine"), submitSet("Old set", [WOODS, SURF]));
    const { set } = await createSet(ctx, "old request");

    const conversationId = attachConversation(db, "set", set.id, ctx.now());
    const again = attachConversation(db, "set", set.id, ctx.now());
    await sendMessage(ctx, { conversationId, message: "Add Surf" });
    const view = getConversation(db, conversationId);

    expect([again, view.subject, view.turns[0]!.outcome]).toEqual([
      conversationId,
      { kind: "set", id: set.id, title: "Old set" },
      expect.objectContaining({ kind: "set", setId: set.id, changed: true, set: expect.objectContaining({ version: 2, tracks: 2 }) }),
    ]);
  });

  test("refining an attached plan continues the plan's own conversation and keeps the same plan", async () => {
    const { ctx, db } = setup(route("plan"), toolCall("submit_plan", plan), route("refine"), toolCall("submit_plan", { ...plan, title: "Only old liked songs" }));

    const first = await sendMessage(ctx, { conversationId: null, message: "Clean up my liked songs" });
    const second = await sendMessage(ctx, { conversationId: first.conversationId, message: "Call it something else" });

    expect([second.turn.outcome.kind === "plan" && second.turn.outcome.plan, db.select().from(libraryPlans).where(eq(libraryPlans.source, "claude")).all().length]).toEqual([
      expect.objectContaining({ title: "Only old liked songs" }),
      1,
    ]);
  });

  test("a plan encore made by rule cannot be attached", () => {
    const { db } = setup();
    const id = db.insert(libraryPlans).values({ source: "analysis", title: "Dormant", status: "open", createdAt: NOW, updatedAt: NOW }).returning({ id: libraryPlans.id }).get().id;

    expect(() => attachConversation(db, "plan", id, NOW)).toThrow("Only a plan made in the chat");
  });
});

describe("rule drafts", () => {
  test("a rule that fails the schema goes back to the model, and the repaired rule is saved as a draft with its preview count", async () => {
    const { ctx, db, fake } = setup(route("rule"), toolCall("submit_rule", rule({ schedule: "hourly" })), toolCall("submit_rule", rule()));

    const { turn } = await sendMessage(ctx, { conversationId: null, message: "A weekly playlist of everything" });

    expect([toolResults(fake.requests[2]!)[0]!.isError, turn.outcome.kind === "rule" && turn.outcome.draft?.count, db.select().from(ruleDrafts).all().length]).toEqual([true, 4, 1]);
  });

  test("a rule that matches nothing is sent back; when the model gives up, its words are reported and no draft is saved", async () => {
    const { ctx, db, fake } = setup(
      route("rule"),
      toolCall("submit_rule", rule({ filters: { artists: { include: ["Nobody At All"] } } })),
      message([text("I could not find that artist in your history.")]),
    );

    const { turn } = await sendMessage(ctx, { conversationId: null, message: "A playlist of Nobody At All" });

    expect([String(toolResults(fake.requests[2]!)[0]!.value.errors), turn.outcome, db.select().from(ruleDrafts).all().length]).toEqual([
      "The rule matches no songs now. Loosen a filter, widen the window or check the artist names with find_artists.",
      { kind: "rule", draftId: null, reply: "I could not find that artist in your history.", draft: null },
      0,
    ]);
  });
});

describe("play suggestions", () => {
  test("a play card lists the songs and never starts playback or touches the queue", async () => {
    const { ctx, spotifyCalls } = setup(route("play"), toolCall("suggest_songs", { title: "Mac Miller now", songKeys: [WOODS, SURF] }));

    const { turn } = await sendMessage(ctx, { conversationId: null, message: "Play some Mac Miller" });

    expect([turn.outcome.kind === "play" && turn.outcome.songs.map((s) => s.name), spotifyCalls.filter((c) => c.path.includes("/me/player"))]).toEqual([["Woods", "Surf"], []]);
  });

  test("a song key that is not in the history is sent back to the model", async () => {
    const { ctx, fake } = setup(route("play"), toolCall("suggest_songs", { title: "Now", songKeys: ["made up|nobody"] }), toolCall("suggest_songs", { title: "Now", songKeys: [WOODS] }));

    await sendMessage(ctx, { conversationId: null, message: "Play something" });

    expect(toolResults(fake.requests[2]!)[0]!.value.accepted).toBe(false);
  });
});

describe("budget and cancel", () => {
  test("a spent budget blocks the message before the router is called, and no conversation is made", async () => {
    const { ctx, db, fake } = setup();
    ctx.settings.get().llm.monthlyBudgetUsd = 1;
    db.insert(llmCalls).values({ ts: NOW, month: monthOf(NOW, TZ), feature: "ask", requestedModel: "m", model: "m", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, usd: 2, stopReason: "end", durationMs: 1 }).run();

    const failure = await sendMessage(ctx, { conversationId: null, message: "Top song?" }).catch((e: unknown) => e);

    expect([failure instanceof LlmBudgetExceededError, fake.requests.length, listConversations(db, { limit: 10 }).items]).toEqual([true, 0, []]);
  });

  test("cancelling a chat run stops it and still records what the provider billed", async () => {
    const transport: LlmTransport = async (_request, _onText, signal, onUsage) => {
      onUsage?.(usage({ inputTokens: 420 }), "claude-opus-5-5");
      await new Promise((resolve) => signal?.addEventListener("abort", resolve));
      throw new Error("aborted");
    };
    const app = testApp({}, fetch, transport);
    const cookie = `encore_session=${createSession(app.db)}`;
    const res = await app.request("/api/chat", { json: { message: "Top song?" }, headers: { cookie, accept: "text/event-stream" } } as never);
    const id = JSON.parse(/data: (.*)/.exec(new TextDecoder().decode((await res.body!.getReader().read()).value))![1]!).id as string;

    await app.request(`/api/runs/${id}`, { method: "DELETE", headers: { cookie } });
    await Bun.sleep(5);

    expect(app.db.select({ feature: llmCalls.feature, stop: llmCalls.stopReason, input: llmCalls.inputTokens }).from(llmCalls).all()).toEqual([{ feature: "chat", stop: "aborted", input: 420 }]);
  });
});

describe("history", () => {
  test("search matches a conversation's title or any message in it", async () => {
    const { ctx, db } = setup(route("answer"), message([text("Woods.")]), route("answer"), message([text("Surf.")]), route("answer"), message([text("DNA.")]));
    const a = await sendMessage(ctx, { conversationId: null, message: "Top song in January?" });
    await sendMessage(ctx, { conversationId: a.conversationId, message: "And in winter?" });
    await sendMessage(ctx, { conversationId: null, message: "Kendrick stats" });

    const titles = (q: string) => listConversations(db, { q, limit: 10 }).items.map((c) => c.title);

    expect([titles("winter"), titles("kendrick"), titles("%")]).toEqual([["Top song in January?"], ["Kendrick stats"], []]);
  });

  test("rows carry what the conversation produced last, newest first; rename and delete act on one row", async () => {
    const { ctx, db } = setup(route("answer"), message([text("Woods.")]), route("set"), submitSet("Late drive"));
    const asked = await sendMessage(ctx, { conversationId: null, message: "Top song?" });
    const made = await sendMessage(ctx, { conversationId: null, message: "A late drive set" });

    renameConversation(db, asked.conversationId, "Woods question", ctx.now());
    deleteConversation(db, made.conversationId);

    expect([listConversations(db, { limit: 10 }).items.map((c) => [c.title, c.produced]), db.select({ c: sets.conversationId }).from(sets).get()]).toEqual([[["Woods question", "answer"]], { c: null }]);
  });
});

describe("chat routes", () => {
  test("POST /api/chat streams a task event before the work, then the turn", async () => {
    const app = testApp({}, fetch, scripted(route("answer"), message([text("Woods.")])).transport);
    seedLibrary(app.db);
    const cookie = `encore_session=${createSession(app.db)}`;

    const body = await (await app.request("/api/chat", { method: "POST", body: JSON.stringify({ message: "Top song?" }), headers: { cookie, accept: "text/event-stream", "content-type": "application/json" } })).text();

    expect([...body.matchAll(/^event: (\w+)$/gm)].map((m) => m[1])).toEqual(["run", "task", "text", "done"]);
  });

  test("an unknown conversation is 404 and a draft is readable for Build from rules", async () => {
    const app = testApp();
    const cookie = `encore_session=${createSession(app.db)}`;
    const id = app.db.insert(ruleDrafts).values({ name: "Draft", about: null, rule: rule().rule, count: 3, createdAt: NOW }).returning({ id: ruleDrafts.id }).get().id;

    const statuses = [(await app.request("/api/chat/99", { headers: { cookie } })).status, (await app.request("/api/chat/99/messages", { method: "POST", body: JSON.stringify({ message: "x" }), headers: { cookie, "content-type": "application/json" } })).status];
    const draft = await (await app.request(`/api/living/drafts/${id}`, { headers: { cookie } })).json();

    expect([statuses, draft]).toEqual([[404, 404], expect.objectContaining({ name: "Draft", count: 3, rule: expect.objectContaining({ schedule: "weekly" }) })]);
  });
});
