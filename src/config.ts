import { z } from "zod";

const optionalSecret = z.string().min(24, "must be at least 24 characters").optional();

const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "unknown IANA timezone");

const schema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8888),
  DATABASE_PATH: z.string().default("./data/encore.db"),
  PUBLIC_BASE_URL: z.url().default("http://localhost:8888"),
  SPOTIFY_CLIENT_ID: z.string().min(1),
  SPOTIFY_REDIRECT_URI: z.url().optional(),
  SETUP_TOKEN: optionalSecret,
  ADMIN_TOKEN: optionalSecret,
  TIMEZONE: timezone.default("Asia/Kuwait"),
  HOME_COUNTRY: z.string().regex(/^[A-Z]{2}$/).default("KW"),
  JOBS_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  POLL_INTERVAL_SECONDS: z.coerce.number().int().min(60).default(300),
  ENRICH_INTERVAL_SECONDS: z.coerce.number().min(1).default(4),
  ENRICH_BATCH_SIZE: z.coerce.number().int().min(1).max(20).default(1),
  ART_INTERVAL_SECONDS: z.coerce.number().min(1).default(4),
  QUOTA_BACKOFF_HOURS: z.coerce.number().min(1).default(12),
  WEB_DIST: z.string().default("./web/dist"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  LLM_MODEL: z.string().min(1).default("claude-opus-5-5"),
  LLM_PRICES: z.string().optional(),
  MONTHLY_BUDGET_USD: z.coerce.number().min(0).default(100),
  PICKS_PER_WEEK: z.coerce.number().int().min(1).max(20).default(5),
  PICKS_FAR_OUT: z.coerce.number().int().min(0).max(20).default(1),
  PICKS_WEEKDAY: z.coerce.number().int().min(1).max(7).default(5),
  PICKS_HOUR: z.coerce.number().int().min(0).max(23).default(10),
  PICKS_PLAYLIST: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  DIGEST_WEEKDAY: z.coerce.number().int().min(1).max(7).default(5),
  DIGEST_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  JOBS_DISABLED: z.string().default(""),
  WATCHER_ACTIVE_SECONDS: z.coerce.number().min(5).default(15),
  WATCHER_IDLE_SECONDS: z.coerce.number().min(15).default(60),
  WATCHER_BACKOFF_MAX_SECONDS: z.coerce.number().min(60).default(900),
  DJ_SKIP_TRIGGER: z.coerce.number().int().min(1).max(20).default(2),
  RADAR_MIN_LISTENS: z.coerce.number().int().min(1).default(20),
  RADAR_INTERVAL_MINUTES: z.coerce.number().min(5).default(60),
  RADAR_ARTISTS_PER_RUN: z.coerce.number().int().min(1).max(20).default(2),
  RADAR_RECHECK_DAYS: z.coerce.number().min(1).default(7),
  RADAR_BASELINE_DAYS: z.coerce.number().int().min(0).default(30),
  LIBRARY_SYNC_HOURS: z.coerce.number().min(1).default(24),
  LIBRARY_PAGE_SECONDS: z.coerce.number().min(2).default(20),
  DISCORD_BOT_TOKEN: z.string().min(1).optional(),
  DISCORD_APPLICATION_ID: z.string().regex(/^\d+$/).optional(),
  DISCORD_PUBLIC_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "expected 64 hex characters").optional(),
  DISCORD_GUILD_ID: z.string().regex(/^\d+$/).optional(),
  DISCORD_CHANNEL_ID: z.string().regex(/^\d+$/).optional(),
  DISCORD_OWNER_ID: z.string().regex(/^\d+$/).optional(),
  MCP_TOKEN: optionalSecret,
});

export type DiscordConfig = {
  botToken?: string;
  applicationId: string;
  publicKey: string;
  guildId?: string;
  channelId?: string;
  ownerId: string;
};

export type Config = {
  host: string;
  port: number;
  databasePath: string;
  publicBaseUrl: string;
  rpId: string;
  secureCookies: boolean;
  spotifyClientId: string;
  spotifyRedirectUri: string;
  setupToken?: string;
  adminToken?: string;
  timezone: string;
  homeCountry: string;
  jobsEnabled: boolean;
  pollIntervalMs: number;
  enrichIntervalMs: number;
  enrichBatchSize: number;
  artIntervalMs: number;
  quotaBackoffMs: number;
  webDist: string;
  llm: LlmConfig;
  disabledJobs: string[];
  watcherActiveMs: number;
  watcherIdleMs: number;
  watcherBackoffMaxMs: number;
  djSkipTrigger: number;
  radarMinListens: number;
  radarIntervalMs: number;
  radarArtistsPerRun: number;
  radarRecheckMs: number;
  radarBaselineDays: number;
  librarySyncMs: number;
  libraryPageMs: number;
  discord: DiscordConfig | null;
  mcpToken?: string;
};

