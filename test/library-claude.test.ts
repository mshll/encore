import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createSession } from "../src/auth/sessions";
import type { Db } from "../src/db/client";
import { cleanupBatches, libraryPlans, libraryStanding, ownedPlaylists, playlistItems, savedTracks } from "../src/db/schema";
import { createAssistantJobs } from "../src/jobs/assistant";
import { runJob } from "../src/jobs/scheduler";
import { getPlan, updateItems } from "../src/library/plans";
import { leaksInternals } from "../src/llm/plainText";
import { continuePlanConversation, planConversation, startPlanConversation } from "../src/library/planner";
import { createStanding } from "../src/library/standing";
import { SpotifyAuth } from "../src/spotify/auth";
import { featureCtx, message, scripted, seedLibrary, text, toolCall, toolResults } from "./llmFakes";
import { play, seed, testApp, uri } from "./helpers";

const START = "2026-11-14T09:00:00Z";
const NOW = Date.parse(START);

function library(db: Db) {
  seedLibrary(db);
  seed(db, [], [play("2026-11-10T20:00:00Z", uri("s1"), 200_000)]);
  db.insert(savedTracks).values(["w1", "s1", "n1", "d1"].map((id) => ({ uri: uri(id), addedAt: NOW - 400 * 86_400_000, syncedAt: NOW }))).run();
  db.insert(ownedPlaylists).values({ id: "gym", name: "gym", snapshotId: "s0", itemCount: 2, syncedAt: NOW }).run();
  db.insert(playlistItems).values([uri("w1"), uri("s1")].map((u, position) => ({ playlistId: "gym", position, uri: u, addedAt: null }))).run();
}

const dormantGroup = (reason = "Not played since January 2026") => ({
  title: "Liked songs out of rotation",
  summary: "Archives liked songs not played in over 6 months.",
  groups: [{ filter: { where: "liked", lastPlayed: ["over 6 months ago"] }, action: "archive", reason }],
});

function setup(...responses: Parameters<typeof scripted>) {
  const fake = scripted(...responses);
  const f = featureCtx(fake.transport, [], {}, START);
  library(f.db);
  return { ...f, fake };
}

const names = (db: Db, planId: number) => getPlan(db, planId, { status: "open", limit: 50, offset: 0 }).items.map((i) => i.evidence.name);

describe("Claude plans", () => {
  test("Claude reads the library with tools and submits a plan whose groups expand to songs, each with the evidence behind it", async () => {
    const { ctx, db, fake } = setup(toolCall("library_overview", {}), toolCall("find_library_songs", { where: "liked", lastPlayed: ["over 6 months ago"] }), toolCall("submit_plan", dormantGroup()));

    const turn = await startPlanConversation(ctx, "clean up what I don't listen to anymore");
    const plan = getPlan(db, turn.planId!, { status: "open", limit: 50, offset: 0 });

    expect([plan.source, plan.title, plan.items.map((i) => [i.evidence.name, i.action, i.reason]), fake.remaining()]).toEqual([
      "claude",
      "Liked songs out of rotation",
      [
        ["Woods", "archive", "Not played since January 2026"],
        ["DNA.", "archive", "Not played since January 2026"],
      ],
      0,
    ]);
  });

  test("the tools speak in plain words: no class ids, field names with underscores or song keys reach Claude", async () => {
    const { ctx, fake } = setup(toolCall("library_overview", {}), toolCall("find_library_songs", { where: "gym" }), message([text("Nothing to change.")]));

    await startPlanConversation(ctx, "look at my gym playlist");
    const results = JSON.stringify([toolResults(fake.requests[1]!), toolResults(fake.requests[2]!)]);

    expect([/dormant|fading|wrong_moment|keeper|song_key|songKey|"active"/.test(results), /lastPlayedGroup":"over 6 months ago/.test(results)]).toEqual([false, true]);
  });

  test("a reason with a song reference or an internal id is sent back, and the corrected plan is accepted", async () => {
    const leaky = { ...dormantGroup("#12 is a dormant_song") };
    const { ctx, db, fake } = setup(toolCall("submit_plan", leaky), toolCall("submit_plan", dormantGroup()));

    const turn = await startPlanConversation(ctx, "clean up");
    const [first] = toolResults(fake.requests[1]!);

    expect([first!.value.accepted, String(first!.value.errors), names(db, turn.planId!).length]).toEqual([false, "Group 1: the reason must be plain words, without song references, field or tool names.", 2]);
  });

  test("leaksInternals catches references and snake case ids, not ordinary sentences", () => {
    expect(["#4 again", "a wrong_moment song", "uri of it", "Last played in March 2025, 3 listens"].map(leaksInternals)).toEqual([true, true, true, false]);
  });

  test("talking on changes the same plan and keeps the owner's unticks", async () => {
    const keepMac = { ...dormantGroup(), groups: [{ ...dormantGroup().groups[0]!, filter: { where: "liked", lastPlayed: ["over 6 months ago"], excludeArtists: ["Mac Miller"] } }] };
    const { ctx, db } = setup(toolCall("submit_plan", dormantGroup()), toolCall("submit_plan", keepMac));
    const { planId, threadId } = await startPlanConversation(ctx, "clean up");
    const dna = getPlan(db, planId!, { status: "open", limit: 50, offset: 0 }).items.find((i) => i.evidence.name === "DNA.")!;
    updateItems(db, planId!, { ids: [dna.id], included: false }, NOW);

    const turn = await continuePlanConversation(ctx, threadId, "keep anything by Mac Miller");
    const items = getPlan(db, planId!, { status: "open", limit: 50, offset: 0 }).items;

    expect([turn.planId, items.map((i) => [i.evidence.name, i.included])]).toEqual([
      planId,
      [["DNA.", false]],
    ]);
  });

  test("a first turn that only asks a question keeps the conversation, and the plan arrives with the answer", async () => {
    const { ctx, db } = setup(message([text("Over 6 months, or never played too?")]), toolCall("submit_plan", dormantGroup()));

    const first = await startPlanConversation(ctx, "clean up");
    const second = await continuePlanConversation(ctx, first.threadId, "over 6 months");

    expect([first.planId, first.reply, names(db, second.planId!).length]).toEqual([null, "Over 6 months, or never played too?", 2]);
  });

  test("an add needs one of the owner's playlists; encore's own playlists and unknown names are refused", async () => {
    const bad = { title: "Sort", summary: "", groups: [{ filter: { where: "liked" }, action: "add", target: "encore archive", reason: "for the gym" }] };
    const { ctx, fake } = setup(toolCall("submit_plan", bad), message([text("Which playlist?")]));

    await startPlanConversation(ctx, "sort my liked songs");

    expect(toolResults(fake.requests[1]!)[0]!.value.errors).toEqual(["Group 1: add needs target, the name of one of the owner's playlists."]);
  });

  test("a turn that ends in a plan reads as Claude's summary of it in the conversation", async () => {
    const { ctx, db } = setup(toolCall("submit_plan", dormantGroup()));

    const { threadId } = await startPlanConversation(ctx, "clean up");

    expect(planConversation(db, threadId)).toEqual([
      { role: "owner", text: "clean up" },
      { role: "assistant", text: "Archives liked songs not played in over 6 months." },
    ]);
  });

  test("every Claude call is recorded in the ledger under the library feature", async () => {
    const { ctx, db } = setup(toolCall("submit_plan", dormantGroup()));

    await startPlanConversation(ctx, "clean up");

    expect(db.all(sql`select feature, count(*) as n from llm_calls group by feature`)).toEqual([{ feature: "library", n: 1 }]);
  });
});

