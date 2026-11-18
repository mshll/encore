import type { ConstraintDefaults } from "../library/constraints";
import { DEFAULT_MODELS, hasWebSearch, type KnownModel } from "../llm/providers";
import type { AiProvider } from "../llm/types";

export type DiscordConfig = {
  botToken?: string;
  applicationId: string;
  publicKey: string;
  guildId?: string;
  channelId?: string;
  ownerId: string;
};

/** Which provider and model AI features use. `model` is null only for an OpenAI-compatible server with no model set. */
export type AiConfig = {
  provider: AiProvider;
  model: string | null;
  apiKey?: string;
  baseUrl?: string;
  /** USD per million tokens the owner entered, for a model encore has no price for. */
  ownerPrice: { input: number; output: number } | null;
  webSearch: boolean;
};

export type LlmConfig = {
  ai: AiConfig;
  prices: Record<string, KnownModel>;
  monthlyBudgetUsd: number;
  picksPerWeek: number;
  picksFarOut: number;
  picksSlot: { weekday: number; hour: number };
  digestSlot: { weekday: number; hour: number };
  /** Applied to new sets, weekly picks and DJ sessions not started from a set. */
  constraints: ConstraintDefaults;
};

export type S3Settings = { endpoint: string; bucket: string; region?: string; accessKeyId: string; secretAccessKey: string };

export type BackupConfig = { intervalMs: number; keep: number; s3: S3Settings | null };

export type NtfyConfig = { url: string; topic: string; token?: string };

export type AlertsConfig = { ntfy: NtfyConfig | null; discordWebhookUrl?: string; discordChannel: boolean; pollStaleMs: number };

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
  backup: BackupConfig;
  alerts: AlertsConfig;
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
  aiProvider: AiProvider;
  aiModel?: string;
  aiApiKey?: string;
  aiBaseUrl?: string;
  aiInputPrice?: number;
  aiOutputPrice?: number;
  claudeApiKey?: string;
  claudeModel?: string;
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
  backupIntervalHours: number;
  backupKeep: number;
  backupS3Endpoint?: string;
  backupS3Bucket?: string;
  backupS3Region?: string;
  backupS3AccessKeyId?: string;
  backupS3SecretAccessKey?: string;
  alertNtfyUrl: string;
  alertNtfyTopic?: string;
  alertNtfyToken?: string;
  alertDiscordWebhookUrl?: string;
  alertDiscordChannel: boolean;
  alertPollStaleHours: number;
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The new `ai*` fields win; with none set, ANTHROPIC_API_KEY and LLM_MODEL (or their stored values) configure Anthropic. */
export function resolveAi(v: RawSettings): AiConfig {
  const provider = v.aiProvider;
  const anthropic = provider === "anthropic";
  return {
    provider,
    model: v.aiModel ?? (anthropic ? v.claudeModel : undefined) ?? DEFAULT_MODELS[provider],
    apiKey: v.aiApiKey ?? (anthropic ? v.claudeApiKey : undefined),
    baseUrl: provider === "openai-compatible" ? v.aiBaseUrl : undefined,
    ownerPrice: v.aiInputPrice !== undefined && v.aiOutputPrice !== undefined ? { input: v.aiInputPrice, output: v.aiOutputPrice } : null,
    webSearch: hasWebSearch(provider),
  };
}

/** Whether the settings name everything a call needs: a model, and a key (or, for an OpenAI-compatible server, its address). */
export const aiReady = (ai: AiConfig): boolean => ai.model !== null && (ai.provider === "openai-compatible" ? ai.baseUrl !== undefined : ai.apiKey !== undefined);

export function resolveSettings(v: RawSettings, prices: Record<string, KnownModel>): Settings {
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
      ai: resolveAi(v),
      prices,
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
    backup: {
      intervalMs: v.backupIntervalHours * HOUR,
      keep: v.backupKeep,
      s3:
        v.backupS3Endpoint && v.backupS3Bucket && v.backupS3AccessKeyId && v.backupS3SecretAccessKey
          ? { endpoint: v.backupS3Endpoint, bucket: v.backupS3Bucket, region: v.backupS3Region, accessKeyId: v.backupS3AccessKeyId, secretAccessKey: v.backupS3SecretAccessKey }
          : null,
    },
    alerts: {
      ntfy: v.alertNtfyTopic ? { url: v.alertNtfyUrl, topic: v.alertNtfyTopic, token: v.alertNtfyToken } : null,
      discordWebhookUrl: v.alertDiscordWebhookUrl,
      discordChannel: v.alertDiscordChannel,
      pollStaleMs: v.alertPollStaleHours * HOUR,
    },
  };
}
