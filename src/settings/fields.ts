import { z } from "zod";
import { localTime } from "../plays/localTime";

export const SETTING_GROUPS = ["spotify", "locale", "claude", "picks", "digest", "dj", "discord", "mcp", "access", "jobs", "history"] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export type SettingType = "string" | "integer" | "number" | "boolean" | "enum" | "timezone" | "weekdays" | "date";
export type SettingUnit = "ms" | "seconds" | "minutes" | "hours" | "days" | "usd" | "weekday" | "hour";
export type SettingValue = string | number | boolean | number[];

export type SettingField = {
  key: string;
  group: SettingGroup;
  env: string;
  type: SettingType;
  secret: boolean;
  default: SettingValue | null;
  schema: z.ZodType<SettingValue>;
  min?: number;
  max?: number;
  unit?: SettingUnit;
  options?: readonly string[];
};

const isTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const TIMEZONES = Intl.supportedValuesOf("timeZone");

const isCalendarDay = (day: string) => {
  const ms = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(day);
};

/** Today where it is latest on Earth (UTC+14). The store checks against the configured zone before it saves. */
const latestToday = () => localTime(Date.now(), "Etc/GMT-14").day;

const localDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected a date as YYYY-MM-DD")
  .refine(isCalendarDay, "not a real date")
  .refine((day) => day <= latestToday(), "must not be in the future");

type Base = Pick<SettingField, "key" | "group" | "env">;

const text = (base: Base, schema: z.ZodType<string>, extra: { secret?: boolean; default?: string } = {}): SettingField => ({
  ...base,
  type: "string",
  secret: extra.secret ?? false,
  default: extra.default ?? null,
  schema,
});

const numeric = (
  base: Base,
  type: "integer" | "number",
  def: number,
  bounds: { min: number; max?: number; unit?: SettingUnit },
): SettingField => {
  let schema = (type === "integer" ? z.number().int() : z.number()).min(bounds.min);
  if (bounds.max !== undefined) schema = schema.max(bounds.max);
  return { ...base, type, secret: false, default: def, schema, ...bounds };
};

const flag = (base: Base, def: boolean): SettingField => ({ ...base, type: "boolean", secret: false, default: def, schema: z.boolean() });

const choice = (base: Base, options: readonly [string, ...string[]], def: string): SettingField => ({
  ...base,
  type: "enum",
  secret: false,
  default: def,
  schema: z.enum(options),
  options,
});

const snowflake = z.string().regex(/^\d+$/, "expected a numeric Discord id");
const token = z.string().min(24, "must be at least 24 characters");

