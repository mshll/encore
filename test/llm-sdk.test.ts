import { describe, expect, test } from "bun:test";
import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { LlmAbortedError, LlmProviderError } from "../src/llm/errors";
import { sdkTransport, type SdkProvider } from "../src/llm/sdk";
import type { LlmRequest } from "../src/llm/types";

const finish = (unified: "stop" | "tool-calls" | "length", raw: string, cacheRead = 0): LanguageModelV4StreamPart => ({
  type: "finish",
  finishReason: { unified, raw },
  usage: { inputTokens: { total: 1200 + cacheRead, noCache: 1200, cacheRead, cacheWrite: 0 }, outputTokens: { total: 80, text: 80, reasoning: 0 } },
});

function mock(...turns: LanguageModelV4StreamPart[][]) {
  return new MockLanguageModelV4({ modelId: "claude-opus-5-5", doStream: turns.map((chunks) => ({ stream: simulateReadableStream({ chunks }) })) });
}

const provider = (model: MockLanguageModelV4, id: SdkProvider["id"] = "anthropic"): SdkProvider => ({ id, model: () => model, webSearch: () => ({}) });

const request = (extra: Partial<LlmRequest> = {}): LlmRequest => ({
  model: "claude-opus-5-5",
  system: ["rules", "profile"],
  messages: [{ role: "user", content: "q" }],
  tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object", properties: { v: { type: "string" } }, required: ["v"], additionalProperties: false } }],
  webSearch: null,
  effort: "medium",
  maxTokens: 1000,
  ...extra,
});

describe("AI SDK transport", () => {
  test("streams text, returns tool calls and sources in encore's form, with usage split into fresh and cached input", async () => {
    const model = mock([
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Look" },
      { type: "text-delta", id: "t", delta: "ing" },
      { type: "text-end", id: "t" },
      { type: "source", sourceType: "url", id: "s1", url: "https://example.org/a", title: "A" },
      { type: "tool-call", toolCallId: "c1", toolName: "echo", input: '{"v":"x"}' },
      finish("tool-calls", "tool_use", 500),
    ]);
    const deltas: string[] = [];

    const reply = await sdkTransport(provider(model))(request(), (d) => deltas.push(d));

    expect({ deltas, content: reply.content, stopReason: reply.stopReason, usage: reply.usage }).toEqual({
      deltas: ["Look", "ing"],
      content: [
        { type: "text", text: "Looking" },
        { type: "source", url: "https://example.org/a", title: "A" },
        { type: "tool_call", id: "c1", name: "echo", input: { v: "x" } },
      ],
      stopReason: "tool_calls",
      usage: { inputTokens: 1200, outputTokens: 80, cacheReadTokens: 500, cacheWriteTokens: 0, webSearches: 0 },
    });
  });

  test("Anthropic gets adaptive thinking at the run's effort and a cached system prompt", async () => {
    const model = mock([finish("stop", "end_turn")]);

    await sdkTransport(provider(model))(request(), () => {});

    const call = model.doStreamCalls[0]!;
    expect({ anthropic: call.providerOptions?.anthropic, lastSystem: call.prompt.filter((m) => m.role === "system").at(-1)?.providerOptions }).toMatchObject({
      anthropic: { effort: "medium", thinking: { type: "adaptive" }, cacheControl: { type: "ephemeral" } },
      lastSystem: { anthropic: { cacheControl: { type: "ephemeral" } } },
    });
  });

  test("OpenAI and Google get the effort as the SDK's reasoning level; an OpenAI-compatible server gets none", async () => {
    const reasoning = async (id: SdkProvider["id"]) => {
      const model = mock([finish("stop", "stop")]);
      await sdkTransport(provider(model, id))(request(), () => {});
      return model.doStreamCalls[0]!.reasoning;
    };

    expect([await reasoning("openai"), await reasoning("google"), await reasoning("openai-compatible")]).toEqual(["medium", "medium", undefined]);
  });

  test("tool results go back as tool messages, and the provider's own turn is replayed for the same model", async () => {
    const model = mock([finish("stop", "end_turn")]);
    const native = { provider: "anthropic" as const, model: "claude-opus-5-5", messages: [{ role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "echo", input: { v: "x" } }] }] };

    await sdkTransport(provider(model))(
      request({
        messages: [
          { role: "user", content: "q" },
          { role: "assistant", content: [{ type: "text", text: "dropped in favour of native" }], native },
          { role: "user", content: [{ type: "tool_result", id: "c1", name: "echo", content: '{"v":"x"}' }] },
        ],
      }),
      () => {},
    );

    const prompt = model.doStreamCalls[0]!.prompt.filter((m) => m.role !== "system");
    expect(prompt.map((m) => [m.role, (m.content as { type: string }[])[0]?.type])).toEqual([
      ["user", "text"],
      ["assistant", "tool-call"],
      ["tool", "tool-result"],
    ]);
  });

  test("a JSON schema becomes the model's structured output format", async () => {
    const model = mock([{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: '{"headline":"Quiet"}' }, { type: "text-end", id: "t" }, finish("stop", "end_turn")]);
    const schema = { type: "object", properties: { headline: { type: "string" } }, required: ["headline"], additionalProperties: false };

    const reply = await sdkTransport(provider(model))(request({ tools: [], jsonSchema: schema }), () => {});

    expect([model.doStreamCalls[0]!.responseFormat, reply.content]).toEqual([{ type: "json", schema }, [{ type: "text", text: '{"headline":"Quiet"}' }]]);
  });

  test("reports a step's usage as it arrives, so a request cancelled after it was billed still has its usage", async () => {
    const model = mock([{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Hi" }, { type: "text-end", id: "t" }, finish("stop", "end_turn")]);
    const cancel = new AbortController();
    const reported: unknown[] = [];

    const failure = await sdkTransport(provider(model))(request(), () => {}, cancel.signal, (usage, modelId) => {
      reported.push({ usage, modelId });
      cancel.abort();
    }).catch((e: unknown) => e);

    expect({ aborted: failure instanceof LlmAbortedError, reported }).toEqual({
      aborted: true,
      reported: [{ usage: { inputTokens: 1200, outputTokens: 80, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 }, modelId: "claude-opus-5-5" }],
    });
  });

  test("a rejected key becomes a provider error carrying only the status", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({ message: "invalid x-api-key sk-secret", url: "https://api.example/v1", requestBodyValues: {}, statusCode: 401, isRetryable: false });
      },
    });

    const failure = await sdkTransport(provider(model))(request(), () => {}).catch((e: unknown) => e);

    expect([failure instanceof LlmProviderError, (failure as LlmProviderError).status, (failure as Error).message]).toEqual([true, 401, "AI provider error 401"]);
  });
});
