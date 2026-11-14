import type { Config } from "./config";
import type { Db } from "./db/client";
import { AppPlaylists } from "./dj/playlists";
import { createLlmReplanner } from "./dj/llmReplan";
import { createDefaultReplanner, type Replanner } from "./dj/replan";
import { DjService } from "./dj/session";
import { Watcher } from "./ingest/live/watcher";
import { PlayerApi } from "./player/api";
import type { SettingsSource } from "./settings/settings";
import type { SpotifyClient } from "./spotify/client";
import { keyedSdkTransport, Llm, sdkKeyCheck, type LlmKeyCheck, type LlmTransport } from "./llm/client";
import type { FeatureContext } from "./llm/context";

export type ServiceOptions = {
  now?: () => number;
  /** Defaults to the Anthropic SDK with the current API key; pass null to disable or a fake in tests. */
  llmTransport?: LlmTransport | null;
  llmKeyCheck?: LlmKeyCheck;
};

export function createServices(db: Db, config: Config, settings: SettingsSource, spotify: SpotifyClient, options: ServiceOptions = {}) {
  const now = options.now ?? Date.now;
  const transport = options.llmTransport;
  const llm = new Llm(db, settings, transport === undefined ? keyedSdkTransport(settings) : () => transport, now);
  const assistant: FeatureContext = { db, config, settings, llm, spotify, now };
  const player = new PlayerApi(spotify);
  const watcher = new Watcher(db, player, settings, now);
  const playlists = new AppPlaylists(db, spotify, now);
  const deterministic = createDefaultReplanner(db, () => settings.get().timezone);
  const llmReplanner = createLlmReplanner(assistant, deterministic);
  const replanner: Replanner = (input) => (settings.get().djReplanner === "llm" ? llmReplanner : deterministic)(input);
  const dj = new DjService(db, player, playlists, replanner, () => settings.get().djSkipTrigger, now);
  watcher.subscribe((event) => dj.onWatchEvent(event));
  return { player, watcher, playlists, dj, llm, assistant, llmKeyCheck: options.llmKeyCheck ?? sdkKeyCheck };
}

export type Services = ReturnType<typeof createServices>;
