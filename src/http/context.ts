import type { Config } from "../config";
import type { Db } from "../db/client";
import type { Passkeys } from "../auth/passkeys";
import type { Discord } from "../discord";
import type { Jobs } from "../jobs/definitions";
import type { Services } from "../services";
import type { SpotifyAuth } from "../spotify/auth";
import type { SpotifyClient } from "../spotify/client";

export type Deps = {
  db: Db;
  config: Config;
  passkeys: Passkeys;
  spotifyAuth: SpotifyAuth;
  spotify: SpotifyClient;
  jobs: Jobs;
  services: Services;
  discord: Discord | null;
  now: () => number;
};

export type Env = { Variables: { deps: Deps } };
