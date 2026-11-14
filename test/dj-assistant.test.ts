import { describe, expect, test } from "bun:test";
import { AppPlaylists } from "../src/dj/playlists";
import { createLlmReplanner } from "../src/dj/llmReplan";
import type { ReplanInput, Replanner } from "../src/dj/replan";
import { DjService } from "../src/dj/session";
import type { FinishedPlay, Observation } from "../src/ingest/live/observe";
import { llmCalls } from "../src/db/schema";
import { PlayerApi } from "../src/player/api";
import { songKey } from "../src/plays/song";
import { playSet } from "../src/sets/play";
import { createSet, getSet } from "../src/sets/service";
import { uri } from "./helpers";
import { featureCtx, message, scripted, seedLibrary, text, toolCall, toolResults } from "./llmFakes";

const input = (over: Partial<ReplanInput> = {}): ReplanInput => ({
  finished: [uri("s1")],
  skipped: [uri("n1")],
  current: uri("w1"),
  upcoming: [uri("n1"), uri("d1")],
  exclude: [uri("s1"), uri("w1")],
  now: Date.parse("2026-02-01T20:00:00Z"),
  ...over,
});

const deterministic: Replanner = async (i) => [...i.upcoming].reverse();

describe("Claude DJ re-planner", () => {
  test("orders the candidates it was given and only those", async () => {
    const fake = scripted(toolCall("set_tail", { order: [9, 1] }), toolCall("set_tail", { order: [2, 1] }));
    const { ctx, db } = featureCtx(fake.transport);
    seedLibrary(db);
    const tail = await createLlmReplanner(ctx, deterministic)(input());
    expect(tail).toEqual([uri("d1"), uri("n1")]);
    expect(toolResults(fake.requests[1]!)[0]!.value).toEqual({ accepted: false, errors: ["Unknown candidate numbers: 9"] });
    const prompt = JSON.stringify(fake.requests[0]!.messages[0]);
    expect(prompt).toContain("1. Nights - Frank Ocean");
    expect(prompt).toContain("<skipped_this_session>\\n- Nights - Frank Ocean");
    expect(fake.requests[0]!.output_config).toEqual({ effort: "low" });
    expect(db.select().from(llmCalls).all().map((c) => c.feature)).toEqual(["dj", "dj"]);
  });

  test("falls back to the deterministic plan when Claude is not configured, over budget, refuses or is slow", async () => {
    const expected = [uri("d1"), uri("n1")];
    const notConfigured = featureCtx(null);
    expect(await createLlmReplanner(notConfigured.ctx, deterministic)(input())).toEqual(expected);

    const overBudget = featureCtx(scripted().transport, [], { MONTHLY_BUDGET_USD: "0" });
    expect(await createLlmReplanner(overBudget.ctx, deterministic)(input())).toEqual(expected);

    const refusal = featureCtx(scripted(message([], "refusal")).transport);
    expect(await createLlmReplanner(refusal.ctx, deterministic)(input())).toEqual(expected);

    const slow = featureCtx(() => new Promise(() => {}));
    const started = Date.now();
    expect(await createLlmReplanner(slow.ctx, deterministic, { timeoutMs: 50 })(input())).toEqual(expected);
    expect(Date.now() - started).toBeLessThan(1000);

    const noTool = featureCtx(scripted(message([text("Here you go.")])).transport);
    expect(await createLlmReplanner(noTool.ctx, deterministic)(input())).toEqual(expected);
  });
});

describe("playing a set through the DJ", () => {
  test("live outcomes from the session are counted per set item", async () => {
    const fake = scripted(
      toolCall("submit_set", {
        title: "Night",
        description: "d",
        items: [
          { source: "library", songKey: songKey("Woods", "Mac Miller"), reason: "r" },
          { source: "library", songKey: songKey("Nights", "Frank Ocean"), reason: "r" },
        ],
      }),
    );
    const { ctx, db, spotifyCalls } = featureCtx(fake.transport);
    seedLibrary(db);
    const { set } = await createSet(ctx, "night");
    const dj = new DjService(db, new PlayerApi(ctx.spotify), new AppPlaylists(db, ctx.spotify), deterministic, () => 5);
    const session = await playSet(db, dj, set.id);
    expect(session.uris).toEqual([uri("w1"), uri("n1")]);
    expect(spotifyCalls.map((c) => `${c.method} ${c.path.split("?")[0]}`)).toContain("PUT /v1/me/player/play");

    const context = `spotify:playlist:${session.playlistId}`;
    const finished = (trackUri: string, skipped: boolean) => ({
      type: "finished" as const,
      play: { trackUri, contextUri: context, reasonEnd: skipped ? "fwdbtn" : "trackdone", msPlayed: skipped ? 10_000 : 200_000, durationMs: 200_000 } as FinishedPlay,
    });
    const started = (trackUri: string) => ({ type: "started" as const, observation: { trackUri, contextUri: context } as Observation });
    dj.onWatchEvent(started(uri("w1")));
    dj.onWatchEvent(finished(uri("w1"), false));
    dj.onWatchEvent(started(uri("n1")));
    dj.onWatchEvent(finished(uri("n1"), true));

    const view = getSet(db, set.id)!;
    expect(view.djSessions).toBe(1);
    expect(view.items.map((i) => [i.name, i.dj])).toEqual([
      ["Woods", { finished: 1, skipped: 0 }],
      ["Nights", { finished: 0, skipped: 1 }],
    ]);
  });
});
