export const AI_PROVIDERS = ["anthropic", "openai", "google", "openai-compatible"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type TextPart = { type: "text"; text: string };
export type ToolCallPart = { type: "tool_call"; id: string; name: string; input: unknown };
/** A page the provider's web search returned during the turn. */
export type SourcePart = { type: "source"; url: string; title: string };
export type ToolResultPart = { type: "tool_result"; id: string; name: string; content: string; isError?: boolean };

/** The provider's own form of an assistant turn, sent back unchanged while the same provider and model continue the conversation. */
export type NativeTurn = { provider: AiProvider; model: string; messages: unknown[] };

export type UserMessage = { role: "user"; content: string | ToolResultPart[] };
export type AssistantMessage = { role: "assistant"; content: (TextPart | ToolCallPart | SourcePart)[]; native?: NativeTurn };
export type ChatMessage = UserMessage | AssistantMessage;

export type ToolSpec = { name: string; description: string; inputSchema: Record<string, unknown>; strict?: boolean };

/** `pause`: the provider stopped a long server-side turn (web searches) early; sending the conversation back continues it. */
export type StopReason = "end" | "tool_calls" | "max_tokens" | "refusal" | "pause" | "other";

export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; webSearches: number };

export type LlmRequest = {
  model: string;
  system: string[];
  messages: ChatMessage[];
  tools: ToolSpec[];
  /** The provider's web search, when the run wants it and the provider has one. */
  webSearch: { maxUses: number } | null;
  effort: Effort;
  maxTokens: number;
  /** Constrains the reply to JSON matching this schema. */
  jsonSchema?: Record<string, unknown>;
};

export type LlmReply = {
  content: AssistantMessage["content"];
  native?: NativeTurn;
  stopReason: StopReason;
  usage: Usage;
  /** The model that answered, as the provider reports it. */
  model: string;
};

/** The usage billed so far, reported as each step finishes, so a request that fails afterwards can still be recorded. */
export type OnUsage = (usage: Usage, model: string) => void;

/** One model request. Swapped for a scripted fake in tests. */
export type LlmTransport = (request: LlmRequest, onText: (delta: string) => void, signal?: AbortSignal, onUsage?: OnUsage) => Promise<LlmReply>;

export const replyText = (content: AssistantMessage["content"]): string =>
  content
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim();
