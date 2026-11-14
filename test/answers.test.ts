import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { checkNumbers, parseAnswer, type Answer } from "../src/answers/answer";
import type { Visual } from "../src/answers/visuals";
import { ask, deleteAskThread, getAskThread } from "../src/ask/service";
import { llmAnswers } from "../src/db/schema";
import type { AgentEvent } from "../src/llm/agent";
import { createThread } from "../src/llm/threads";
import { songKey } from "../src/plays/song";
import { uri } from "./helpers";
import { featureCtx, message, scripted, seedLibrary, text, toolCall, toolResults } from "./llmFakes";

const WOODS = songKey("Woods", "Mac Miller");

const RANKED = { kind: "ranked", title: "Most played songs in January", ref: "r1", path: "", value: "plays" };
const PAIR = { kind: "pair", label: "Plays of the top song against the second", now: { ref: "r1", path: "0.plays" }, before: { ref: "r1", path: "1.plays" } };

/** Top songs, then show, then a final answer that places the visuals. */
function scriptedAnswer(visuals: unknown[], answer: string) {
  return scripted(toolCall("top", { kind: "songs", from: "2026-01-01", to: "2026-01-31", sort: "plays" }), toolCall("show", { visuals }), message([text(answer)]));
}

describe("visuals are bound to tool results", () => {
  test("a visual copies its values from the cited result, by reference", async () => {
    const fake = scriptedAnswer([RANKED, PAIR], "Woods leads with 20 plays [[v2]] against 10 for Surf.\n[[v1]]\nBased on: your plays in January 2026.");
    const { ctx, db } = featureCtx(fake.transport);
    seedLibrary(db);

    const result = await ask(ctx, "what did I play most in January?", null);

    const top = toolResults(fake.requests[1]!)[0]!.value.result as { name: string; plays: number }[];
    const ranked = result.content.visuals.v1 as Extract<Visual, { kind: "ranked" }>;
    expect(ranked.rows.map((r) => [r.item.name, r.value])).toEqual(top.map((t) => [t.name, t.plays]));
    expect(ranked.rows[0]!.item).toMatchObject({ kind: "song", songKey: WOODS, uri: uri("w1") });
    expect(ranked.unit).toEqual({ type: "count", noun: "plays" });
    expect(result.content.visuals.v2).toEqual({ kind: "pair", label: "Plays of the top song against the second", unit: { type: "count", noun: "plays" }, now: top[0]!.plays, before: top[1]!.plays });
    expect(result.content.blocks).toEqual([
      { type: "text", spans: [{ text: "Woods leads with 20 plays " }, { visual: "v2" }, { text: " against 10 for Surf." }] },
      { type: "visual", id: "v1" },
    ]);
    expect(result.content.basis).toBe("your plays in January 2026.");
    expect(result.answer).toBe(
      `Woods leads with 20 plays against 10 for Surf.\n\nMost played songs in January\n${top.map((t, i) => `${i + 1}. ${t.name} by ${(t as { artist?: string }).artist}: ${t.plays} ${t.plays === 1 ? "play" : "plays"}`).join("\n")}\n\nBased on: your plays in January 2026.`,
    );
  });

  test("show tells Claude the values it drew and the change it derived", async () => {
    const fake = scriptedAnswer([PAIR], "Done.");
    const { ctx, db } = featureCtx(fake.transport);
    seedLibrary(db);
    await ask(ctx, "q", null);
    expect(toolResults(fake.requests[2]!)[0]!.value).toEqual({ shown: [{ id: "v1", kind: "pair", now: 20, before: 10, changePct: 100 }], rejected: [] });
  });

  test("a visual citing an unknown ref, a missing path or a non-number is rejected, and its marker is dropped", async () => {
    const fake = scriptedAnswer(
      [
        { ...PAIR, now: { ref: "r9", path: "0.plays" } },
        { ...PAIR, now: { ref: "r1", path: "0.name" } },
        { ...PAIR, now: { ref: "r1", path: "12.plays" } },
        { ...RANKED, value: "nope" },
      ],
      "Woods leads. [[v1]]",
    );
    const { ctx, db } = featureCtx(fake.transport);
    seedLibrary(db);

    const result = await ask(ctx, "q", null);

    const shown = toolResults(fake.requests[2]!)[0]!.value as { shown: unknown[]; rejected: { index: number; error: string }[] };
    expect(shown.shown).toEqual([]);
    expect(shown.rejected.map((r) => r.index)).toEqual([0, 1, 2, 3]);
    expect(shown.rejected[0]!.error).toContain("r9 is not a result from this answer");
    expect(shown.rejected[1]!.error).toContain("is not a number");
    expect(shown.rejected[2]!.error).toContain("nothing at 12");
    expect(shown.rejected[3]!.error).toContain("has no number in nope");
    expect(result.content).toEqual({ version: 1, blocks: [{ type: "text", spans: [{ text: "Woods leads." }] }], visuals: {}, basis: null });
  });

  test("a label or title with a number in it is rejected before anything is drawn", async () => {
    const fake = scriptedAnswer([{ ...RANKED, title: "Top 4 songs, 20 plays" }], "Done.");
    const { ctx, db } = featureCtx(fake.transport);
    seedLibrary(db);
    await ask(ctx, "q", null);
    const last = fake.requests[2]!.messages.at(-1)!.content as { is_error?: boolean; content: string }[];
    expect(last[0]!.is_error).toBe(true);
    expect(last[0]!.content).toContain("INVALID_INPUT");
  });

  test("a visual cannot cite a result from an earlier turn of the thread", async () => {
    const fake = scripted(
      toolCall("top", { kind: "songs" }),
      message([text("Woods.")]),
      toolCall("show", { visuals: [RANKED] }),
      message([text("[[v1]]")]),
    );
    const { ctx, db } = featureCtx(fake.transport);
    seedLibrary(db);
    const first = await ask(ctx, "q", null);
    const second = await ask(ctx, "and again?", first.threadId);
    expect((toolResults(fake.requests[3]!)[0]!.value as { rejected: { error: string }[] }).rejected[0]!.error).toContain("r1 is not a result from this answer");
    expect(second.content.blocks).toEqual([]);
  });
});

