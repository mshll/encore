import { z } from "zod";
import { KNOWN_MODELS, type KnownModel } from "./llm/providers";
import type { AiProvider } from "./llm/types";
import { fromEnv, settingFields, type SettingValue } from "./settings/fields";

const schema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8888),
  DATABASE_PATH: z.string().default("./data/encore.db"),
  PUBLIC_BASE_URL: z.url().default("http://localhost:8888"),
  REDIRECT_HOSTS: z.string().default(""),
  SPOTIFY_REDIRECT_URI: z.url().optional(),
  SETUP_TOKEN: z.string().min(24, "must be at least 24 characters").optional(),
  SECRETS_KEY: z.string().min(32, "must be at least 32 characters").optional(),
  JOBS_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  JOBS_DISABLED: z.string().default(""),
  WEB_DIST: z.string().default("./web/dist"),
  LLM_PRICES: z.string().optional(),
});

/** Boot configuration: read from env once. Everything a user can change at runtime lives in the settings store. */
export type Config = {
  host: string;
  port: number;
  databasePath: string;
  publicBaseUrl: string;
  /** Old host names: page requests to them move permanently to the same path on `publicBaseUrl`. */
  redirectHosts: string[];
  rpId: string;
  secureCookies: boolean;
  spotifyRedirectUri: string;
  setupToken?: string;
  secretsKey?: string;
  jobsEnabled: boolean;
  disabledJobs: string[];
  webDist: string;
  /** Known models and their prices: the built-in table with LLM_PRICES over it. */
  llmPrices: Record<string, KnownModel>;
  /** Setting values given by env vars, already validated. They override the stored values. */
  envSettings: Record<string, SettingValue>;
};

const priceOverrides = z.record(
  z.string(),
  z.strictObject({
    input: z.number().min(0),
    output: z.number().min(0),
    cacheRead: z.number().min(0).optional(),
    cacheWrite: z.number().min(0).optional(),
    cacheWrite5m: z.number().min(0).optional(),
    cacheWrite1h: z.number().min(0).optional(),
  }),
);

const invalid = (issues: string) => new Error(`Invalid configuration: ${issues}`);

const providerOfModel = (model: string): AiProvider =>
  KNOWN_MODELS[model]?.provider ?? (model.startsWith("claude-") ? "anthropic" : model.startsWith("gemini-") ? "google" : /^(gpt-|o\d)/.test(model) ? "openai" : "openai-compatible");

/** LLM_PRICES: USD per million tokens by model id, over the built-in table. */
function parsePrices(raw: string | undefined): Record<string, KnownModel> {
  if (!raw) return KNOWN_MODELS;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw invalid("LLM_PRICES: must be JSON");
  }
  const parsed = priceOverrides.safeParse(json);
  if (!parsed.success) throw invalid(`LLM_PRICES: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const overrides = Object.entries(parsed.data).map(([model, p]): [string, KnownModel] => [
    model,
    {
      provider: providerOfModel(model),
      price: { input: p.input / 1e6, output: p.output / 1e6, cacheRead: (p.cacheRead ?? p.input) / 1e6, cacheWrite: (p.cacheWrite ?? p.cacheWrite5m ?? p.input) / 1e6 },
    },
  ]);
  return { ...KNOWN_MODELS, ...Object.fromEntries(overrides) };
}

function parseEnvSettings(env: Record<string, string>): Record<string, SettingValue> {
  const values: Record<string, SettingValue> = {};
  const issues: string[] = [];
  for (const field of settingFields()) {
    const raw = env[field.env];
    if (raw === undefined) continue;
    const parsed = field.schema.safeParse(fromEnv(field, raw));
    if (parsed.success) values[field.key] = parsed.data;
    else issues.push(`${field.env}: ${parsed.error.issues[0]!.message}`);
  }
  if (issues.length) throw invalid(issues.join("; "));
  return values;
}

export function loadConfig(rawEnv: Record<string, string | undefined> = process.env): Config {
  const env = Object.fromEntries(Object.entries(rawEnv).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== ""));
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw invalid(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const e = parsed.data;
  const base = new URL(e.PUBLIC_BASE_URL);
  const llmPrices = parsePrices(e.LLM_PRICES);
  return {
    host: e.HOST,
    port: e.PORT,
    databasePath: e.DATABASE_PATH,
    publicBaseUrl: base.origin,
    redirectHosts: e.REDIRECT_HOSTS.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean),
    rpId: base.hostname,
    secureCookies: base.protocol === "https:",
    spotifyRedirectUri: e.SPOTIFY_REDIRECT_URI ?? `${base.origin}/callback`,
    setupToken: e.SETUP_TOKEN,
    secretsKey: e.SECRETS_KEY,
    jobsEnabled: e.JOBS_ENABLED,
    disabledJobs: e.JOBS_DISABLED.split(",").map((name) => name.trim()).filter(Boolean),
    webDist: e.WEB_DIST,
    llmPrices,
    envSettings: parseEnvSettings(env),
  };
}
