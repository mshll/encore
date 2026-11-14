import { describe, expect, test } from "bun:test";
import { askText, createSetFromText, currentPicks, latestDigest, updatePickState } from "../src/assistant/api";
import { picks } from "../src/db/schema";
import { generateDigest } from "../src/digest/service";
import { listBlocks } from "../src/library/blocks";
import { weekOf } from "../src/picks/service";
import { songKey } from "../src/plays/song";
import { TZ, uri } from "./helpers";
import { featureCtx, message, scripted, seedLibrary, text, toolCall } from "./llmFakes";

describe("chat entry points", () => {
  test("createSetFromText returns a summary with one line per track", async () => {
    const fake = scripted(toolCall("submit_set", { title: "Night", description: "d", items: [{ source: "library", songKey: songKey("Woods", "Mac Miller"), reason: "Finished at night." }] }));
    const { ctx, db } = featureCtx(fake.transport);
    seedLibrary(db);
    expect(await createSetFromText(ctx, "night")).toEqual({ id: 1, title: "Night", description: "d", tracks: 1, newTracks: 0, lines: ["1. Woods - Mac Miller: Finished at night."], reply: null });
  });

  test("askText returns plain text and the thread to continue", async () => {
    const { ctx, db } = featureCtx(scripted(message([text("## Answer\n\nYou played **Woods** 20 times.")])).transport);
    seedLibrary(db);
    expect(await askText(ctx, "top song?")).toEqual({ threadId: 1, text: "Answer\n\nYou played Woods 20 times." });
  });

  test("currentPicks reads this week without calling Claude; updatePickState applies blocks", async () => {
    const fake = scripted();
    const { ctx, db } = featureCtx(fake.transport);
    const week = weekOf(ctx.now(), TZ);
    const row = db
      .insert(picks)
      .values({ week, position: 1, uri: uri("p1"), songKey: "song|artist", name: "Song", artist: "Artist", album: null, releaseDate: null, reason: "r", distance: "near", state: "new", stateAt: 0, createdAt: ctx.now() })
      .returning()
      .get();
    const current = await currentPicks(ctx);
    expect(current.week).toBe(week);
    expect(current.picks.map((p) => p.name)).toEqual(["Song"]);
    expect(updatePickState(ctx, row.id, "never")).toMatchObject({ id: row.id, state: "never", albumArtUrl: null, artistImageUrl: null });
    expect(listBlocks(db).map((b) => b.key)).toEqual(["song|artist"]);
    expect(fake.requests).toHaveLength(0);
  });

  test("latestDigest returns the newest rendered digest, or null", async () => {
    const { ctx, db } = featureCtx(scripted(message([text(JSON.stringify({ headline: "A quiet week", takes: [] }))])).transport, [], {}, "2026-01-11T08:00:00Z");
    seedLibrary(db);
    expect(latestDigest(db)).toBeNull();
    await generateDigest(ctx, "weekly");
    expect(latestDigest(db)?.rendered.split("\n").slice(0, 3)).toEqual(["Your week, 2 – 8 Jan 2026", "", "A quiet week"]);
    expect(latestDigest(db, "monthly")).toBeNull();
  });
});
