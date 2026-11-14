import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { ask, getAskThread, ThreadNotFoundError } from "../src/ask/service";
import { queryPlays, queryPlaysInput } from "../src/ask/query";
import { askTools } from "../src/ask/tools";
import type { Db } from "../src/db/client";
import { llmCalls, passkeys, sessions } from "../src/db/schema";
import { createThread } from "../src/llm/threads";
import { songKey } from "../src/plays/song";
import { featureCtx, message, scripted, seedLibrary, text, toolCall, toolResults } from "./llmFakes";
import { WEEKEND } from "./helpers";

const FORBIDDEN = ["spotify_auth", "sessions", "passkeys", "oauth_states", "llm_calls", "llm_threads"];

function snapshot(db: Db) {
  const tables = db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`).map((t) => t.name);
  return Object.fromEntries(tables.map((t) => [t, db.all<{ n: number }>(sql.raw(`select count(*) as n from "${t}"`))[0]!.n]));
}

function seedSecrets(db: Db) {
  db.insert(sessions).values({ idHash: "sess-secret", createdAt: 0, expiresAt: 9e15 }).run();
  db.insert(passkeys).values({ id: "pk", publicKey: "pk-secret", counter: 0, createdAt: 0 }).run();
  db.insert(llmCalls).values({ ts: 0, month: "2026-01", feature: "ask", requestedModel: "m", model: "m", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, usd: 1, stopReason: "end_turn", durationMs: 1 } as never).run();
}

/** Records every statement bun:sqlite prepares while `fn` runs. */
async function traceSql(db: Db, fn: () => unknown) {
  const client = db.$client;
  const seen: string[] = [];
  const prepare = client.prepare.bind(client);
  const query = client.query.bind(client);
  client.prepare = ((s: string, ...rest: unknown[]) => {
    seen.push(s);
    return prepare(s, ...(rest as []));
  }) as typeof client.prepare;
  client.query = ((s: string) => {
    seen.push(s);
    return query(s);
  }) as typeof client.query;
  try {
    await fn();
  } finally {
    client.prepare = prepare;
    client.query = query;
  }
  return seen;
}

const INJECTIONS = [
  "x'); drop table plays; --",
  "' union select access_token, refresh_token, 1, 1, 1 from spotify_auth --",
  "%' or 1=1 --",
  "\\",
];

const WOODS = songKey("Woods", "Mac Miller");

const VALID_INPUTS: Record<string, unknown> = {
  query_plays: { groupBy: ["artist", "genre", "hourBucket"], metrics: ["plays", "skipRate", "firstPlayed"], orderBy: "skipRate" },
  overview: { from: "2026-01-01", to: "2026-01-31" },
  top: { kind: "songs", weekday: 4 },
  artist_history: { artist: "Mac Miller" },
  song_history: { songKey: WOODS },
  search_library: { q: "mac" },
  skip_split: {},
  forgotten: { days: 7 },
  on_this_day: { date: "2027-01-05" },
  eras: {},
  tag_trends: { tag: "moods" },
  energy_by_hour: {},
  trips: {},
};

describe("ask tools are read-only and scoped to listening data", () => {
  test("every tool runs, writes nothing, and never touches auth, session, passkey, token or ledger tables", async () => {
    const { db } = featureCtx(null);
    seedLibrary(db);
    seedSecrets(db);
    const tools = askTools(db, { homeCountry: "KW", weekendDays: WEEKEND }, Date.parse("2026-02-01T00:00:00Z"));
    const runTool = (name: string, input: unknown) => {
      const t = tools.find((x) => x.name === name)!;
      return (t.run as (i: unknown) => unknown)(t.schema.parse(input));
    };
    expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(VALID_INPUTS).sort());
    const before = snapshot(db);
    const statements = await traceSql(db, async () => {
      for (const t of tools) {
        const out = await runTool(t.name, VALID_INPUTS[t.name]);
        expect(JSON.stringify(out)).not.toContain("sess-secret");
      }
      for (const bad of INJECTIONS) {
        queryPlays(db, queryPlaysInput.parse({ text: bad, artists: [bad], songKeys: [bad], groupBy: ["song"] }), WEEKEND);
        await runTool("search_library", { q: bad });
        await runTool("artist_history", { artist: bad });
      }
    });
    expect(snapshot(db)).toEqual(before);
    expect(statements.length).toBeGreaterThan(20);
    for (const s of statements) {
      expect(s.trim()).toMatch(/^(select|with)\b/i);
      for (const table of FORBIDDEN) expect(s).not.toMatch(new RegExp(`\\b${table}\\b`));
    }
  });

  test("injected text is a bound value: it matches nothing and returns no secrets", () => {
    const { db } = featureCtx(null);
    seedLibrary(db);
    for (const bad of INJECTIONS) {
      const r = queryPlays(db, queryPlaysInput.parse({ text: bad, groupBy: ["song"] }), WEEKEND);
      expect(r.rows).toEqual([]);
    }
    expect(queryPlays(db, queryPlaysInput.parse({ text: "woo" }), WEEKEND).rows as unknown[]).toEqual([{ plays: 20, listens: 10, hours: 0.58 }]);
  });

  test("group, metric and order keys outside the whitelist are rejected before any SQL is built", () => {
    const bad = [
      { groupBy: ["access_token"] },
      { groupBy: ["artist", "song", "album", "day"] },
      { metrics: ["count(*); drop table plays"] },
      { orderBy: "1; drop table plays" },
      { order: "desc; drop table plays" },
      { limit: 100_000 },
      { table: "spotify_auth" },
    ];
    for (const input of bad) expect(queryPlaysInput.safeParse(input).success).toBe(false);
  });

  test("no source behind an ask tool names a forbidden table", () => {
    const root = join(import.meta.dir, "../src");
    const files = ["ask/tools.ts", "ask/query.ts", ...readdirSync(join(root, "analytics")).map((f) => `analytics/${f}`)];
    for (const file of files) {
      const source = readFileSync(join(root, file), "utf8");
      for (const table of [...FORBIDDEN, "spotifyAuth", "llmCalls", "llmThreads", "oauthStates"]) expect(source).not.toMatch(new RegExp(`\\b${table}\\b`));
    }
  });
});

describe("ask", () => {
  test("answers with tools, stores the thread, and continues it on a follow-up", async () => {
    const fake = scripted(
      toolCall("query_plays", { artists: ["Mac Miller"], groupBy: ["song"] }),
      message([text("Woods: 20 plays.")]),
      message([text("Surf: 10.")]),
    );
    const { ctx, db } = featureCtx(fake.transport);
    seedLibrary(db);
    const first = await ask(ctx, "what do I play most?", null);
    expect(first).toMatchObject({ answer: "Woods: 20 plays.", toolCalls: [{ name: "query_plays" }] });
    const [result] = toolResults(fake.requests[1]!);
    expect(result!.value.ref).toBe("r1");
    expect(((result!.value.result as { rows: { name: string }[] }).rows).map((r) => r.name)).toEqual(["Woods", "Surf"]);
    expect(fake.requests[0]!.tool_choice).toBeUndefined();

    const second = await ask(ctx, "and Surf?", first.threadId);
    expect(second.threadId).toBe(first.threadId);
    expect(fake.requests[2]!.system).toEqual(fake.requests[0]!.system);
    expect(fake.requests[2]!.messages.slice(0, 3)).toEqual(fake.requests[1]!.messages);
    const thread = getAskThread(db, first.threadId);
    expect(thread.turns.map((t) => t.role)).toEqual(["owner", "assistant", "owner", "assistant"]);
  });

  test("a thread is titled by its first question", async () => {
    const { ctx, db } = featureCtx(scripted(message([text("Woods.")])).transport);
    const first = await ask(ctx, "Who did I play most?", null);

    const thread = getAskThread(db, first.threadId);

    expect(thread.title).toBe("Who did I play most?");
  });

  test("a thread from another feature cannot be continued", async () => {
    const { ctx, db } = featureCtx(scripted().transport);
    const setThread = createThread(db, "sets", ["s"], [], 0);
    await expect(ask(ctx, "q", setThread)).rejects.toBeInstanceOf(ThreadNotFoundError);
  });
});
