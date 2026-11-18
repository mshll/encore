import type { AiProvider } from "./types";

/** USD per token. */
export type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type KnownModel = { provider: AiProvider; price: ModelPrice };

const perMTok = (input: number, output: number, cacheRead: number, cacheWrite = input): ModelPrice => ({
  input: input / 1e6,
  output: output / 1e6,
  cacheRead: cacheRead / 1e6,
  cacheWrite: cacheWrite / 1e6,
});

const anthropic = (input: number, output: number, cacheRead: number, cacheWrite: number): KnownModel => ({ provider: "anthropic", price: perMTok(input, output, cacheRead, cacheWrite) });
const openai = (input: number, output: number, cacheRead: number): KnownModel => ({ provider: "openai", price: perMTok(input, output, cacheRead) });
const google = (input: number, output: number, cacheRead: number): KnownModel => ({ provider: "google", price: perMTok(input, output, cacheRead) });

/** List prices, standard tier, prompts under each provider's long-context threshold. Checked 2026-11-18. */
export const KNOWN_MODELS: Record<string, KnownModel> = {
  "claude-opus-5-5": anthropic(4, 20, 0.2, 5),
  "claude-opus-5": anthropic(5, 25, 0.5, 6.25),
  "claude-opus-4-8": anthropic(5, 25, 0.5, 6.25),
  "claude-sonnet-5-5": anthropic(2, 10, 0.1, 2.5),

  "gpt-6.2-astra": openai(8, 40, 0.4),
  "gpt-6.2-sol": openai(2, 10, 0.1),
  "gpt-6.1-sol": openai(2, 10, 0.1),
  "gpt-6.1-terra": openai(1, 5, 0.05),
  "gpt-6-luna": openai(0.1, 0.5, 0.01),
  "gpt-5.6-sol": openai(4, 20, 0.4),
  "gpt-5.6-terra": openai(2, 12, 0.2),
  "gpt-5.6-luna": openai(0.2, 1.2, 0.02),
  "gpt-5.5": openai(5, 30, 0.5),
  "gpt-5.4": openai(2.5, 15, 0.25),
  "gpt-5.4-mini": openai(0.75, 4.5, 0.075),

  "gemini-4-carbon": google(2, 10, 0.1),
  "gemini-4-argon": google(2, 10, 0.1),
  "gemini-4-hydrogen": google(1.5, 7.5, 0.075),
  "gemini-3.8-flash": google(0.75, 3.75, 0.075),
  "gemini-3.6-flash": google(0.75, 3.75, 0.075),
  "gemini-3.5-flash-lite": google(0.3, 2.5, 0.03),
  "gemini-3.1-pro-preview": google(2, 12, 0.2),
};

export const DEFAULT_MODELS: Record<AiProvider, string | null> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-6.2-sol",
  google: "gemini-4-carbon",
  "openai-compatible": null,
};

/** USD per web search request. Google bills grounded prompts past a free monthly allowance; this counts every one. */
export const WEB_SEARCH_PRICE: Record<AiProvider, number> = { anthropic: 0.01, openai: 0.01, google: 0.014, "openai-compatible": 0 };

/** Providers whose own web search tool encore can hand to the model. OpenAI-compatible servers have none it can rely on. */
export const hasWebSearch = (provider: AiProvider): boolean => provider !== "openai-compatible";

export const ZERO_PRICE: ModelPrice = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export type PriceSource = "known" | "owner" | "local" | "highest";

/**
 * The price a call is charged at. A model with no known or entered price is charged at the provider's highest known
 * rate, so the ledger never undercounts a billed call; an OpenAI-compatible model with no price counts as free (a local server).
 */
export function priceFor(
  prices: Record<string, KnownModel>,
  provider: AiProvider,
  model: string,
  owner: { input: number; output: number } | null,
): { price: ModelPrice; source: PriceSource } {
  const known = prices[model];
  if (known) return { price: known.price, source: "known" };
  if (owner) return { price: perMTok(owner.input, owner.output, owner.input), source: "owner" };
  const sameProvider = Object.values(prices).filter((m) => m.provider === provider);
  if (sameProvider.length === 0) return { price: ZERO_PRICE, source: "local" };
  return { price: sameProvider.reduce((a, b) => (b.price.output > a.price.output ? b : a)).price, source: "highest" };
}
