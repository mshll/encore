import { describe, expect, test } from "bun:test";
import { hours as h } from "../src/analytics/common";
import type { Db } from "../src/db/client";
import { digests, llmCalls } from "../src/db/schema";
import { addAlias } from "../src/artists/aliases";
import { recapFacts } from "../src/digest/facts";
import { RECAP_SCHEMA } from "../src/digest/lines";
import { baselineSpan, coveredSpan, humanDatesIn, latestKey, periodLabel, periodSpan } from "../src/digest/periods";
import { CODE_RENDERED, generateDigest, getDigest, isDigestDue, RecapPeriodError } from "../src/digest/service";
import { recapTimeline } from "../src/digest/timeline";
import { Llm } from "../src/llm/client";
import { createAssistantJobs } from "../src/jobs/assistant";
import { trackNote } from "../src/notes/service";
import { songKey } from "../src/plays/song";
import { play, seed, TZ, uri } from "./helpers";
import { featureCtx, message, scripted, seedLibrary, text, webSearch } from "./llmFakes";

const WOODS = songKey("Woods", "Mac Miller");

describe("notes", () => {
  test("a note is written once per song and then served from the cache, whichever key asks", async () => {
    const fake = scripted(message([...webSearch("woods credits", [{ url: "https://example.org/circles", title: "Circles credits" }]), text("Woods closes the middle of Circles.")]));
    const { ctx, db } = featureCtx(fake.transport);
    seedLibrary(db);
    const first = await trackNote(ctx, { songKey: WOODS });
    expect(first).toMatchObject({ cached: false, text: "Woods closes the middle of Circles.", sources: [{ url: "https://example.org/circles", title: "Circles credits" }] });
    expect(await trackNote(ctx, { songKey: WOODS })).toMatchObject({ cached: true, text: first.text });
    expect(await trackNote(ctx, { uri: uri("w1") })).toMatchObject({ cached: true, songKey: WOODS });
    expect(fake.requests).toHaveLength(1);
    const req = fake.requests[0]!;
    expect([req.webSearch, req.effort]).toEqual([{ maxUses: 4 }, "medium"]);
    expect(JSON.stringify(req.messages[0])).toContain("This song: 20 plays");
    expect(first).toMatchObject({ albumArtUrl: null, artistImageUrl: null });
  });

  test("a provider without web search writes the note without sources", async () => {
    const fake = scripted(message([text("Note.")]));
    const { ctx, db } = featureCtx(fake.transport, [], { AI_PROVIDER: "openai-compatible", AI_BASE_URL: "http://localhost:11434/v1", AI_MODEL: "llama4" });
    seedLibrary(db);
    expect((await trackNote(ctx, { songKey: WOODS })).sources).toEqual([]);
    expect(fake.requests[0]!.webSearch).toBeNull();
  });
});
const lines = (headline: string, takes: Record<string, string> = {}) => message([text(JSON.stringify({ headline, takes: Object.entries(takes).map(([section, t]) => ({ section, text: t })) }))]);

/** January from seedLibrary, plus Woods each day from 2 to 11 February. */
function seedFebruary(db: Db) {
  seed(db, [], Array.from({ length: 10 }, (_, i) => play(`2026-02-${String(i + 2).padStart(2, "0")}T20:00:00Z`, uri("w1"), 200_000, { skipped: false })));
}

