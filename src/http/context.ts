import type { Config } from "../config";
import type { Db } from "../db/client";
import type { AlertMonitor } from "../alerts/monitor";
import type { Passkeys } from "../auth/passkeys";
import type { Backups } from "../backup/service";
import type { DiscordSource } from "../discord";
import type { Jobs } from "../jobs/definitions";
import type { Services } from "../services";
import type { SettingsStore } from "../settings/store";
import type { SpotifyAuth } from "../spotify/auth";
import type { SpotifyClient } from "../spotify/client";

export type Deps = {
  db: Db;
  config: Config;
  settings: SettingsStore;
  passkeys: Passkeys;
  spotifyAuth: SpotifyAuth;
  spotify: SpotifyClient;
  jobs: Jobs;
  services: Services;
  discord: DiscordSource;
  ops: { backups: Backups; alerts: AlertMonitor };
  now: () => number;
};

export type Env = { Variables: { deps: Deps } };
