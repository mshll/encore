import type { Config } from "./config";
import type { Db } from "./db/client";
import { sessionConstraints } from "./dj/constraints";
import { AppPlaylists } from "./dj/playlists";
import { createLlmReplanner } from "./dj/llmReplan";
import { createDefaultReplanner, type Replanner } from "./dj/replan";
import { DjService } from "./dj/session";
import { Watcher } from "./ingest/live/watcher";
import { PlayerApi } from "./player/api";
import type { SettingsSource } from "./settings/settings";
import type { SpotifyClient } from "./spotify/client";
import { Llm, type Connect } from "./llm/client";
import { sdkConnect } from "./llm/sdk";
import type { LlmTransport } from "./llm/types";
import type { FeatureContext } from "./llm/context";

export type ServiceOptions = {
  now?: () => number;
  /** Defaults to the AI SDK with the current provider settings; pass null to disable or a fake in tests. */
  llmTransport?: LlmTransport | null;
  /** Picks the transport from the provider settings; in tests, a fake that looks at the key or model. Wins over `llmTransport`. */
  llmConnect?: Connect;
};

export function createServices(db: Db, config: Config, settings: SettingsSource, spotify: SpotifyClient, options: ServiceOptions = {}) {
  const now = options.now ?? Date.now;
  const transport = options.llmTransport;
  const llm = new Llm(db, settings, options.llmConnect ?? (transport === undefined ? sdkConnect() : () => transport), now);
  const assistant: FeatureContext = { db, config, settings, llm, spotify, now };
  const player = new PlayerApi(spotify);
  const watcher = new Watcher(db, player, settings, now);
  const playlists = new AppPlaylists(db, spotify, now);
  const deterministic = createDefaultReplanner(db, () => settings.get());
  const llmReplanner = createLlmReplanner(assistant, deterministic);
  const replanner: Replanner = (input) => (settings.get().djReplanner === "llm" ? llmReplanner : deterministic)(input);
  const dj = new DjService(db, player, playlists, replanner, () => settings.get().djSkipTrigger, now, (id) => sessionConstraints(db, id, settings.get().llm.constraints));
  watcher.subscribe((event) => dj.onWatchEvent(event));
  return { player, watcher, playlists, dj, llm, assistant };
}

export type Services = ReturnType<typeof createServices>;
