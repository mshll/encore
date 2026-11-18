import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { runAgent, tool, ToolError } from "../src/llm/agent";
import { Llm } from "../src/llm/client";
import { callCost } from "../src/llm/cost";
import { LlmAbortedError, LlmBudgetExceededError, LlmNotConfiguredError, LlmRefusalError, LlmTruncatedError } from "../src/llm/errors";
import { budgetStatus, monthSpend, spendByFeature } from "../src/llm/ledger";
import { KNOWN_MODELS, priceFor } from "../src/llm/providers";
import { sdkConnect } from "../src/llm/sdk";
import type { LlmTransport, ToolResultPart } from "../src/llm/types";
import { testConfig, testDb, testSettings } from "./helpers";
import { featureCtx, message, scripted, text, toolCall, toolUse, usage } from "./llmFakes";

const callInput = { feature: "ask" as const, system: ["s"], messages: [{ role: "user" as const, content: "q" }], effort: "low" as const, maxTokens: 100 };

describe("cost", () => {
  test("prices input, output, cache reads, cache writes and web searches", () => {
    const price = KNOWN_MODELS["claude-opus-5-5"]!.price;
    const cost = callCost(usage({ inputTokens: 1_000, outputTokens: 2_000, cacheReadTokens: 10_000, cacheWriteTokens: 3_000, webSearches: 3 }), price, 0.01);
    expect(cost.usd).toBeCloseTo((1_000 * 4 + 2_000 * 20 + 10_000 * 0.2 + 3_000 * 5) / 1e6 + 0.03, 10);
    expect(cost).toMatchObject({ inputTokens: 1_000, outputTokens: 2_000, cacheReadTokens: 10_000, cacheWriteTokens: 3_000, webSearches: 3 });
  });

  test("LLM_PRICES overrides a model's price, in the old format too", async () => {
    const { ctx } = featureCtx(scripted(message([text("hi")])).transport, [], { LLM_PRICES: JSON.stringify({ "claude-opus-5-5": { input: 1, output: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1 } }) });
    await ctx.llm.call(callInput);
    expect(monthSpend(ctx.db, "2026-02")).toBeCloseTo(1_100 / 1e6, 10);
  });

  test("an unknown model is charged at the price the owner entered", async () => {
    const { ctx } = featureCtx(scripted(message([text("hi")], undefined, { model: "mystery-1" })).transport, [], {
      AI_PROVIDER: "openai",
      AI_MODEL: "mystery-1",
      AI_INPUT_PRICE: "2",
      AI_OUTPUT_PRICE: "8",
    });
    await ctx.llm.call(callInput);
    expect(monthSpend(ctx.db, "2026-02")).toBeCloseTo((1_000 * 2 + 100 * 8) / 1e6, 10);
  });

  test("an unknown hosted model with no entered price is charged at its provider's highest known rate", () => {
    const { price, source } = priceFor(KNOWN_MODELS, "google", "gemini-unknown", null);
    const googleOutputs = Object.values(KNOWN_MODELS).filter((m) => m.provider === "google").map((m) => m.price.output);
    expect([source, price.output]).toEqual(["highest", Math.max(...googleOutputs)]);
  });

  test("a local model with no price costs nothing, and its tokens are still recorded", async () => {
    const { ctx } = featureCtx(scripted(message([text("hi")], undefined, { model: "llama4" })).transport, [], {
      AI_PROVIDER: "openai-compatible",
      AI_BASE_URL: "http://localhost:11434/v1",
      AI_MODEL: "llama4",
    });
    await ctx.llm.call(callInput);
    expect(spendByFeature(ctx.db, "2026-02")[0]).toMatchObject({ calls: 1, usd: 0, inputTokens: 1000, outputTokens: 100 });
  });
});

