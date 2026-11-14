import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { DEFAULT_PRICES } from "../src/config";
import { echoable, runAgent, tool, ToolError } from "../src/llm/agent";
import { callCost } from "../src/llm/cost";
import { LlmBudgetExceededError, LlmNotConfiguredError, LlmRefusalError, LlmTruncatedError } from "../src/llm/errors";
import { budgetStatus, monthSpend, spendByFeature } from "../src/llm/ledger";
import { featureCtx, message, scripted, text, toolCall, toolUse, usage } from "./llmFakes";

const prices = DEFAULT_PRICES;

describe("cost", () => {
  test("prices input, output, 5m and 1h cache writes, cache reads and web searches", () => {
    const cost = callCost(
      usage({
        input_tokens: 1_000,
        output_tokens: 2_000,
        cache_read_input_tokens: 10_000,
        cache_creation_input_tokens: 3_000,
        cache_creation: { ephemeral_5m_input_tokens: 2_000, ephemeral_1h_input_tokens: 1_000 },
        server_tool_use: { web_search_requests: 3, web_fetch_requests: 0 },
      }),
      "claude-opus-5-5",
      prices,
      0.01,
    );
    const expected = (1_000 * 4 + 2_000 * 20 + 10_000 * 0.2 + 2_000 * 5 + 1_000 * 8) / 1e6 + 0.03;
    expect(cost.usd).toBeCloseTo(expected, 10);
    expect(cost).toMatchObject({ inputTokens: 1_000, outputTokens: 2_000, cacheReadTokens: 10_000, cacheWriteTokens: 3_000, webSearches: 3 });
  });

  test("a fallback attempt is priced at the fallback model's rates", () => {
    const cost = callCost(
      usage({
        input_tokens: 500,
        output_tokens: 50,
        iterations: [
          { type: "message", model: null, input_tokens: 1_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
          { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
        ],
      }),
      "claude-opus-5-5",
      prices,
      0.01,
    );
    expect(cost.usd).toBeCloseTo((1_000 * 4 + 500 * 5 + 50 * 25) / 1e6, 10);
    expect(cost.inputTokens).toBe(1_500);
  });

  test("LLM_PRICES overrides a model's price", async () => {
    const { ctx } = featureCtx(scripted(message([text("hi")])).transport, [], { LLM_PRICES: JSON.stringify({ "claude-opus-5-5": { input: 1, output: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1 } }) });
    await ctx.llm.call({ feature: "ask", system: ["s"], messages: [{ role: "user", content: "q" }], effort: "low", maxTokens: 100 });
    expect(monthSpend(ctx.db, "2026-02")).toBeCloseTo(1_100 / 1e6, 10);
  });
});

describe("ledger and budget", () => {
  test("every call is recorded with feature, model, tokens and cost", async () => {
    const { ctx } = featureCtx(scripted(message([text("one")]), message([text("two")])).transport);
    await ctx.llm.call({ feature: "ask", ref: "thread:1", system: ["s"], messages: [{ role: "user", content: "q" }], effort: "low", maxTokens: 100 });
    await ctx.llm.call({ feature: "digest", system: ["s"], messages: [{ role: "user", content: "q" }], effort: "low", maxTokens: 100 });
    const byFeature = spendByFeature(ctx.db, "2026-02");
    expect(byFeature.map((f) => f.feature).sort()).toEqual(["ask", "digest"]);
    expect(byFeature[0]).toMatchObject({ calls: 1, inputTokens: 1000, outputTokens: 100, usd: 0.006 });
  });

  test("once the month's spend reaches the cap, calls refuse without reaching the API", async () => {
    const fake = scripted(message([text("a")], "end_turn", { usage: usage({ input_tokens: 0, output_tokens: 50_000 }) }));
    const { ctx } = featureCtx(fake.transport, [], { MONTHLY_BUDGET_USD: "1" });
    await ctx.llm.call({ feature: "ask", system: ["s"], messages: [{ role: "user", content: "q" }], effort: "low", maxTokens: 100 });
    expect(budgetStatus(ctx.db, ctx.config.timezone, 1, ctx.now())).toMatchObject({ spentUsd: 1, exhausted: true, remainingUsd: 0 });
    const call = ctx.llm.call({ feature: "ask", system: ["s"], messages: [{ role: "user", content: "q" }], effort: "low", maxTokens: 100 });
    await expect(call).rejects.toBeInstanceOf(LlmBudgetExceededError);
    expect(fake.requests).toHaveLength(1);
  });

  test("the cap is per local month: last month's spend does not count", async () => {
    const fake = scripted(message([text("a")], "end_turn", { usage: usage({ input_tokens: 0, output_tokens: 50_000 }) }), message([text("b")]));
    const { ctx, time } = featureCtx(fake.transport, [], { MONTHLY_BUDGET_USD: "1" }, "2026-01-31T20:00:00Z");
    await ctx.llm.call({ feature: "ask", system: ["s"], messages: [{ role: "user", content: "q" }], effort: "low", maxTokens: 100 });
    time.set("2026-01-31T21:30:00Z");
    expect(budgetStatus(ctx.db, ctx.config.timezone, 1, ctx.now()).month).toBe("2026-02");
    await ctx.llm.call({ feature: "ask", system: ["s"], messages: [{ role: "user", content: "q" }], effort: "low", maxTokens: 100 });
    expect(fake.requests).toHaveLength(2);
  });

  test("a missing API key is a typed error", () => {
    const { ctx } = featureCtx(null);
    expect(() => ctx.llm.assertAvailable()).toThrow(LlmNotConfiguredError);
  });

  test("a refusal is recorded and raised", async () => {
    const fake = scripted(message([], "refusal", { stop_details: { type: "refusal", category: "cyber", explanation: null } } as never));
    const { ctx } = featureCtx(fake.transport);
    const call = ctx.llm.call({ feature: "ask", system: ["s"], messages: [{ role: "user", content: "q" }], effort: "low", maxTokens: 100 });
    await expect(call).rejects.toBeInstanceOf(LlmRefusalError);
    await call.catch(() => {});
    expect(spendByFeature(ctx.db, "2026-02")[0]?.calls).toBe(1);
  });
});

describe("request shape", () => {
  test("adaptive thinking, explicit effort, fallbacks, cached system prefix and streamed tool inputs", async () => {
    const fake = scripted(message([text("ok")]));
    const { ctx } = featureCtx(fake.transport);
    const echo = tool({ name: "echo", description: "Echo", schema: z.strictObject({ v: z.string().max(5), n: z.number().min(1).optional() }), run: (i) => i });
    await runAgent(ctx.llm, { feature: "ask", system: ["rules", "profile"], tools: [echo], messages: [{ role: "user", content: "q" }], effort: "medium" });
    const req = fake.requests[0]!;
    expect(req).toMatchObject({
      model: "claude-opus-5-5",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      betas: expect.arrayContaining(["server-side-fallback-2026-07-01"]),
    });
    expect(req.tool_choice).toBeUndefined();
    expect(req.system).toEqual([
      { type: "text", text: "rules" },
      { type: "text", text: "profile", cache_control: { type: "ephemeral" } },
    ]);
    expect(req.tools![0]).toEqual({
      name: "echo",
      description: "Echo",
      eager_input_streaming: true,
      input_schema: { type: "object", properties: { v: { type: "string" }, n: { type: "number" } }, required: ["v"], additionalProperties: false },
    });
  });
});

describe("agent loop", () => {
  test("runs tools, returns invalid input and tool errors to the model, and continues paused turns", async () => {
    const fake = scripted(
      message([toolUse("add", { a: 1, b: 2 }), toolUse("add", { a: "x" }), toolUse("fail", {})], "tool_use"),
      message([text("searching")], "pause_turn"),
      message([text("3")]),
    );
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
    const second = fake.requests[1]!.messages.at(-1)!.content as { content: string; is_error?: boolean }[];
    expect(JSON.parse(second[0]!.content)).toEqual({ sum: 3 });
    expect(second[1]!.is_error).toBe(true);
    expect(second[1]!.content).toContain("INVALID_INPUT");
    expect(second[2]).toMatchObject({ is_error: true, content: "no data" });
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

  test("after a mid-output fallback, blocks the next model cannot read are not echoed", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: "partial", citations: null },
      { type: "tool_use", id: "t1", name: "x", input: {} },
      { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" } },
      { type: "thinking", thinking: "", signature: "sig2" },
      { type: "text", text: "rest", citations: null },
    ] as never[];
    expect(echoable(content).map((b: { type: string }) => b.type)).toEqual(["text", "fallback", "thinking", "text"]);
  });
});
