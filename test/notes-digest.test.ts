import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../src/db/client";
import { llmCalls, picks } from "../src/db/schema";
import { digestFacts, monthlyWindows, weeklyWindows } from "../src/digest/facts";
import { allowedNumbers, unsupportedNumbers } from "../src/digest/numbers";
import { CODE_RENDERED, generateDigest, isDigestDue, listDigests, renderDigest } from "../src/digest/service";
import { createAssistantJobs } from "../src/jobs/assistant";
import { trackNote } from "../src/notes/service";
import { songKey } from "../src/plays/song";
import { TZ, uri } from "./helpers";
import { featureCtx, message, scripted, seedLibrary, text } from "./llmFakes";

const WOODS = songKey("Woods", "Mac Miller");

describe("notes", () => {
  const cited = {
    type: "text",
    text: "Woods closes the middle of Circles.",
    citations: [{ type: "web_search_result_location", url: "https://example.org/circles", title: "Circles credits", cited_text: "x", encrypted_index: "e" }],
  } as unknown as Anthropic.Beta.BetaContentBlock;

  test("a note is written once per song and then served from the cache, whichever key asks", async () => {
    const fake = scripted(message([cited]));
    const { ctx, db } = featureCtx(fake.transport);
    seedLibrary(db);
    const first = await trackNote(ctx, { songKey: WOODS });
    expect(first).toMatchObject({ cached: false, text: "Woods closes the middle of Circles.", sources: [{ url: "https://example.org/circles", title: "Circles credits" }] });
    expect(await trackNote(ctx, { songKey: WOODS })).toMatchObject({ cached: true, text: first.text });
    expect(await trackNote(ctx, { uri: uri("w1") })).toMatchObject({ cached: true, songKey: WOODS });
    expect(fake.requests).toHaveLength(1);
    const req = fake.requests[0]!;
    expect(req.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 4 }]);
    expect(req.output_config).toEqual({ effort: "medium" });
    expect(JSON.stringify(req.messages[0])).toContain("This song: 20 plays");
    expect(first).toMatchObject({ albumArtUrl: null, artistImageUrl: null });
  });

  test("without citations, the searched pages become the sources", async () => {
    const results = {
      type: "web_search_tool_result",
      tool_use_id: "srvtoolu_1",
      content: [{ type: "web_search_result", url: "https://example.org/a", title: "A", encrypted_content: "", page_age: null }],
    } as unknown as Anthropic.Beta.BetaContentBlock;
    const { ctx, db } = featureCtx(scripted(message([results, text("Note.")])).transport);
    seedLibrary(db);
    expect((await trackNote(ctx, { songKey: WOODS })).sources).toEqual([{ url: "https://example.org/a", title: "A" }]);
  });
});

describe("digest numbers", () => {
  test("windows", () => {
    expect(weeklyWindows("2026-02-01")).toEqual({ period: { from: "2026-01-25", to: "2026-01-31" }, baseline: { from: "2025-12-28", to: "2026-01-24" } });
    expect(monthlyWindows("2026-03-01")).toEqual({ period: { from: "2026-02-01", to: "2026-02-28" }, baseline: { from: "2025-11-01", to: "2026-01-31" } });
  });

  test("facts are computed in code, with the baseline scaled to the period length", () => {
    const { db } = featureCtx(null);
    seedLibrary(db);
    insertPick(db, Date.parse("2026-01-05T10:00:00Z"));
    insertPick(db, Date.parse("2026-01-11T10:00:00Z"));
    const { period, baseline } = weeklyWindows("2026-01-11");
    const f = digestFacts(db, TZ, period, baseline);
    expect(f.period).toEqual({ from: "2026-01-04", to: "2026-01-10", days: 7 });
    expect(f.baseline.days).toBe(28);
    // 7 days x (200 s + 10 s + 200 s + 5 s) = 2,905 s; baseline 3 days of the same, x 7/28.
    expect(f.totals).toMatchObject({ hours: 0.8, baselineHours: 0.1, listens: 14, baselineListens: 2, uniqueArtists: 2, uniqueSongs: 3, skipRate: 0.5, baselineSkipRate: 0.5 });
    expect(f.topArtists[0]).toEqual({ artist: "Mac Miller", hours: 0.8, baselineHours: 0.1 });
    expect(f.risingArtists.map((a) => a.artist)).toEqual(["Mac Miller"]);
    expect(f.newArtists.count).toBe(0);
    expect(f.skipRateDelta).toBe(0);
    expect(f.assistant).toEqual({ picksMade: 1, picksPlayed: 0, setsBuilt: 0 });
  });
});

function insertPick(db: Db, createdAt: number) {
  db.insert(picks)
    .values({ week: "w", position: 1, uri: uri(`p${createdAt}`), songKey: `k${createdAt}`, name: "n", artist: "a", album: null, releaseDate: null, reason: "r", distance: "near", state: "new", stateAt: 0, createdAt })
    .run();
}

