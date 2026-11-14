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
});

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
};

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
  };
}
