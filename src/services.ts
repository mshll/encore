import type { Config } from "./config";
import type { Db } from "./db/client";
import { AppPlaylists } from "./dj/playlists";
import { createDefaultReplanner } from "./dj/replan";
import { DjService } from "./dj/session";
import { Watcher } from "./ingest/live/watcher";
import { PlayerApi } from "./player/api";
import type { SpotifyClient } from "./spotify/client";
import { Llm, sdkTransport, type LlmTransport } from "./llm/client";
import type { FeatureContext } from "./llm/context";

/** `llmTransport` defaults to the Anthropic SDK when ANTHROPIC_API_KEY is set; pass null to disable or a fake in tests. */
export function createServices(db: Db, config: Config, spotify: SpotifyClient, now: () => number = Date.now, llmTransport?: LlmTransport | null) {
  const llm = new Llm(db, config, llmTransport === undefined ? (config.llm.apiKey ? sdkTransport(config.llm.apiKey) : null) : llmTransport, now);
  const assistant: FeatureContext = { db, config, llm, spotify, now };
  const player = new PlayerApi(spotify);
  const watcher = new Watcher(db, player, config, now);
  const playlists = new AppPlaylists(db, spotify, now);
  const dj = new DjService(db, player, playlists, createDefaultReplanner(db, config.timezone), { skipTrigger: config.djSkipTrigger }, now);
  watcher.subscribe((event) => dj.onWatchEvent(event));
  return { player, watcher, playlists, dj, llm, assistant };
}

export type Services = ReturnType<typeof createServices>;
