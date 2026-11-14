import type Anthropic from "@anthropic-ai/sdk";
import type { ModelPrice } from "../config";

type Usage = Anthropic.Beta.BetaUsage;

export type CallCost = {
  usd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
};

type Counts = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_creation: Anthropic.Beta.BetaCacheCreation | null;
};

function priceFor(prices: Record<string, ModelPrice>, model: string, fallbackModel: string): ModelPrice {
  return prices[model] ?? prices[fallbackModel] ?? mostExpensive(prices);
}

/** An unpriced model is charged at the highest configured rate, so the ledger never undercounts a billed call. */
function mostExpensive(prices: Record<string, ModelPrice>): ModelPrice {
  return Object.values(prices).reduce((a, b) => (b.output > a.output ? b : a));
}

function countsCost(c: Counts, price: ModelPrice): number {
  const write1h = c.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write5m = (c.cache_creation_input_tokens ?? 0) - write1h;
  return (
    c.input_tokens * price.input +
    c.output_tokens * price.output +
    (c.cache_read_input_tokens ?? 0) * price.cacheRead +
    write5m * price.cacheWrite5m +
    write1h * price.cacheWrite1h
  );
}

export function callCost(usage: Usage, requestedModel: string, prices: Record<string, ModelPrice>, webSearchPerRequest: number): CallCost {
  const iterations = (usage.iterations ?? []).filter((i) => i.type === "message" || i.type === "fallback_message");
  const parts: { counts: Counts; model: string }[] = iterations.length
    ? iterations.map((i) => ({ counts: i, model: ("model" in i && i.model) || requestedModel }))
    : [{ counts: usage, model: requestedModel }];
  const webSearches = usage.server_tool_use?.web_search_requests ?? 0;
  const tokens = (pick: (c: Counts) => number) => parts.reduce((sum, p) => sum + pick(p.counts), 0);
  return {
    usd: parts.reduce((sum, p) => sum + countsCost(p.counts, priceFor(prices, p.model, requestedModel)), 0) + webSearches * webSearchPerRequest,
    inputTokens: tokens((c) => c.input_tokens),
    outputTokens: tokens((c) => c.output_tokens),
    cacheReadTokens: tokens((c) => c.cache_read_input_tokens ?? 0),
    cacheWriteTokens: tokens((c) => c.cache_creation_input_tokens ?? 0),
    webSearches,
  };
}
