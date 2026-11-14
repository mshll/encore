import type { Config } from "./config";
import type { Db } from "./db/client";
import { AppPlaylists } from "./dj/playlists";
import { createDefaultReplanner } from "./dj/replan";
import { DjService } from "./dj/session";
import { Watcher } from "./ingest/live/watcher";
import { PlayerApi } from "./player/api";
import type { SpotifyClient } from "./spotify/client";

export function createServices(db: Db, config: Config, spotify: SpotifyClient, now: () => number = Date.now) {
  const player = new PlayerApi(spotify);
  const watcher = new Watcher(db, player, config, now);
  const playlists = new AppPlaylists(db, spotify, now);
  const dj = new DjService(db, player, playlists, createDefaultReplanner(db, config.timezone), { skipTrigger: config.djSkipTrigger }, now);
  watcher.subscribe((event) => dj.onWatchEvent(event));
  return { player, watcher, playlists, dj };
}

export type Services = ReturnType<typeof createServices>;