describe("recap periods", () => {
  test("a week is the seven days before the recap weekday, a month the calendar month before today", () => {
    expect(latestKey("weekly", "2026-01-30", 5)).toBe("2026-01-29");
    expect(periodSpan("weekly", "2026-01-29")).toEqual({ from: "2026-01-23", to: "2026-01-29" });
    expect(latestKey("monthly", "2026-03-01", 5)).toBe("2026-02");
    expect(periodSpan("monthly", "2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  test("the current year is covered up to yesterday and compared with the same stretch of the year before", () => {
    const covered = coveredSpan("yearly", "2026", "2026-11-15")!;

    expect(covered).toEqual({ from: "2026-01-01", to: "2026-11-14", inProgress: true });
    expect(baselineSpan("yearly", "2026", covered)).toEqual({ from: "2025-01-01", to: "2025-11-14" });
  });

  test("a week or month still going is covered up to yesterday and compared with as many days of the one before", () => {
    const month = coveredSpan("monthly", "2026-11", "2026-11-15")!;
    const week = coveredSpan("weekly", "2026-11-19", "2026-11-15")!;

    expect([month, baselineSpan("monthly", "2026-11", month), week, baselineSpan("weekly", "2026-11-19", week), coveredSpan("monthly", "2026-12", "2026-12-01")] as unknown[]).toEqual([
      { from: "2026-11-01", to: "2026-11-14", inProgress: true },
      { from: "2026-10-01", to: "2026-10-14" },
      { from: "2026-11-13", to: "2026-11-14", inProgress: true },
      { from: "2026-11-06", to: "2026-11-07" },
      null,
    ]);
  });

  test("labels and dates are written for people", () => {
    expect([periodLabel("weekly", "2026-11-13"), periodLabel("weekly", "2026-11-03"), periodLabel("monthly", "2026-10"), periodLabel("yearly", "2026")]).toEqual([
      "7 – 13 Nov 2026",
      "28 Oct – 3 Nov 2026",
      "October 2026",
      "2026",
    ]);
    expect(humanDatesIn("Busiest on 2026-10-22, not 2026-13-45.")).toBe("Busiest on 22 Oct 2026, not 2026-13-45.");
  });
});

describe("recap facts", () => {
  test("totals, artists and songs come from the plays, compared with the period before", () => {
    const { db } = featureCtx(null);
    seedLibrary(db);
    seedFebruary(db);

    const f = recapFacts(db, "monthly", { ...periodSpan("monthly", "2026-02"), inProgress: false }, periodSpan("monthly", "2026-01"));

    expect(f.totals).toMatchObject({ hours: h(2_000_000), listens: 10, artists: 1, songs: 1, before: { hours: h(4_350_000), listens: 21 } });
    expect(f.artists[0]).toMatchObject({ artist: "Mac Miller", hours: h(2_000_000), before: h(4_100_000) });
    expect(f.daily).toHaveLength(28);
    expect(f.finds).toEqual({ songs: { count: 0, ofNew: 0, top: [] }, artists: { count: 0, ofNew: 0, top: [] } });
  });

  test("without earlier history there is no baseline and no finds", () => {
    const { db } = featureCtx(null);
    seedLibrary(db);

    const f = recapFacts(db, "monthly", { ...periodSpan("monthly", "2026-01"), inProgress: false }, null);

    expect([f.baseline, f.totals.before, f.finds, f.movers]).toEqual([null, null, null, { up: [], down: [] }]);
  });
});

describe("recaps", () => {
  test("Claude writes the headline and takes as structured output; the numbers stay in the facts", async () => {
    const fake = scripted(lines("A quieter month, still mostly Mac Miller", { listening: "Much less than January.", artists: "One artist all month." }));
    const { ctx, db } = featureCtx(fake.transport, [], {}, "2026-03-02T08:00:00Z");
    seedLibrary(db);
    seedFebruary(db);

    const recap = await generateDigest(ctx, "monthly");

    expect([fake.requests[0]!.effort, fake.requests[0]!.jsonSchema]).toEqual(["low", RECAP_SCHEMA]);
    expect(recap).toMatchObject({ created: true, periodKey: "2026-02", title: "Your month, February 2026", page: { headline: "A quieter month, still mostly Mac Miller", headlineBy: "claude", compare: { label: "January 2026" } } });
    expect(recap.page.sections.map((s) => [s.id, s.take])).toEqual([
      ["listening", "Much less than January."],
      ["artists", "One artist all month."],
      ["songs", null],
      ["taste", null],
      ["rhythm", null],
    ]);
    expect(recap.text.split("\n").slice(0, 2)).toEqual(["A quieter month, still mostly Mac Miller", "Much less than January. 33 minutes of music, 54% less than January 2026 (1.2 hours), across 1 artist."]);
  });

  test("lines with digits are sent back once, then dropped", async () => {
    const fake = scripted(lines("Up 50%", { listening: "Twice as much." }), lines("Up 50% again", { listening: "About twice as much." }));
    const { ctx, db } = featureCtx(fake.transport, [], {}, "2026-03-02T08:00:00Z");
    seedLibrary(db);
    seedFebruary(db);

    const recap = await generateDigest(ctx, "monthly");

    expect(String(fake.requests[1]!.messages.at(-1)!.content)).toBe("These lines have digits in them: Up 50%. Write them again with no digits; the page shows the numbers.");
    expect(recap.lines).toEqual({ headline: null, takes: { listening: "About twice as much." } });
    expect(recap.page).toMatchObject({ headline: "33 minutes of music, most of it Mac Miller", headlineBy: "facts" });
  });

  test("without Claude the recap is stored with the numbers alone, and gets its words once Claude is there", async () => {
    const { ctx, db } = featureCtx(null, [], {}, "2026-03-02T08:00:00Z");
    seedLibrary(db);
    seedFebruary(db);
    const bare = await generateDigest(ctx, "monthly");
    const fake = scripted(lines("Mostly Mac Miller"));

    const worded = await generateDigest({ ...ctx, llm: new Llm(db, ctx.settings, () => fake.transport, ctx.now) }, "monthly");

    expect([bare.model, bare.lines, bare.page.headlineBy]).toEqual([CODE_RENDERED, null, "facts"]);
    expect([worded.created, worded.id, worded.page.headline]).toEqual([false, bare.id, "Mostly Mac Miller"]);
  });

  test("a period that has not started, or that the history does not reach, cannot be recapped", async () => {
    const { ctx, db } = featureCtx(null, [], {}, "2026-03-02T08:00:00Z");
    seedLibrary(db);

    await expect(generateDigest(ctx, "monthly", "2026-04")).rejects.toBeInstanceOf(RecapPeriodError);
    await expect(generateDigest(ctx, "monthly", "2025-11")).rejects.toBeInstanceOf(RecapPeriodError);
  });

  test("the current year is recapped so far and brought up to date on a later day", async () => {
    const { ctx, db, time } = featureCtx(null, [], {}, "2026-01-15T08:00:00Z");
    seedLibrary(db);
    const first = await generateDigest(ctx, "yearly");
    time.set("2026-02-10T08:00:00Z");
    seedFebruary(db);

    const later = await generateDigest(ctx, "yearly");

    expect([first.to, first.inProgress, first.title]).toEqual(["2026-01-14", true, "Your year so far, 2026"]);
    expect([later.id, later.to, later.page.sections[0]]).toEqual([first.id, "2026-02-09", expect.objectContaining({ listens: 29 })]);
  });

  test("a recap stored before recaps were pages opens as a page, with its text kept and its dates made readable", () => {
    const { db } = featureCtx(null);
    seedLibrary(db);
    const facts = {
      period: { from: "2026-01-01", to: "2026-01-31", days: 31 },
      baseline: { from: "2025-10-01", to: "2025-12-31", days: 92 },
      totals: { hours: 1.2, baselineHours: 0.4, listens: 21, baselineListens: 8, uniqueArtists: 3, uniqueSongs: 4 },
      topArtists: [{ artist: "Mac Miller", hours: 1.1, baselineHours: 0.4 }],
      busiestDay: { day: "2026-01-02", hours: 0.2 },
    };
    const row = db.insert(digests).values({ kind: "monthly", periodKey: "2026-01", fromDay: "2026-01-01", toDay: "2026-01-31", facts, text: "January recap: more Mac Miller.\n\nBusiest on 2026-01-02.", model: "m", createdAt: 0 }).returning().get();

    const recap = getDigest(db, row.id);

    expect(recap.page).toMatchObject({ headline: "January recap: more Mac Miller.", headlineBy: "text", compare: { label: "a typical month before it", scaled: true }, legacyText: "January recap: more Mac Miller.\n\nBusiest on 2 Jan 2026." });
    expect(recap.page.sections.map((s) => s.id)).toEqual(["listening", "artists", "songs", "rhythm"]);
  });

  test("a stored recap's finds keep their artwork when the song's artist now counts as another", () => {
    const { db } = featureCtx(null);
    seed(
      db,
      [
        { uri: uri("k1"), name: "Kite", artist: "Old Name", album: "Sky", albumArtUrl: "https://i.scdn.co/image/kite" },
        { uri: uri("k2"), name: "Lake", artist: "New Name", album: "Sea" },
      ],
      [play("2026-01-03T10:00:00Z", uri("k1"), 200_000), play("2026-01-04T10:00:00Z", uri("k2"), 200_000)],
    );
    addAlias(db, "Old Name", "New Name");
    const facts = { period: { from: "2026-01-01", to: "2026-01-31", days: 31 }, newSongs: { count: 1, top: [{ name: "Kite", artist: "New Name", listens: 1 }] } };
    const row = db.insert(digests).values({ kind: "monthly", periodKey: "2026-01", fromDay: "2026-01-01", toDay: "2026-01-31", facts, text: "January.", model: "m", createdAt: 0 }).returning().get();

    const finds = sectionOf(getDigest(db, row.id), "finds") as { songs: { top: { albumArtUrl: string | null }[] } };

    expect(finds.songs.top.map((s) => s.albumArtUrl)).toEqual(["https://i.scdn.co/image/kite"]);
  });

  test("due on the recap weekday and hour (local), on the 1st for the month and on 1 January for the year", () => {
    const { db } = featureCtx(null);
    const slot = { weekday: 5, hour: 9 };

    const due = (kind: "weekly" | "monthly" | "yearly", iso: string) => isDigestDue(db, kind, TZ, slot, Date.parse(iso));

    expect([due("weekly", "2026-01-30T05:59:00Z"), due("weekly", "2026-01-30T06:00:00Z"), due("weekly", "2026-01-29T06:00:00Z")]).toEqual([false, true, false]);
    expect([due("monthly", "2026-02-01T06:00:00Z"), due("monthly", "2026-02-02T06:00:00Z"), due("yearly", "2026-01-01T06:00:00Z"), due("yearly", "2026-01-02T06:00:00Z")]).toEqual([true, false, true, false]);
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
    expect(await jobs.digest.run()).toEqual({ generated: ["weekly:2026-01-29"] });
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

const sectionOf = <K extends string>(recap: { page: { sections: { id: string }[] } }, id: K) => recap.page.sections.find((s) => s.id === id) as Record<string, unknown> | undefined;

describe("recap sections from the insights", () => {
  test("a period's records, milestones and longest run of days come from the facts", async () => {
    const { ctx, db } = featureCtx(null, [], {}, "2026-03-02T08:00:00Z");
    seedLibrary(db);
    seedFebruary(db);
    seed(db, [], Array.from({ length: 20 }, (_, i) => play(`2026-02-15T${String(i + 1).padStart(2, "0")}:00:00Z`, uri("w1"), 200_000, { skipped: false })));

    const recap = await generateDigest(ctx, "monthly", "2026-02");

    const records = sectionOf(recap, "records") as { records: { record: string }[]; milestones: { kind: string; threshold: number }[] };
    const rhythm = sectionOf(recap, "rhythm") as { streak: { days: number } };
    expect([records.records.map((r) => r.record), records.milestones.map((m) => [m.kind, m.threshold]), rhythm.streak.days]).toEqual([["day", "songDay", "week", "month"], [["song", 25]], 10]);
  });

  test("a year is compared with the year before, in place of the genre shift", async () => {
    const { ctx, db } = featureCtx(null, [], {}, "2026-03-02T08:00:00Z");
    seedLibrary(db);
    seed(db, [], [play("2025-06-01T20:00:00Z", uri("s1"), 200_000), play("2025-06-02T20:00:00Z", uri("s1"), 200_000)]);

    const recap = await generateDigest(ctx, "yearly", "2026");

    const years = sectionOf(recap, "years") as { a: { year: number }; b: { year: number }; artists: { artist: string }[] };
    expect([years.a.year, years.b.year, years.artists[0]!.artist, sectionOf(recap, "taste")]).toEqual([2025, 2026, "Mac Miller", undefined]);
  });

  test("the year against the year before is kept with the recap, so later plays do not change it", async () => {
    const { ctx, db } = featureCtx(null, [], {}, "2026-03-02T08:00:00Z");
    seedLibrary(db);
    seed(db, [], [play("2025-06-01T20:00:00Z", uri("s1"), 200_000)]);
    const recap = await generateDigest(ctx, "yearly", "2026");
    seed(db, [], [play("2025-06-03T20:00:00Z", uri("s1"), 200_000), play("2025-06-04T20:00:00Z", uri("s1"), 200_000)]);

    const years = sectionOf(getDigest(db, recap.id), "years") as { a: { plays: number } };

    expect(years.a.plays).toBe(1);
  });
});

describe("recap timeline", () => {
  test("the month still going comes first, then each year with its months and weeks, each with its hours against the period before", async () => {
    const { ctx, db } = featureCtx(null, [], {}, "2026-03-18T08:00:00Z");
    seedLibrary(db);
    seedFebruary(db);
    await generateDigest(ctx, "monthly", "2026-02");

    const t = recapTimeline(db, "2026-03-18", 5);

    const year = t.years[0]!;
    expect(t.current.month).toMatchObject({ key: "2026-03", from: "2026-03-01", to: "2026-03-17", inProgress: true, hours: 0 });
    expect(year.months.map((m) => [m.month.key, m.month.hours, m.month.before, m.month.recap?.headline ?? null, m.month.recap?.topArtist ?? null])).toEqual([
      ["2026-02", h(2_000_000), h(4_350_000), null, "Mac Miller"],
      ["2026-01", h(4_350_000), null, null, null],
    ]);
    expect(year.months[0]!.weeks.map((w) => w.key)).toEqual(["2026-02-26", "2026-02-19", "2026-02-12", "2026-02-05"]);
  });

  test("a week recapped under an earlier recap weekday keeps its place among the weeks", async () => {
    const { ctx, db } = featureCtx(null, [], {}, "2026-03-18T08:00:00Z");
    seedLibrary(db);
    seedFebruary(db);
    await generateDigest(ctx, "weekly", "2026-02-08");

    const t = recapTimeline(db, "2026-03-18", 5);

    expect(t.years[0]!.months[0]!.weeks.map((w) => [w.key, w.recap !== null])).toEqual([
      ["2026-02-26", false],
      ["2026-02-19", false],
      ["2026-02-12", false],
      ["2026-02-08", true],
      ["2026-02-05", false],
    ]);
  });

  test("an empty history has no periods", () => {
    const { db } = featureCtx(null);

    const t = recapTimeline(db, "2026-03-18", 5);

    expect(t).toEqual({ historyStart: null, current: { week: null, month: null, weeks: [] }, years: [] });
  });
});