describe("ledger and budget", () => {
  test("every call is recorded with feature, model, tokens and cost", async () => {
    const { ctx } = featureCtx(scripted(message([text("one")]), message([text("two")])).transport);
    await ctx.llm.call({ ...callInput, ref: "thread:1" });
    await ctx.llm.call({ ...callInput, feature: "digest" });
    const byFeature = spendByFeature(ctx.db, "2026-02");
    expect(byFeature.map((f) => f.feature).sort()).toEqual(["ask", "digest"]);
    expect(byFeature[0]).toMatchObject({ calls: 1, inputTokens: 1000, outputTokens: 100, usd: 0.006 });
  });

  test("once the month's spend reaches the cap, calls refuse without reaching the provider", async () => {
    const fake = scripted(message([text("a")], "end", { usage: usage({ inputTokens: 0, outputTokens: 50_000 }) }));
    const { ctx } = featureCtx(fake.transport, [], { MONTHLY_BUDGET_USD: "1" });
    await ctx.llm.call(callInput);
    expect(budgetStatus(ctx.db, ctx.settings.get().timezone, 1, ctx.now())).toMatchObject({ spentUsd: 1, exhausted: true, remainingUsd: 0 });
    await expect(ctx.llm.call(callInput)).rejects.toBeInstanceOf(LlmBudgetExceededError);
    expect(fake.requests).toHaveLength(1);
  });

  test("the cap is per local month: last month's spend does not count", async () => {
    const fake = scripted(message([text("a")], "end", { usage: usage({ inputTokens: 0, outputTokens: 50_000 }) }), message([text("b")]));
    const { ctx, time } = featureCtx(fake.transport, [], { MONTHLY_BUDGET_USD: "1" }, "2026-01-31T20:00:00Z");
    await ctx.llm.call(callInput);
    time.set("2026-01-31T21:30:00Z");
    expect(budgetStatus(ctx.db, ctx.settings.get().timezone, 1, ctx.now()).month).toBe("2026-02");
    await ctx.llm.call(callInput);
    expect(fake.requests).toHaveLength(2);
  });

  test("no provider is a typed error", () => {
    const { ctx } = featureCtx(null);
    expect(() => ctx.llm.assertAvailable()).toThrow(LlmNotConfiguredError);
  });

  test("a refusal is recorded and raised", async () => {
    const { ctx } = featureCtx(scripted(message([], "refusal")).transport);
    await expect(ctx.llm.call(callInput)).rejects.toBeInstanceOf(LlmRefusalError);
    expect(spendByFeature(ctx.db, "2026-02")[0]?.calls).toBe(1);
  });

  test("cancelling stops the request and makes no further call", async () => {
    const cancel = new AbortController();
    let calls = 0;
    const transport: LlmTransport = async () => {
      calls++;
      cancel.abort();
      throw new Error("aborted");
    };
    const { ctx } = featureCtx(transport);
    await expect(ctx.llm.withSignal(cancel.signal).call(callInput)).rejects.toBeInstanceOf(LlmAbortedError);
    await expect(ctx.llm.withSignal(cancel.signal).call(callInput)).rejects.toBeInstanceOf(LlmAbortedError);
    expect(calls).toBe(1);
  });
});

describe("provider settings", () => {
  const llmFor = (env: Record<string, string>) => {
    const db = testDb();
    const settings = testSettings(db, testConfig(env));
    return { settings, llm: new Llm(db, settings, sdkConnect()) };
  };

  test("ANTHROPIC_API_KEY and LLM_MODEL configure Anthropic when the AI fields are unset", () => {
    const { settings, llm } = llmFor({ ANTHROPIC_API_KEY: "sk-ant-test-key", LLM_MODEL: "claude-sonnet-5-5", MONTHLY_BUDGET_USD: "7" });
    expect(settings.get().llm.ai).toMatchObject({ provider: "anthropic", apiKey: "sk-ant-test-key", model: "claude-sonnet-5-5", webSearch: true });
    expect([llm.configured, settings.get().llm.monthlyBudgetUsd]).toEqual([true, 7]);
  });

  test("the AI fields win over the old Anthropic ones, and an Anthropic key does not carry to another provider", () => {
    expect(llmFor({ ANTHROPIC_API_KEY: "sk-ant-test-key", AI_API_KEY: "sk-new" }).settings.get().llm.ai.apiKey).toBe("sk-new");
    const other = llmFor({ ANTHROPIC_API_KEY: "sk-ant-test-key", AI_PROVIDER: "openai" });
    expect([other.settings.get().llm.ai.apiKey, other.settings.get().llm.ai.model, other.llm.configured]).toEqual([undefined, "gpt-6.2-sol", false]);
  });

  test("an OpenAI-compatible server needs a base URL and a model, not a key, and has no web search", () => {
    expect(llmFor({ AI_PROVIDER: "openai-compatible", AI_BASE_URL: "http://localhost:1234/v1" }).llm.configured).toBe(false);
    const local = llmFor({ AI_PROVIDER: "openai-compatible", AI_BASE_URL: "http://localhost:1234/v1", AI_MODEL: "qwen3" });
    expect([local.llm.configured, local.llm.webSearch]).toEqual([true, false]);
  });
});

