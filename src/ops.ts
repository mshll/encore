import { AlertMonitor } from "./alerts/monitor";
import { Backups } from "./backup/service";
import type { RemoteStore } from "./backup/remote";
import type { Config } from "./config";
import type { Db } from "./db/client";
import type { DiscordSource } from "./discord";
import type { Job } from "./jobs/scheduler";
import { backupDirFor } from "./plays/historyStart";
import { secretValues } from "./settings/redact";
import type { S3Settings } from "./settings/settings";
import type { SettingsStore } from "./settings/store";
import type { SpotifyAuth } from "./spotify/auth";
import type { SpotifyClient } from "./spotify/client";

export type OpsDeps = {
  db: Db;
  config: Config;
  settings: SettingsStore;
  spotifyAuth: SpotifyAuth;
  spotify: SpotifyClient;
  discord: DiscordSource;
  fetchFn?: typeof fetch;
  remote?: (settings: S3Settings) => RemoteStore;
  now?: () => number;
};

export type Ops = { backups: Backups; alerts: AlertMonitor };

/** Backups and alerts: the parts that keep an instance safe to leave running. */
export function createOps({ db, config, settings, spotifyAuth, spotify, discord, fetchFn, remote, now }: OpsDeps): Ops {
  return {
    backups: new Backups({ db, dir: backupDirFor(config.databasePath), settings, remote, now }),
    alerts: new AlertMonitor({
      db,
      settings,
      secrets: () => secretValues(settings),
      spotifyAuth,
      spotify,
      discord,
      pollEnabled: config.jobsEnabled && !config.disabledJobs.includes("poll"),
      fetchFn,
      now,
    }),
  };
}

export const opsJobs = (ops: Ops, config: Pick<Config, "disabledJobs">): Job[] => [ops.backups.job(), ops.alerts.job()].filter((job) => !config.disabledJobs.includes(job.name));
