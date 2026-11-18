import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, jsonSchema, Output, streamText, tool, type AssistantModelMessage, type LanguageModel, type ModelMessage, type SystemModelMessage, type TextStreamPart, type ToolResultPart, type ToolSet } from "ai";
import type { AiConfig } from "../settings/settings";
import { LlmAbortedError, LlmProviderError } from "./errors";
import type { AiProvider, AssistantMessage, ChatMessage, LlmReply, LlmRequest, LlmTransport, OnUsage, StopReason, Usage } from "./types";

type ProviderTools = { webSearch: (maxUses: number) => ToolSet };

/** A provider instance from the AI SDK: a model by id, and its web search tool when it has one. */
export type SdkProvider = { id: AiProvider; model: (id: string) => LanguageModel } & Partial<ProviderTools>;

const MAX_RETRIES = 2;

export function sdkProvider(ai: AiConfig): SdkProvider | null {
  switch (ai.provider) {
    case "anthropic": {
      if (!ai.apiKey) return null;
      const p = createAnthropic({ apiKey: ai.apiKey });
      return { id: "anthropic", model: (id) => p(id), webSearch: (maxUses) => ({ web_search: p.tools.webSearch_20260209({ maxUses }) }) };
    }
    case "openai": {
      if (!ai.apiKey) return null;
      const p = createOpenAI({ apiKey: ai.apiKey });
      return { id: "openai", model: (id) => p(id), webSearch: () => ({ web_search: p.tools.webSearch({}) }) };
    }
    case "google": {
      if (!ai.apiKey) return null;
      const p = createGoogleGenerativeAI({ apiKey: ai.apiKey });
      return { id: "google", model: (id) => p(id), webSearch: () => ({ google_search: p.tools.googleSearch({}) }) };
    }
    case "openai-compatible": {
      if (!ai.baseUrl) return null;
      const p = createOpenAICompatible({ name: "compatible", baseURL: ai.baseUrl, apiKey: ai.apiKey, includeUsage: true });
      return { id: "openai-compatible", model: (id) => p.chatModel(id) };
    }
  }
}

/** The transport for the current provider settings, rebuilt only when they change. */
export function sdkConnect(): (ai: AiConfig) => LlmTransport | null {
  let cached: { key: string; transport: LlmTransport | null } | null = null;
  return (ai) => {
    const key = JSON.stringify([ai.provider, ai.apiKey, ai.baseUrl]);
    if (cached?.key !== key) {
      const provider = sdkProvider(ai);
      cached = { key, transport: provider ? sdkTransport(provider) : null };
    }
    return cached.transport;
  };
}

function toModelMessages(messages: ChatMessage[], provider: AiProvider, model: string): ModelMessage[] {
  return messages.flatMap((m): ModelMessage[] => {
    if (m.role === "user") {
      if (typeof m.content === "string") return [{ role: "user", content: m.content }];
      return [
        {
          role: "tool",
          content: m.content.map(
            (r): ToolResultPart => ({
              type: "tool-result",
              toolCallId: r.id,
              toolName: r.name,
              output: r.isError ? { type: "error-text", value: r.content } : { type: "text", value: r.content },
            }),
          ),
        },
      ];
    }
    if (m.native && m.native.provider === provider && m.native.model === model) return m.native.messages as ModelMessage[];
    const content = m.content.flatMap((p): Exclude<AssistantModelMessage["content"], string> => {
      if (p.type === "text") return p.text ? [{ type: "text", text: p.text }] : [];
      if (p.type === "tool_call") return [{ type: "tool-call", toolCallId: p.id, toolName: p.name, input: p.input }];
      return [];
    });
    return content.length ? [{ role: "assistant", content }] : [];
  });
}

function instructions(system: string[], provider: AiProvider): SystemModelMessage[] {
  return system.map((content, i) =>
    provider === "anthropic" && i === system.length - 1 ? { role: "system", content, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } } : { role: "system", content },
  );
}

function stopReason(unified: string | undefined, raw: string | undefined, toolCalls: number): StopReason {
  if (unified === "content-filter" || raw === "refusal") return "refusal";
  if (unified === "length") return "max_tokens";
  if (toolCalls > 0) return "tool_calls";
  if (raw === "pause_turn") return "pause";
  return unified === "stop" ? "end" : "other";
}

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;


type Collected = { content: AssistantMessage["content"]; usage: Usage; unified?: string; raw?: string; model?: string };