describe("numbers in the prose", () => {
  const answerOf = (text: string) => parseAnswer(text, {});
  const unchecked = (a: Answer) => a.blocks.flatMap((b) => (b.type === "text" ? b.spans.filter((s) => "text" in s && s.unchecked).map((s) => ("text" in s ? s.text : "")) : []));

  test("a number no tool returned is marked; one the tools returned is not", () => {
    const known = [20, 41.25, 0.334, 1187];
    expect(unchecked(checkNumbers(answerOf("Woods has 20 plays, 41.3 hours and a 33% skip rate, about 1,200 hours in all."), known))).toEqual([]);
    expect(unchecked(checkNumbers(answerOf("Woods has 21 plays and 41.9 hours, a 35% skip rate."), known))).toEqual(["21", "41.9", "35"]);
  });

  test("years, dates, times and days of the month are not checked", () => {
    expect(unchecked(checkNumbers(answerOf("On 14 February 2026 at 22:00, and March 3, from 2025-01-01 to 2025-12-31."), []))).toEqual([]);
  });

  test("a marked number keeps the text around it", () => {
    expect(checkNumbers(answerOf("You played 7 songs."), []).blocks).toEqual([{ type: "text", spans: [{ text: "You played " }, { text: "7", unchecked: true }, { text: " songs." }] }]);
  });

  test("the count of rows in a result is data", async () => {
    const fake = scripted(toolCall("top", { kind: "songs" }), message([text("All 4 songs you played in January.")]));
    const { ctx, db } = featureCtx(fake.transport);
    seedLibrary(db);
    expect((await ask(ctx, "q", null)).content.blocks).toEqual([{ type: "text", spans: [{ text: "All 4 songs you played in January." }] }]);
  });
});

describe("stored answers", () => {
  test("a thread written before structured answers opens with its plain text", () => {
    const { db } = featureCtx(null);
    const id = createThread(
      db,
      "ask",
      ["s"],
      [
        { role: "user", content: "<owner_message>\nWho?\n</owner_message>\nOwner's local time: x." },
        { role: "assistant", content: [{ type: "text", text: "Mac Miller, 20 plays.\n\nBased on: your plays." }] },
      ],
      0,
    );
    expect(getAskThread(db, id).turns).toEqual([
      { role: "owner", text: "Who?" },
      { role: "assistant", text: "Mac Miller, 20 plays.\n\nBased on: your plays." },
    ]);
  });

  test("an answer reads back as it was written, with its values, after the data changes", async () => {
    const fake = scriptedAnswer([RANKED], "Woods leads.\n[[v1]]");
    const { ctx, db } = featureCtx(fake.transport);
    seedLibrary(db);
    const result = await ask(ctx, "q", null);

    db.run(sql`delete from plays`);

    const thread = getAskThread(db, result.threadId);
    expect(thread.turns.at(-1)).toEqual({ role: "assistant", text: result.answer, content: result.content });
  });

  test("deleting a thread deletes its answers", async () => {
    const { ctx, db } = featureCtx(scripted(message([text("Woods.")])).transport);
    const { threadId } = await ask(ctx, "q", null);
    expect(db.select().from(llmAnswers).all()).toHaveLength(1);
    deleteAskThread(db, threadId);
    expect(db.select().from(llmAnswers).all()).toHaveLength(0);
  });
});

describe("streaming", () => {
  test("each visual is sent when show draws it, before the text that places it", async () => {
    const fake = scriptedAnswer([RANKED], "Woods leads.\n[[v1]]");
    const { ctx, db } = featureCtx(fake.transport);
    seedLibrary(db);
    const events: AgentEvent[] = [];
    await ask(ctx, "q", null, (e) => events.push(e));
    expect(events.map((e) => e.type)).toEqual(["tool", "tool", "visual", "text"]);
    expect(events[2]).toMatchObject({ type: "visual", id: "v1", visual: { kind: "ranked" } });
  });
});
