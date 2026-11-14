import { z } from "zod";
import { fromEnv, settingFields, type SettingValue } from "./settings/fields";

const schema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8888),
  DATABASE_PATH: z.string().default("./data/encore.db"),
  PUBLIC_BASE_URL: z.url().default("http://localhost:8888"),
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
  rpId: string;
  secureCookies: boolean;
  spotifyRedirectUri: string;
  setupToken?: string;
  secretsKey?: string;
  jobsEnabled: boolean;
  disabledJobs: string[];
  webDist: string;
  llmPrices: Record<string, ModelPrice>;
  /** Setting values given by env vars, already validated. They override the stored values. */
  envSettings: Record<string, SettingValue>;
};

export type ModelPrice = { input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number };

const usdPerMTok = (input: number, cacheWrite5m: number, cacheWrite1h: number, cacheRead: number, output: number): ModelPrice => ({
  input: input / 1e6,
  cacheWrite5m: cacheWrite5m / 1e6,
  cacheWrite1h: cacheWrite1h / 1e6,
  cacheRead: cacheRead / 1e6,
  output: output / 1e6,
});

export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": usdPerMTok(4, 5, 8, 0.2, 20),
  "claude-opus-5": usdPerMTok(5, 6.25, 10, 0.5, 25),
  "claude-opus-4-8": usdPerMTok(5, 6.25, 10, 0.5, 25),
  "claude-sonnet-5-5": usdPerMTok(2, 2.5, 4, 0.1, 10),
};

const priceOverrides = z.record(
  z.string(),
  z.strictObject({ input: z.number().min(0), output: z.number().min(0), cacheWrite5m: z.number().min(0), cacheWrite1h: z.number().min(0), cacheRead: z.number().min(0) }),
);

const invalid = (issues: string) => new Error(`Invalid configuration: ${issues}`);

function parsePrices(raw: string | undefined): Record<string, ModelPrice> {
  if (!raw) return DEFAULT_PRICES;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw invalid("LLM_PRICES: must be JSON");
  }
  const parsed = priceOverrides.safeParse(json);
  if (!parsed.success) throw invalid(`LLM_PRICES: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const perToken = Object.fromEntries(
    Object.entries(parsed.data).map(([model, p]) => [model, usdPerMTok(p.input, p.cacheWrite5m, p.cacheWrite1h, p.cacheRead, p.output)]),
  );
  return { ...DEFAULT_PRICES, ...perToken };
}

/** The models the cost ledger can price; the model setting must be one of them. */
export const pricedModels = (prices: Record<string, ModelPrice>) => Object.keys(prices) as [string, ...string[]];

function parseEnvSettings(env: Record<string, string>, prices: Record<string, ModelPrice>): Record<string, SettingValue> {
  const values: Record<string, SettingValue> = {};
  const issues: string[] = [];
  for (const field of settingFields(pricedModels(prices))) {
    const raw = env[field.env];
    if (raw === undefined) continue;
    const parsed = field.schema.safeParse(fromEnv(field, raw));
    if (parsed.success) values[field.key] = parsed.data;
    else issues.push(`${field.env}: ${field.key === "claudeModel" ? `no price for ${raw}; add it to LLM_PRICES` : parsed.error.issues[0]!.message}`);
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
    rpId: base.hostname,
    secureCookies: base.protocol === "https:",
    spotifyRedirectUri: e.SPOTIFY_REDIRECT_URI ?? `${base.origin}/callback`,
    setupToken: e.SETUP_TOKEN,
    secretsKey: e.SECRETS_KEY,
    jobsEnabled: e.JOBS_ENABLED,
    disabledJobs: e.JOBS_DISABLED.split(",").map((name) => name.trim()).filter(Boolean),
    webDist: e.WEB_DIST,
    llmPrices,
    envSettings: parseEnvSettings(env, llmPrices),
  };
}