/** Folds the SDK's stream into encore's reply parts, passing text deltas and each step's running usage on as they arrive. Provider-run tool calls (web search) are counted, not returned. */
async function collect(stream: AsyncIterable<TextStreamPart<ToolSet>>, onText: (delta: string) => void, onUsage: OnUsage): Promise<Collected> {
  const out: Collected = { content: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 } };
  const sources = new Set<string>();
  let searches = 0;
  let grounded = false;
  for await (const part of stream) {
    if (part.type === "text-delta") {
      onText(part.text);
      const last = out.content.at(-1);
      if (last?.type === "text") last.text += part.text;
      else out.content.push({ type: "text", text: part.text });
    } else if (part.type === "source" && part.sourceType === "url" && !sources.has(part.url)) {
      sources.add(part.url);
      out.content.push({ type: "source", url: part.url, title: part.title ?? part.url });
    } else if (part.type === "tool-call") {
      if (part.providerExecuted) searches++;
      else out.content.push({ type: "tool_call", id: part.toolCallId, name: part.toolName, input: part.input });
    } else if (part.type === "finish-step") {
      const u = part.usage;
      const cacheRead = u.inputTokenDetails.cacheReadTokens ?? 0;
      const cacheWrite = u.inputTokenDetails.cacheWriteTokens ?? 0;
      out.usage = {
        inputTokens: out.usage.inputTokens + (u.inputTokenDetails.noCacheTokens ?? Math.max(0, (u.inputTokens ?? 0) - cacheRead - cacheWrite)),
        outputTokens: out.usage.outputTokens + (u.outputTokens ?? 0),
        cacheReadTokens: out.usage.cacheReadTokens + cacheRead,
        cacheWriteTokens: out.usage.cacheWriteTokens + cacheWrite,
        webSearches: 0,
      };
      out.unified = part.finishReason;
      out.raw = part.rawFinishReason;
      out.model = part.response.modelId;
      const google = part.providerMetadata?.google as { groundingMetadata?: { webSearchQueries?: unknown[] } } | undefined;
      grounded ||= (google?.groundingMetadata?.webSearchQueries?.length ?? 0) > 0;
      out.usage.webSearches = searches + (grounded ? 1 : 0);
      onUsage({ ...out.usage }, out.model);
    } else if (part.type === "error") throw part.error;
  }
  out.usage.webSearches = searches + (grounded ? 1 : 0);
  return out;
}

function providerOptions(provider: AiProvider, effort: LlmRequest["effort"]) {
  if (provider === "anthropic") {
    return { providerOptions: { anthropic: { effort, thinking: { type: "adaptive", blockBinding: { prefixMismatchBehavior: "drop_block" } }, cacheControl: { type: "ephemeral" } } } };
  }
  return provider === "openai" || provider === "google" ? { reasoning: effort } : {};
}

/** One streamed model request through the AI SDK. The tools have no `execute`, so the SDK stops after one step and encore's agent loop runs them. */
export function sdkTransport(provider: SdkProvider): LlmTransport {
  return async (request, onText, signal, onUsage = () => {}) => {
    const tools: ToolSet = Object.fromEntries(
      request.tools.map((t) => [t.name, tool({ description: t.description, inputSchema: jsonSchema(t.inputSchema), ...(provider.id === "anthropic" && t.strict ? { strict: true } : {}) })]),
    );
    const search = request.webSearch && provider.webSearch ? provider.webSearch(request.webSearch.maxUses) : {};
    const result = streamText({
      model: provider.model(request.model),
      instructions: instructions(request.system, provider.id),
      messages: toModelMessages(request.messages, provider.id, request.model),
      tools: { ...search, ...tools },
      maxOutputTokens: request.maxTokens,
      maxRetries: MAX_RETRIES,
      abortSignal: signal,
      // Failures arrive as error parts and are thrown from collect(); the default handler would log the provider's message.
      onError: () => {},
      ...(request.jsonSchema ? { output: Output.object({ schema: jsonSchema(request.jsonSchema) }) } : {}),
      ...providerOptions(provider.id, request.effort),
    });
    let collected: Collected;
    let messages: unknown[];
    try {
      collected = await collect(result.fullStream, onText, onUsage);
      messages = (await result.response).messages;
    } catch (error) {
      if (signal?.aborted) throw new LlmAbortedError();
      throw providerError(error);
    }
    if (signal?.aborted) throw new LlmAbortedError();
    const toolCalls = collected.content.filter((p) => p.type === "tool_call").length;
    return {
      content: collected.content,
      native: { provider: provider.id, model: request.model, messages: json(messages) },
      stopReason: stopReason(collected.unified, collected.raw, toolCalls),
      usage: collected.usage,
      model: collected.model || request.model,
    } satisfies LlmReply;
  };
}

function providerError(error: unknown): Error {
  if (APICallError.isInstance(error)) return new LlmProviderError(error.statusCode ?? null);
  if (error instanceof Error) return new LlmProviderError(null, error.name);
  return new LlmProviderError(null);
}
