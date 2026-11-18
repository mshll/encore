import { z } from "zod";
import type { LlmFeature } from "../db/schema";
import type { Llm } from "./client";
import { LlmIncompleteError, LlmTruncatedError } from "./errors";
import type { ChatMessage, Effort, LlmReply, ToolCallPart, ToolResultPart, ToolSpec } from "./types";

export type AgentTool = {
  name: string;
  description: string;
  schema: z.ZodType;
  run: (input: never) => unknown;
  /** Ends the loop when it returns `{ accepted: true }`. */
  terminal?: boolean;
  /** Grammar-constrained input where the provider supports it. Anthropic allows 24 optional parameters across all strict tools in a request. */
  strict?: boolean;
};

export function tool<S extends z.ZodType>(def: { name: string; description: string; schema: S; run: (input: z.infer<S>) => unknown; terminal?: boolean; strict?: boolean }): AgentTool {
  return def as AgentTool;
}

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "visual"; id: string; visual: unknown }
  /** The chat picked the task that answers the message. */
  | { type: "task"; task: string };

export type AgentRun = {
  feature: LlmFeature;
  ref?: string;
  system: string[];
  tools: AgentTool[];
  /** Lets the model search the web, when the provider has a search tool. */
  webSearch?: { maxUses: number };
  messages: ChatMessage[];
  effort: Effort;
  maxTokens?: number;
  maxCalls?: number;
  onEvent?: (event: AgentEvent) => void;
};

export type AgentResult = { final: LlmReply; terminal: unknown | null; calls: number };

const UNSUPPORTED_SCHEMA_KEYS = new Set(["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "pattern"]);

function apiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(apiSchema);
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([key]) => !UNSUPPORTED_SCHEMA_KEYS.has(key));
    const out = Object.fromEntries(entries.map(([key, v]) => [key, key === "properties" ? Object.fromEntries(Object.entries(v as object).map(([p, s]) => [p, apiSchema(s)])) : apiSchema(v)]));
    if (out.type === "object") out.additionalProperties = false;
    return out;
  }
  return value;
}

export function toolDefinition(t: AgentTool): ToolSpec {
  return {
    name: t.name,
    description: t.description,
    inputSchema: apiSchema(z.toJSONSchema(t.schema, { io: "input" })) as Record<string, unknown>,
    ...(t.strict ? { strict: true } : {}),
  };
}

async function runTool(t: AgentTool | undefined, input: unknown): Promise<{ content: string; isError: boolean; value: unknown }> {
  if (!t) return { content: "Unknown tool", isError: true, value: null };
  const parsed = t.schema.safeParse(input);
  if (!parsed.success) {
    return { content: JSON.stringify({ INVALID_INPUT: z.prettifyError(parsed.error), received: input }), isError: true, value: null };
  }
  try {
    const value = await (t.run as (i: unknown) => unknown)(parsed.data);
    return { content: JSON.stringify(value), isError: false, value };
  } catch (error) {
    if (error instanceof ToolError) return { content: error.message, isError: true, value: null };
    throw error;
  }
}

/** A failure the model can recover from: returned as an error tool result instead of aborting the run. */
export class ToolError extends Error {}

/** Manual tool loop. Appends every turn to `run.messages` so the caller can persist the conversation. */
export async function runAgent(llm: Llm, run: AgentRun): Promise<AgentResult> {
  const tools = run.tools.map(toolDefinition);
  const byName = new Map(run.tools.map((t) => [t.name, t]));
  const maxCalls = run.maxCalls ?? 30;
  for (let calls = 1; calls <= maxCalls; calls++) {
    const reply = await llm.call({
      feature: run.feature,
      ref: run.ref,
      system: run.system,
      tools,
      webSearch: run.webSearch,
      messages: run.messages,
      effort: run.effort,
      maxTokens: run.maxTokens ?? 64_000,
      onText: (delta) => run.onEvent?.({ type: "text", delta }),
    });
    if (reply.stopReason === "max_tokens") throw new LlmTruncatedError();
    run.messages.push({ role: "assistant", content: reply.content, ...(reply.native ? { native: reply.native } : {}) });
    if (reply.stopReason === "pause") continue;
    const uses = reply.content.filter((p): p is ToolCallPart => p.type === "tool_call");
    if (uses.length === 0) return { final: reply, terminal: null, calls };
    const results: ToolResultPart[] = [];
    let terminal: unknown = null;
    for (const use of uses) {
      run.onEvent?.({ type: "tool", name: use.name, input: use.input });
      const t = byName.get(use.name);
      const result = await runTool(t, use.input);
      results.push({ type: "tool_result", id: use.id, name: use.name, content: result.content, ...(result.isError ? { isError: true } : {}) });
      if (t?.terminal && !result.isError && (result.value as { accepted?: boolean } | null)?.accepted) terminal = result.value;
    }
    run.messages.push({ role: "user", content: results });
    if (terminal !== null) return { final: reply, terminal, calls };
  }
  throw new LlmIncompleteError(`Stopped after ${maxCalls} model calls without finishing`);
}