export type ModelPrice = { input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number };

export type LlmConfig = {
  apiKey?: string;
  model: string;
  prices: Record<string, ModelPrice>;
  webSearchPerRequest: number;
  monthlyBudgetUsd: number;
  picksPerWeek: number;
  picksFarOut: number;
  picksSlot: { weekday: number; hour: number };
  picksPlaylist: boolean;
  digestSlot: { weekday: number; hour: number };
};

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

function parsePrices(raw: string | undefined): Record<string, ModelPrice> {
  if (!raw) return DEFAULT_PRICES;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("Invalid configuration: LLM_PRICES: must be JSON");
  }
  const parsed = priceOverrides.safeParse(json);
  if (!parsed.success) throw new Error(`Invalid configuration: LLM_PRICES: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const perToken = Object.fromEntries(
    Object.entries(parsed.data).map(([model, p]) => [model, usdPerMTok(p.input, p.cacheWrite5m, p.cacheWrite1h, p.cacheRead, p.output)]),
  );
  return { ...DEFAULT_PRICES, ...perToken };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const e = parsed.data;
  const base = new URL(e.PUBLIC_BASE_URL);
  return {
    host: e.HOST,
    port: e.PORT,
    databasePath: e.DATABASE_PATH,
    publicBaseUrl: base.origin,
    rpId: base.hostname,
    secureCookies: base.protocol === "https:",
    spotifyClientId: e.SPOTIFY_CLIENT_ID,
    spotifyRedirectUri: e.SPOTIFY_REDIRECT_URI ?? `${base.origin}/callback`,
    setupToken: e.SETUP_TOKEN,
    adminToken: e.ADMIN_TOKEN,
    timezone: e.TIMEZONE,
    homeCountry: e.HOME_COUNTRY,
    jobsEnabled: e.JOBS_ENABLED,
    pollIntervalMs: e.POLL_INTERVAL_SECONDS * 1000,
    enrichIntervalMs: e.ENRICH_INTERVAL_SECONDS * 1000,
    enrichBatchSize: e.ENRICH_BATCH_SIZE,
    artIntervalMs: e.ART_INTERVAL_SECONDS * 1000,
    quotaBackoffMs: e.QUOTA_BACKOFF_HOURS * 3_600_000,
    webDist: e.WEB_DIST,
    llm: {
      apiKey: e.ANTHROPIC_API_KEY,
      model: e.LLM_MODEL,
      prices: parsePrices(e.LLM_PRICES),
      webSearchPerRequest: 0.01,
      monthlyBudgetUsd: e.MONTHLY_BUDGET_USD,
      picksPerWeek: e.PICKS_PER_WEEK,
      picksFarOut: Math.min(e.PICKS_FAR_OUT, e.PICKS_PER_WEEK),
      picksSlot: { weekday: e.PICKS_WEEKDAY, hour: e.PICKS_HOUR },
      picksPlaylist: e.PICKS_PLAYLIST,
      digestSlot: { weekday: e.DIGEST_WEEKDAY, hour: e.DIGEST_HOUR },
    },
    disabledJobs: e.JOBS_DISABLED.split(",").map((name) => name.trim()).filter(Boolean),
    watcherActiveMs: e.WATCHER_ACTIVE_SECONDS * 1000,
    watcherIdleMs: e.WATCHER_IDLE_SECONDS * 1000,
    watcherBackoffMaxMs: e.WATCHER_BACKOFF_MAX_SECONDS * 1000,
    djSkipTrigger: e.DJ_SKIP_TRIGGER,
    radarMinListens: e.RADAR_MIN_LISTENS,
    radarIntervalMs: e.RADAR_INTERVAL_MINUTES * 60_000,
    radarArtistsPerRun: e.RADAR_ARTISTS_PER_RUN,
    radarRecheckMs: e.RADAR_RECHECK_DAYS * 86_400_000,
    radarBaselineDays: e.RADAR_BASELINE_DAYS,
    librarySyncMs: e.LIBRARY_SYNC_HOURS * 3_600_000,
    libraryPageMs: e.LIBRARY_PAGE_SECONDS * 1000,
    discord:
      e.DISCORD_APPLICATION_ID && e.DISCORD_PUBLIC_KEY && e.DISCORD_OWNER_ID
        ? {
            botToken: e.DISCORD_BOT_TOKEN,
            applicationId: e.DISCORD_APPLICATION_ID,
            publicKey: e.DISCORD_PUBLIC_KEY.toLowerCase(),
            guildId: e.DISCORD_GUILD_ID,
            channelId: e.DISCORD_CHANNEL_ID,
            ownerId: e.DISCORD_OWNER_ID,
          }
        : null,
    mcpToken: e.MCP_TOKEN,
  };
}
