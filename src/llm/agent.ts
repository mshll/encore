import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { LlmFeature } from "../db/schema";
import type { Effort, Llm, LlmMessage, MessageParam, ToolDefinition } from "./client";
import { LlmIncompleteError, LlmTruncatedError } from "./errors";

type Block = Anthropic.Beta.BetaContentBlock;
type BlockParam = Anthropic.Beta.BetaContentBlockParam;

export type AgentTool = {
  name: string;
  description: string;
  schema: z.ZodType;
  run: (input: never) => unknown;
  /** Ends the loop when it returns `{ accepted: true }`. */
  terminal?: boolean;
  /** Grammar-constrained input. The API allows 24 optional parameters across all strict tools in a request. */
  strict?: boolean;
};

export function tool<S extends z.ZodType>(def: { name: string; description: string; schema: S; run: (input: z.infer<S>) => unknown; terminal?: boolean; strict?: boolean }): AgentTool {
  return def as AgentTool;
}

export type AgentEvent = { type: "text"; delta: string } | { type: "tool"; name: string; input: unknown };

export type AgentRun = {
  feature: LlmFeature;
  ref?: string;
  system: string[];
  tools: AgentTool[];
  serverTools?: ToolDefinition[];
  messages: MessageParam[];
  effort: Effort;
  maxTokens?: number;
  maxCalls?: number;
  onEvent?: (event: AgentEvent) => void;
};

export type AgentResult = { final: LlmMessage; terminal: unknown | null; calls: number };

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

export function toolDefinition(t: AgentTool): ToolDefinition {
  return {
    name: t.name,
    description: t.description,
    input_schema: apiSchema(z.toJSONSchema(t.schema, { io: "input" })) as Anthropic.Beta.BetaTool.InputSchema,
    ...(t.strict ? { strict: true } : {}),
    eager_input_streaming: true,
  };
}

/** Content to send back as the assistant turn. After a mid-output fallback, blocks before the last fallback boundary that the next model cannot use are dropped, as the API requires. */
export function echoable(content: Block[]): BlockParam[] {
  const boundary = content.map((b) => b.type).lastIndexOf("fallback");
  const resultIds = new Set(content.flatMap((b) => ("tool_use_id" in b ? [b.tool_use_id] : [])));
  return content.filter((b, i) => {
    if (i >= boundary) return true;
    if (b.type === "thinking" || b.type === "redacted_thinking" || b.type === "tool_use") return false;
    if (b.type === "server_tool_use") return resultIds.has(b.id);
    return true;
  }) as BlockParam[];
}

function pendingToolUses(content: Block[]): Anthropic.Beta.BetaToolUseBlock[] {
  const boundary = content.map((b) => b.type).lastIndexOf("fallback");
  return content.filter((b, i): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && i > boundary);
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

/** A failure the model can recover from: returned as an error tool_result instead of aborting the run. */
export class ToolError extends Error {}

/** Manual tool loop. Appends every turn to `run.messages` so the caller can persist the conversation. */
export async function runAgent(llm: Llm, run: AgentRun): Promise<AgentResult> {
  const tools = [...(run.serverTools ?? []), ...run.tools.map(toolDefinition)];
  const byName = new Map(run.tools.map((t) => [t.name, t]));
  const maxCalls = run.maxCalls ?? 30;
  for (let calls = 1; calls <= maxCalls; calls++) {
    const message = await llm.call({
      feature: run.feature,
      ref: run.ref,
      system: run.system,
      tools,
      messages: run.messages,
      effort: run.effort,
      maxTokens: run.maxTokens ?? 64_000,
      onText: (delta) => run.onEvent?.({ type: "text", delta }),
    });
    const uses = pendingToolUses(message.content);
    if (message.stop_reason === "max_tokens") throw new LlmTruncatedError();
    run.messages.push({ role: "assistant", content: echoable(message.content) });
    if (message.stop_reason === "pause_turn") continue;
    if (uses.length === 0) return { final: message, terminal: null, calls };
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    let terminal: unknown = null;
    for (const use of uses) {
      run.onEvent?.({ type: "tool", name: use.name, input: use.input });
      const t = byName.get(use.name);
      const result = await runTool(t, use.input);
      results.push({ type: "tool_result", tool_use_id: use.id, content: result.content, ...(result.isError ? { is_error: true } : {}) });
      if (t?.terminal && !result.isError && (result.value as { accepted?: boolean } | null)?.accepted) terminal = result.value;
    }
    run.messages.push({ role: "user", content: results });
    if (terminal !== null) return { final: message, terminal, calls };
  }
  throw new LlmIncompleteError(`Stopped after ${maxCalls} model calls without finishing`);
}
