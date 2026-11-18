import type { ModelPrice } from "../config";
import type { ConstraintDefaults } from "../library/constraints";

export type DiscordConfig = {
  botToken?: string;
  applicationId: string;
  publicKey: string;
  guildId?: string;
  channelId?: string;
  ownerId: string;
};

export type LlmConfig = {
  apiKey?: string;
  model: string;
  prices: Record<string, ModelPrice>;
  webSearchPerRequest: number;
  monthlyBudgetUsd: number;
  picksPerWeek: number;
  picksFarOut: number;
  picksSlot: { weekday: number; hour: number };
  digestSlot: { weekday: number; hour: number };
  /** Applied to new sets, weekly picks and DJ sessions not started from a set. */
  constraints: ConstraintDefaults;
};

/** Settings resolved from env, the settings table and defaults, in the units services use. */
export type Settings = {
  spotifyClientId?: string;
  timezone: string;
  homeCountry?: string;
  weekendDays: number[];
  /** Plays before this local day (YYYY-MM-DD) are never stored. */
  historyStart?: string;
  pollIntervalMs: number;
  enrichIntervalMs: number;
  enrichBatchSize: number;
  artIntervalMs: number;
  spotifyIntervalMs: number;
  quotaBackoffMs: number;
  watcherActiveMs: number;
  watcherIdleMs: number;
  watcherBackoffMaxMs: number;
  djSkipTrigger: number;
  djReplanner: "deterministic" | "llm";
  djReplanTimeoutMs: number;
  radarMinListens: number;
  radarIntervalMs: number;
  radarArtistsPerRun: number;
  radarRecheckMs: number;
  radarBaselineDays: number;
  librarySyncMs: number;
  libraryPageMs: number;
  llm: LlmConfig;
  discord: DiscordConfig | null;
  mcpToken?: string;
  /** OAuth sign-in for `/mcp`, for clients such as claude.ai that cannot send a fixed token. */
  mcpOAuth: boolean;
  adminToken?: string;
};

/** Read on each use, so a change made from the dashboard reaches every service without a restart. */
export interface SettingsSource {
  get(): Settings;
}

/** Field values after precedence, keyed as in `settingFields`. Optional fields are absent when unset. */
export type RawSettings = {
  spotifyClientId?: string;
  timezone: string;
  homeCountry?: string;
  weekendDays: number[];
  historyStart?: string;
  claudeApiKey?: string;
  claudeModel: string;
  monthlyBudgetUsd: number;
  defaultMaxPerArtist?: number;
  defaultMaxPerAlbum?: number;
  defaultNewSongs?: number;
  picksPerWeek: number;
  picksFarOut: number;
  picksWeekday: number;
  picksHour: number;
  digestWeekday: number;
  digestHour: number;
  djReplanner: "deterministic" | "llm";
  djReplanTimeoutSeconds: number;
  djSkipTrigger: number;
  discordApplicationId?: string;
  discordPublicKey?: string;
  discordOwnerId?: string;
  discordBotToken?: string;
  discordGuildId?: string;
  discordChannelId?: string;
  mcpToken?: string;
  mcpOAuth: boolean;
  adminToken?: string;
  pollIntervalSeconds: number;
  enrichIntervalSeconds: number;
  enrichBatchSize: number;
  artIntervalSeconds: number;
  spotifyMinIntervalMs: number;
  quotaBackoffHours: number;
  watcherActiveSeconds: number;
  watcherIdleSeconds: number;
  watcherBackoffMaxSeconds: number;
  radarMinListens: number;
  radarIntervalMinutes: number;
  radarArtistsPerRun: number;
  radarRecheckDays: number;
  radarBaselineDays: number;
  librarySyncHours: number;
  libraryPageSeconds: number;
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function resolveSettings(v: RawSettings, prices: Record<string, ModelPrice>): Settings {
  return {
    spotifyClientId: v.spotifyClientId,
    timezone: v.timezone,
    homeCountry: v.homeCountry,
    weekendDays: v.weekendDays,
    historyStart: v.historyStart,
    pollIntervalMs: v.pollIntervalSeconds * SECOND,
    enrichIntervalMs: v.enrichIntervalSeconds * SECOND,
    enrichBatchSize: v.enrichBatchSize,
    artIntervalMs: v.artIntervalSeconds * SECOND,
    spotifyIntervalMs: v.spotifyMinIntervalMs,
    quotaBackoffMs: v.quotaBackoffHours * HOUR,
    watcherActiveMs: v.watcherActiveSeconds * SECOND,
    watcherIdleMs: v.watcherIdleSeconds * SECOND,
    watcherBackoffMaxMs: v.watcherBackoffMaxSeconds * SECOND,
    djSkipTrigger: v.djSkipTrigger,
    djReplanner: v.djReplanner,
    djReplanTimeoutMs: v.djReplanTimeoutSeconds * SECOND,
    radarMinListens: v.radarMinListens,
    radarIntervalMs: v.radarIntervalMinutes * MINUTE,
    radarArtistsPerRun: v.radarArtistsPerRun,
    radarRecheckMs: v.radarRecheckDays * DAY,
    radarBaselineDays: v.radarBaselineDays,
    librarySyncMs: v.librarySyncHours * HOUR,
    libraryPageMs: v.libraryPageSeconds * SECOND,
    llm: {
      apiKey: v.claudeApiKey,
      model: v.claudeModel,
      prices,
      webSearchPerRequest: 0.01,
      monthlyBudgetUsd: v.monthlyBudgetUsd,
      picksPerWeek: v.picksPerWeek,
      picksFarOut: Math.min(v.picksFarOut, v.picksPerWeek),
      picksSlot: { weekday: v.picksWeekday, hour: v.picksHour },
      digestSlot: { weekday: v.digestWeekday, hour: v.digestHour },
      constraints: { maxPerArtist: v.defaultMaxPerArtist ?? null, maxPerAlbum: v.defaultMaxPerAlbum ?? null, newSongs: v.defaultNewSongs ?? null },
    },
    discord:
      v.discordApplicationId && v.discordPublicKey && v.discordOwnerId
        ? {
            botToken: v.discordBotToken,
            applicationId: v.discordApplicationId,
            publicKey: v.discordPublicKey,
            guildId: v.discordGuildId,
            channelId: v.discordChannelId,
            ownerId: v.discordOwnerId,
          }
        : null,
    mcpToken: v.mcpToken,
    mcpOAuth: v.mcpOAuth,
    adminToken: v.adminToken,
  };
}