/** Every setting stored in the `settings` table. An env var of the same name, when set, overrides the stored value. */
export function settingFields(models: readonly [string, ...string[]]): SettingField[] {
  return [
    text({ key: "spotifyClientId", group: "spotify", env: "SPOTIFY_CLIENT_ID" }, z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, "expected a Spotify client id")),

    {
      key: "timezone",
      group: "locale",
      env: "TIMEZONE",
      type: "timezone",
      secret: false,
      default: "UTC",
      schema: z.string().refine(isTimezone, "unknown IANA timezone"),
      options: TIMEZONES,
    },
    text({ key: "homeCountry", group: "locale", env: "HOME_COUNTRY" }, z.string().regex(/^[A-Z]{2}$/, "expected a two-letter country code")),
    {
      key: "weekendDays",
      group: "locale",
      env: "WEEKEND_DAYS",
      type: "weekdays",
      secret: false,
      default: [5, 6],
      schema: z
        .array(z.number().int().min(1).max(7))
        .max(7)
        .refine((days) => new Set(days).size === days.length, "days must not repeat")
        .transform((days) => [...days].sort((a, b) => a - b)),
      min: 1,
      max: 7,
      unit: "weekday",
    },

    text({ key: "claudeApiKey", group: "claude", env: "ANTHROPIC_API_KEY" }, z.string().min(1), { secret: true }),
    choice({ key: "claudeModel", group: "claude", env: "LLM_MODEL" }, models, models.includes("claude-opus-5-5") ? "claude-opus-5-5" : models[0]),
    numeric({ key: "monthlyBudgetUsd", group: "claude", env: "MONTHLY_BUDGET_USD" }, "number", 100, { min: 0, unit: "usd" }),

    numeric({ key: "picksPerWeek", group: "picks", env: "PICKS_PER_WEEK" }, "integer", 5, { min: 1, max: 20 }),
    numeric({ key: "picksFarOut", group: "picks", env: "PICKS_FAR_OUT" }, "integer", 1, { min: 0, max: 20 }),
    numeric({ key: "picksWeekday", group: "picks", env: "PICKS_WEEKDAY" }, "integer", 5, { min: 1, max: 7, unit: "weekday" }),
    numeric({ key: "picksHour", group: "picks", env: "PICKS_HOUR" }, "integer", 10, { min: 0, max: 23, unit: "hour" }),
    flag({ key: "picksPlaylist", group: "picks", env: "PICKS_PLAYLIST" }, false),

    numeric({ key: "digestWeekday", group: "digest", env: "DIGEST_WEEKDAY" }, "integer", 5, { min: 1, max: 7, unit: "weekday" }),
    numeric({ key: "digestHour", group: "digest", env: "DIGEST_HOUR" }, "integer", 9, { min: 0, max: 23, unit: "hour" }),

    choice({ key: "djReplanner", group: "dj", env: "DJ_REPLANNER" }, ["deterministic", "llm"], "deterministic"),
    numeric({ key: "djReplanTimeoutSeconds", group: "dj", env: "DJ_REPLAN_TIMEOUT_SECONDS" }, "number", 20, { min: 1, max: 120, unit: "seconds" }),
    numeric({ key: "djSkipTrigger", group: "dj", env: "DJ_SKIP_TRIGGER" }, "integer", 2, { min: 1, max: 20 }),

    text({ key: "discordApplicationId", group: "discord", env: "DISCORD_APPLICATION_ID" }, snowflake),
    text(
      { key: "discordPublicKey", group: "discord", env: "DISCORD_PUBLIC_KEY" },
      z
        .string()
        .regex(/^[0-9a-f]{64}$/i, "expected 64 hex characters")
        .transform((key) => key.toLowerCase()),
    ),
    text({ key: "discordOwnerId", group: "discord", env: "DISCORD_OWNER_ID" }, snowflake),
    text({ key: "discordBotToken", group: "discord", env: "DISCORD_BOT_TOKEN" }, z.string().min(1), { secret: true }),
    text({ key: "discordGuildId", group: "discord", env: "DISCORD_GUILD_ID" }, snowflake),
    text({ key: "discordChannelId", group: "discord", env: "DISCORD_CHANNEL_ID" }, snowflake),

    text({ key: "mcpToken", group: "mcp", env: "MCP_TOKEN" }, token, { secret: true }),

    text({ key: "adminToken", group: "access", env: "ADMIN_TOKEN" }, token, { secret: true }),

    { key: "historyStart", group: "history", env: "HISTORY_START", type: "date", secret: false, default: null, schema: localDay },

    numeric({ key: "pollIntervalSeconds", group: "jobs", env: "POLL_INTERVAL_SECONDS" }, "integer", 300, { min: 60, unit: "seconds" }),
    numeric({ key: "enrichIntervalSeconds", group: "jobs", env: "ENRICH_INTERVAL_SECONDS" }, "number", 120, { min: 1, unit: "seconds" }),
    numeric({ key: "enrichBatchSize", group: "jobs", env: "ENRICH_BATCH_SIZE" }, "integer", 1, { min: 1, max: 20 }),
    numeric({ key: "artIntervalSeconds", group: "jobs", env: "ART_INTERVAL_SECONDS" }, "number", 4, { min: 1, unit: "seconds" }),
    numeric({ key: "spotifyMinIntervalMs", group: "jobs", env: "SPOTIFY_MIN_INTERVAL_MS" }, "integer", 2000, { min: 0, unit: "ms" }),
    numeric({ key: "quotaBackoffHours", group: "jobs", env: "QUOTA_BACKOFF_HOURS" }, "number", 12, { min: 1, unit: "hours" }),
    numeric({ key: "watcherActiveSeconds", group: "jobs", env: "WATCHER_ACTIVE_SECONDS" }, "number", 15, { min: 5, unit: "seconds" }),
    numeric({ key: "watcherIdleSeconds", group: "jobs", env: "WATCHER_IDLE_SECONDS" }, "number", 60, { min: 15, unit: "seconds" }),
    numeric({ key: "watcherBackoffMaxSeconds", group: "jobs", env: "WATCHER_BACKOFF_MAX_SECONDS" }, "number", 900, { min: 60, unit: "seconds" }),
    numeric({ key: "radarMinListens", group: "jobs", env: "RADAR_MIN_LISTENS" }, "integer", 20, { min: 1 }),
    numeric({ key: "radarIntervalMinutes", group: "jobs", env: "RADAR_INTERVAL_MINUTES" }, "number", 60, { min: 5, unit: "minutes" }),
    numeric({ key: "radarArtistsPerRun", group: "jobs", env: "RADAR_ARTISTS_PER_RUN" }, "integer", 2, { min: 1, max: 20 }),
    numeric({ key: "radarRecheckDays", group: "jobs", env: "RADAR_RECHECK_DAYS" }, "number", 7, { min: 1, unit: "days" }),
    numeric({ key: "radarBaselineDays", group: "jobs", env: "RADAR_BASELINE_DAYS" }, "integer", 30, { min: 0, unit: "days" }),
    numeric({ key: "librarySyncHours", group: "jobs", env: "LIBRARY_SYNC_HOURS" }, "number", 24, { min: 1, unit: "hours" }),
    numeric({ key: "libraryPageSeconds", group: "jobs", env: "LIBRARY_PAGE_SECONDS" }, "number", 20, { min: 2, unit: "seconds" }),
  ];
}

/** Turns an env string into the JSON value the field's schema checks. */
export function fromEnv(field: SettingField, raw: string): unknown {
  switch (field.type) {
    case "integer":
    case "number":
      return raw.trim() === "" ? Number.NaN : Number(raw);
    case "boolean":
      return raw === "true" ? true : raw === "false" ? false : raw;
    case "weekdays":
      return raw.split(",").map((day) => Number(day.trim()));
    default:
      return raw;
  }
}
