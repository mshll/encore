import type { ModelPrice } from "./providers";
import type { Usage } from "./types";

export type CallCost = Usage & { usd: number };

export function callCost(usage: Usage, price: ModelPrice, webSearchPrice: number): CallCost {
  const usd =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    usage.cacheReadTokens * price.cacheRead +
    usage.cacheWriteTokens * price.cacheWrite +
    usage.webSearches * webSearchPrice;
  return { ...usage, usd };
}
