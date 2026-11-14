import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages";
import type { Config } from "../config";
import type { Db } from "../db/client";
import type { LlmFeature } from "../db/schema";
import { callCost } from "./cost";
import { LlmNotConfiguredError, LlmRefusalError } from "./errors";
import { assertWithinBudget, recordCall } from "./ledger";

export type StreamParams = BetaMessageStreamParams;
export type LlmMessage = Anthropic.Beta.BetaMessage;
export type MessageParam = Anthropic.Beta.BetaMessageParam;
export type ToolDefinition = Anthropic.Beta.BetaToolUnion;
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** One API request. Swapped for a scripted fake in tests. */
export type LlmTransport = (params: StreamParams, onText: (delta: string) => void) => Promise<LlmMessage>;

export type CallInput = {
  feature: LlmFeature;
  ref?: string;
  system: string[];
  tools?: ToolDefinition[];
  messages: MessageParam[];
  effort: Effort;
  maxTokens: number;
  onText?: (delta: string) => void;
};

const BETAS = ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"];
const MAX_JSON_RETRIES = 2;

export function sdkTransport(apiKey: string): LlmTransport {
  const client = new Anthropic({ apiKey });
  return async (params, onText) => {
    for (let attempt = 0; ; attempt++) {
      const stream = client.beta.messages.stream(params);
      stream.on("text", onText);
      try {
        return await stream.finalMessage();
      } catch (error) {
        if (error instanceof Anthropic.APIError || attempt >= MAX_JSON_RETRIES) throw error;
        console.error(`[llm] tool input was not parseable JSON, re-issuing the request: ${error instanceof Error ? error.message : error}`);
      }
    }
  };
}

export class Llm {
  constructor(
    private readonly db: Db,
    private readonly config: Pick<Config, "timezone" | "llm">,
    private readonly transport: LlmTransport | null,
    private readonly now: () => number = Date.now,
  ) {}

  get configured() {
    return this.transport !== null;
  }

  get model() {
    return this.config.llm.model;
  }

  assertAvailable() {
    if (!this.transport) throw new LlmNotConfiguredError();
    assertWithinBudget(this.db, this.config.timezone, this.config.llm.monthlyBudgetUsd, this.now());
  }

  async call(input: CallInput): Promise<LlmMessage> {
    this.assertAvailable();
    const system = input.system.map((text, i): Anthropic.Beta.BetaTextBlockParam =>
      i === input.system.length - 1 ? { type: "text", text, cache_control: { type: "ephemeral" } } : { type: "text", text },
    );
    const params: StreamParams = {
      model: this.config.llm.model,
      max_tokens: input.maxTokens,
      system,
      messages: input.messages,
      ...(input.tools?.length ? { tools: input.tools } : {}),
      thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
      output_config: { effort: input.effort },
      cache_control: { type: "ephemeral" },
      fallbacks: "default",
      betas: BETAS,
    };
    const started = this.now();
    const message = await this.transport!(params, input.onText ?? (() => {}));
    const cost = callCost(message.usage, this.config.llm.model, this.config.llm.prices, this.config.llm.webSearchPerRequest);
    recordCall(this.db, this.config.timezone, {
      ...cost,
      ts: started,
      feature: input.feature,
      ref: input.ref ?? null,
      requestedModel: this.config.llm.model,
      model: message.model,
      stopReason: message.stop_reason,
      durationMs: this.now() - started,
    });
    if (message.stop_reason === "refusal") throw new LlmRefusalError(message.stop_details?.category ?? null);
    return message;
  }
}

export function textOf(message: LlmMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