describe("digest", () => {
  test("generated once per period with low effort and no tools, then stored and rendered", async () => {
    const fake = scripted(message([text("A quieter week.")]));
    const { ctx, db } = featureCtx(fake.transport, [], {}, "2026-01-11T08:00:00Z");
    seedLibrary(db);
    const first = await generateDigest(ctx, "weekly");
    expect(first).toMatchObject({ created: true, kind: "weekly", periodKey: "2026-01-10", from: "2026-01-04", to: "2026-01-10", text: "A quieter week." });
    expect(await generateDigest(ctx, "weekly")).toMatchObject({ created: false, id: first.id });
    expect(fake.requests).toHaveLength(1);
    const req = fake.requests[0]!;
    expect(req.tools).toBeUndefined();
    expect(req.output_config).toEqual({ effort: "low" });
    expect(JSON.stringify(req.messages[0])).toContain('\\"listens\\":14');
    expect(renderDigest(db, first.id).rendered).toBe("Your week, 2026-01-04 to 2026-01-10\n\nA quieter week.");
    expect(listDigests(db, "weekly", 10)).toHaveLength(1);
  });

  test("a digest stating numbers outside the facts is rewritten once", async () => {
    const fake = scripted(message([text("**You doubled** your listening: 14 listens, about 7.7 times more.")]), message([text("14 listens, up from 2.")]));
    const { ctx, db } = featureCtx(fake.transport, [], {}, "2026-01-11T08:00:00Z");
    seedLibrary(db);
    const digest = await generateDigest(ctx, "weekly");
    expect(digest).toMatchObject({ text: "14 listens, up from 2.", model: "claude-opus-5-5" });
    expect(fake.requests[1]!.messages.at(-1)!.content).toBe("These numbers are not in the facts: 7.7. Rewrite the digest using only numbers that appear in the facts. Don't compute new ones.");
  });

  test("after a second failure the digest is written from the facts in code", async () => {
    const fake = scripted(message([text("You listened 777 hours.")]), message([text("You listened 778 hours.")]));
    const { ctx, db } = featureCtx(fake.transport, [], {}, "2026-01-11T08:00:00Z");
    seedLibrary(db);
    const digest = await generateDigest(ctx, "weekly");
    expect(digest.model).toBe(CODE_RENDERED);
    expect(digest.text.split("\n")[0]).toBe("0.8 hours of music this week, against 0.1 in a typical week before it.");
    expect(unsupportedNumbers(digest.text, allowedNumbers(digest.facts))).toEqual([]);
    expect(fake.requests).toHaveLength(2);
  });

  test("due on the configured weekday and hour (local), and on the 1st for the monthly recap", () => {
    const { db } = featureCtx(null);
    const slot = { weekday: 5, hour: 9 };
    expect(isDigestDue(db, "weekly", TZ, slot, Date.parse("2026-01-30T05:59:00Z"))).toBe(false);
    expect(isDigestDue(db, "weekly", TZ, slot, Date.parse("2026-01-30T06:00:00Z"))).toBe(true);
    expect(isDigestDue(db, "weekly", TZ, slot, Date.parse("2026-01-29T06:00:00Z"))).toBe(false);
    expect(isDigestDue(db, "monthly", TZ, slot, Date.parse("2026-02-01T06:00:00Z"))).toBe(true);
    expect(isDigestDue(db, "monthly", TZ, slot, Date.parse("2026-02-02T06:00:00Z"))).toBe(false);
  });
});

describe("scheduled LLM jobs", () => {
  const friday11 = "2026-01-30T08:00:00Z";

  test("skip without calling the API once the monthly budget is spent", async () => {
    const fake = scripted();
    const { ctx, db, auth } = featureCtx(fake.transport, [], { MONTHLY_BUDGET_USD: "5" }, friday11);
    seedLibrary(db);
    db.insert(llmCalls)
      .values({ ts: Date.parse(friday11), month: "2026-01", feature: "ask", requestedModel: "m", model: "m", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, usd: 5, stopReason: "end_turn", durationMs: 0 })
      .run();
    const jobs = createAssistantJobs(ctx, auth);
    expect(await jobs.picks.run()).toMatchObject({ skipped: "budget_exceeded", month: "2026-01" });
    expect(await jobs.digest.run()).toMatchObject({ skipped: "budget_exceeded" });
    expect(fake.requests).toHaveLength(0);
  });

  test("a failing picks run is retried once per week, then left alone", async () => {
    const failing = async () => {
      throw new Error("upstream down");
    };
    const { ctx, db, auth } = featureCtx(failing, [], {}, friday11);
    seedLibrary(db);
    const jobs = createAssistantJobs(ctx, auth);
    await expect(jobs.picks.run()).rejects.toThrow("upstream down");
    await expect(jobs.picks.run()).rejects.toThrow("upstream down");
    expect(await jobs.picks.run()).toEqual({ skipped: "attempts_exhausted", week: "2026-01-26" });
  });

  test("picks are not due before the configured slot", async () => {
    const { ctx, auth } = featureCtx(scripted().transport, [], {}, "2026-01-29T08:00:00Z");
    expect(await createAssistantJobs(ctx, auth).picks.run()).toEqual({ skipped: "not_due" });
  });
});
