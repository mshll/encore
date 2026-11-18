import type { Db } from "../db/client";
import type { LlmFeature } from "../db/schema";
import type { AiConfig, SettingsSource } from "../settings/settings";
import { callCost } from "./cost";
import { LlmAbortedError, LlmNotConfiguredError, LlmPriceRequiredError, LlmRefusalError } from "./errors";
import { assertWithinBudget, recordCall } from "./ledger";
import { priceFor, WEB_SEARCH_PRICE, type ModelPrice } from "./providers";
import type { ChatMessage, Effort, LlmReply, LlmTransport, ToolSpec, Usage } from "./types";

/** The transport for a provider configuration, or null when it cannot make calls (no key, no base URL). */
export type Connect = (ai: AiConfig) => LlmTransport | null;

export type CallInput = {
  feature: LlmFeature;
  ref?: string;
  system: string[];
  tools?: ToolSpec[];
  /** Lets the model search the web, when the provider has a search tool. */
  webSearch?: { maxUses: number };
  messages: ChatMessage[];
  effort: Effort;
  maxTokens: number;
  /** Constrains the reply to JSON matching this schema (structured output). */
  jsonSchema?: Record<string, unknown>;
  onText?: (delta: string) => void;
};

export class Llm {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsSource,
    private readonly connect: Connect,
    private readonly now: () => number = Date.now,
    private readonly signal?: AbortSignal,
  ) {}

  /** The same client, with every request cancelled when `signal` aborts. */
  withSignal(signal: AbortSignal): Llm {
    return new Llm(this.db, this.settings, this.connect, this.now, signal);
  }

  private get ai(): AiConfig {
    return this.settings.get().llm.ai;
  }

  get configured(): boolean {
    return this.ai.model !== null && this.connect(this.ai) !== null;
  }

  get provider() {
    return this.ai.provider;
  }

  get model(): string | null {
    return this.ai.model;
  }

  /** Whether runs that want sources (weekly picks, notes) can search the web with this provider. */
  get webSearch(): boolean {
    return this.ai.webSearch;
  }

  private priceOf(ai: AiConfig, model: string): ModelPrice {
    const priced = priceFor(this.settings.get().llm.prices, ai.provider, model, ai.ownerPrice, ai.baseUrl);
    if (!priced) throw new LlmPriceRequiredError(model);
    return priced.price;
  }

  assertAvailable(ai: AiConfig = this.ai) {
    if (ai.model === null || !this.connect(ai)) throw new LlmNotConfiguredError();
    this.priceOf(ai, ai.model);
    const { timezone, llm } = this.settings.get();
    assertWithinBudget(this.db, timezone, llm.monthlyBudgetUsd, this.now());
  }

  call(input: CallInput): Promise<LlmReply> {
    return this.callWith(this.ai, input);
  }

  /** One short request with `ai` in place of the saved provider settings, through the ledger and the cap. Returns the model that answered. */
  async verify(ai: AiConfig): Promise<string> {
    const reply = await this.callWith(ai, {
      feature: "verify",
      system: ["Reply with the single word OK."],
      messages: [{ role: "user", content: "OK?" }],
      effort: "low",
      maxTokens: 64,
    });
    return reply.model;
  }

  private async callWith(ai: AiConfig, input: CallInput): Promise<LlmReply> {
    this.assertAvailable(ai);
    const transport = this.connect(ai)!;
    const model = ai.model!;
    const price = this.priceOf(ai, model);
    const { timezone, llm } = this.settings.get();
    if (this.signal?.aborted) throw new LlmAbortedError();
    const started = this.now();
    let billed: { usage: Usage; model: string } | null = null;
    let stopReason: string | null = null;
    let reply: LlmReply;
    try {
      reply = await transport(
        {
          model,
          system: input.system,
          messages: input.messages,
          tools: input.tools ?? [],
          webSearch: ai.webSearch ? (input.webSearch ?? null) : null,
          effort: input.effort,
          maxTokens: input.maxTokens,
          jsonSchema: input.jsonSchema,
        },
        input.onText ?? (() => {}),
        this.signal,
        (usage, answered) => (billed = { usage, model: answered }),
      );
      billed = { usage: reply.usage, model: reply.model };
      stopReason = reply.stopReason;
    } catch (error) {
      stopReason = this.signal?.aborted ? "aborted" : "error";
      if (this.signal?.aborted) throw new LlmAbortedError();
      throw error;
    } finally {
      if (billed) {
        const { usage, model: answered } = billed;
        recordCall(this.db, timezone, {
          ...callCost(usage, llm.prices[answered]?.price ?? price, WEB_SEARCH_PRICE[ai.provider]),
          ts: started,
          feature: input.feature,
          ref: input.ref ?? null,
          requestedModel: model,
          model: answered,
          stopReason,
          durationMs: this.now() - started,
        });
      }
    }
    if (reply.stopReason === "refusal") throw new LlmRefusalError(null);
    return reply;
  }
}