describe("standing instructions", () => {
  function jobSetup(...responses: Parameters<typeof scripted>) {
    const f = setup(...responses);
    const jobs = createAssistantJobs(f.ctx, new SpotifyAuth(f.db, f.ctx.config, f.ctx.settings, f.fetchFn));
    return { ...f, job: jobs.library };
  }

  test("are off until switched on", async () => {
    const { db, job, fake } = jobSetup(toolCall("submit_plan", dormantGroup()));
    createStanding(db, { instruction: "clean up monthly", cadence: "monthly" }, NOW);

    await runJob(db, job);

    expect([fake.requests.length, db.select().from(libraryPlans).all().length]).toEqual([0, 0]);
  });

  test("a due instruction makes a plan that waits for the owner: nothing is applied and Spotify is not called", async () => {
    const { db, job, spotifyCalls } = jobSetup(toolCall("submit_plan", dormantGroup()));
    const standing = createStanding(db, { instruction: "clean up monthly", cadence: "monthly", enabled: true }, NOW);

    await runJob(db, job);
    const plan = db.select().from(libraryPlans).get()!;

    expect([plan.source, plan.status, plan.standingId, db.select().from(cleanupBatches).all().length, spotifyCalls.length, db.select().from(libraryStanding).where(eq(libraryStanding.id, standing.id)).get()!.lastPlanId]).toEqual([
      "standing",
      "open",
      standing.id,
      0,
      0,
      plan.id,
    ]);
  });

  test("runs once per period", async () => {
    const { db, job, fake } = jobSetup(toolCall("submit_plan", dormantGroup()));
    createStanding(db, { instruction: "clean up monthly", cadence: "monthly", enabled: true }, NOW);

    await runJob(db, job);
    await runJob(db, job);

    expect(fake.requests.length).toBe(1);
  });

  test("stop at the monthly cap and say so", async () => {
    const { db, job, fake } = jobSetup(toolCall("submit_plan", dormantGroup()));
    db.run(sql`insert into settings (key, value, updated_at) values ('monthlyBudgetUsd', '0.0001', 0)`);
    db.run(sql`insert into llm_calls (ts, month, feature, requested_model, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches, usd, duration_ms) values (${NOW}, '2026-11', 'ask', 'm', 'm', 0, 0, 0, 0, 0, 1, 0)`);
    createStanding(db, { instruction: "clean up monthly", cadence: "monthly", enabled: true }, NOW);

    await runJob(db, job);

    expect([fake.requests.length, db.select().from(libraryStanding).get()!.lastError]).toEqual([0, "The monthly Claude budget is spent"]);
  });
});

describe("conversation routes", () => {
  test("start a plan over HTTP; Claude not set up answers 503", async () => {
    const app = testApp();
    const cookie = `encore_session=${createSession(app.db)}`;

    const res = await app.request("/api/library/conversations", { json: { message: "clean up" }, headers: { cookie } });

    expect([res.status, ((await res.json()) as { error: { code: string } }).error.code]).toEqual([503, "llm_not_configured"]);
  });

  test("standing instructions are listed, switched and deleted over HTTP", async () => {
    const app = testApp();
    const cookie = `encore_session=${createSession(app.db)}`;
    const created = (await (await app.request("/api/library/standing", { json: { instruction: "trim gym", cadence: "weekly" }, headers: { cookie } })).json()) as { id: number; enabled: boolean };

    const switched = (await (await app.request(`/api/library/standing/${created.id}`, { method: "PATCH", body: JSON.stringify({ enabled: true }), headers: { cookie, "content-type": "application/json" } })).json()) as { enabled: boolean };
    const deleted = await app.request(`/api/library/standing/${created.id}`, { method: "DELETE", headers: { cookie } });

    expect([created.enabled, switched.enabled, deleted.status]).toEqual([false, true, 200]);
  });
});