describe("request shape", () => {
  test("model, effort, system prompt and tool schemas reach the transport; web search only when asked for", async () => {
    const fake = scripted(message([text("ok")]), message([text("ok")]));
    const { ctx } = featureCtx(fake.transport);
    const echo = tool({ name: "echo", description: "Echo", schema: z.strictObject({ v: z.string().max(5), n: z.number().min(1).optional() }), run: (i) => i });
    await runAgent(ctx.llm, { feature: "ask", system: ["rules", "profile"], tools: [echo], messages: [{ role: "user", content: "q" }], effort: "medium" });
    await runAgent(ctx.llm, { feature: "picks", system: ["s"], tools: [], webSearch: { maxUses: 3 }, messages: [{ role: "user", content: "q" }], effort: "high" });
    const [first, second] = fake.requests;
    expect(first).toMatchObject({ model: "claude-opus-5-5", effort: "medium", system: ["rules", "profile"], webSearch: null, maxTokens: 64_000 });
    expect(first!.tools).toEqual([
      { name: "echo", description: "Echo", inputSchema: { type: "object", properties: { v: { type: "string" }, n: { type: "number" } }, required: ["v"], additionalProperties: false } },
    ]);
    expect(second!.webSearch).toEqual({ maxUses: 3 });
  });
});

describe("agent loop", () => {
  test("runs tools, returns invalid input and tool errors to the model, and continues paused turns", async () => {
    const fake = scripted(message([toolUse("add", { a: 1, b: 2 }), toolUse("add", { a: "x" }), toolUse("fail", {})]), message([text("searching")], "pause"), message([text("3")]));
    const { ctx } = featureCtx(fake.transport);
    const add = tool({ name: "add", description: "Add", schema: z.strictObject({ a: z.number(), b: z.number() }), run: ({ a, b }) => ({ sum: a + b }) });
    const fail = tool({
      name: "fail",
      description: "Fail",
      schema: z.strictObject({}),
      run: () => {
        throw new ToolError("no data");
      },
    });
    const messages = [{ role: "user" as const, content: "q" }];
    const result = await runAgent(ctx.llm, { feature: "ask", system: ["s"], tools: [add, fail], messages, effort: "low" });
    const second = fake.requests[1]!.messages.at(-1)!.content as ToolResultPart[];
    expect(JSON.parse(second[0]!.content)).toEqual({ sum: 3 });
    expect([second[0]!.name, second[1]!.isError]).toEqual(["add", true]);
    expect(second[1]!.content).toContain("INVALID_INPUT");
    expect(second[2]).toMatchObject({ isError: true, content: "no data" });
    expect(result.calls).toBe(3);
    expect(fake.requests[2]!.messages.at(-1)!.role).toBe("assistant");
    expect(messages).toHaveLength(5);
  });

  test("a tool call cut off at max_tokens is never run", async () => {
    let ran = false;
    const fake = scripted(message([toolUse("go", {})], "max_tokens"));
    const { ctx } = featureCtx(fake.transport);
    const go = tool({ name: "go", description: "Go", schema: z.strictObject({}), run: () => (ran = true) });
    await expect(runAgent(ctx.llm, { feature: "ask", system: ["s"], tools: [go], messages: [{ role: "user", content: "q" }], effort: "low" })).rejects.toBeInstanceOf(LlmTruncatedError);
    expect(ran).toBe(false);
  });

  test("a terminal tool that accepts ends the loop", async () => {
    const fake = scripted(toolCall("done", { ok: true }), message([text("never requested")]));
    const { ctx } = featureCtx(fake.transport);
    const done = tool({ name: "done", description: "Done", schema: z.strictObject({ ok: z.boolean() }), terminal: true, run: () => ({ accepted: true }) });
    const result = await runAgent(ctx.llm, { feature: "ask", system: ["s"], tools: [done], messages: [{ role: "user", content: "q" }], effort: "low" });
    expect(result.terminal).toEqual({ accepted: true });
    expect(fake.remaining()).toBe(1);
  });
});
