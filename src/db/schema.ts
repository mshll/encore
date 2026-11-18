import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { UserRule } from "../living/rules";

export const PLAY_KINDS = ["track", "episode", "audiobook", "video"] as const;
export const PLAY_SOURCES = ["export", "api", "live"] as const;
export const DEVICES = ["ios", "android", "mac", "windows", "linux", "web", "console", "tv", "speaker", "car", "unknown", "other"] as const;

export type PlayKind = (typeof PLAY_KINDS)[number];
export type PlaySource = (typeof PLAY_SOURCES)[number];
export type Device = (typeof DEVICES)[number];

export const tracks = sqliteTable(
  "tracks",
  {
    uri: text("uri").primaryKey(),
    name: text("name").notNull(),
    /** The artist the track counts as: the credited artist, or its canonical artist when the credit is an alias. */
    artist: text("artist").notNull(),
    /** Spotify's credited artist, kept only while an alias rewrites `artist`. */
    artistCredit: text("artist_credit"),
    album: text("album"),
    songKey: text("song_key").notNull(),
    durationMs: integer("duration_ms"),
    releaseDate: text("release_date"),
    albumArtUrl: text("album_art_url"),
    enrichedAt: integer("enriched_at"),
    enrichAttempts: integer("enrich_attempts").notNull().default(0),
    artAttempts: integer("art_attempts").notNull().default(0),
  },
  (t) => [index("tracks_song_key").on(t.songKey), index("tracks_artist").on(t.artist), index("tracks_album").on(t.artist, t.album)],
);

const playColumns = () => ({
  dedupeKey: text("dedupe_key").notNull().unique(),
  ts: integer("ts").notNull(),
  day: text("day").notNull(),
  hour: integer("hour").notNull(),
  weekday: integer("weekday").notNull(),
  kind: text("kind", { enum: PLAY_KINDS }).notNull(),
  trackUri: text("track_uri").references(() => tracks.uri),
  episodeUri: text("episode_uri"),
  episodeName: text("episode_name"),
  showName: text("show_name"),
  msPlayed: integer("ms_played"),
  reasonStart: text("reason_start"),
  reasonEnd: text("reason_end"),
  skipped: integer("skipped", { mode: "boolean" }),
  shuffle: integer("shuffle", { mode: "boolean" }),
  offline: integer("offline", { mode: "boolean" }),
  incognito: integer("incognito", { mode: "boolean" }),
  device: text("device", { enum: DEVICES }).notNull(),
  platformRaw: text("platform_raw"),
  connCountry: text("conn_country"),
  source: text("source", { enum: PLAY_SOURCES }).notNull(),
  contextUri: text("context_uri"),
});

export const plays = sqliteTable(
  "plays",
  { id: integer("id").primaryKey({ autoIncrement: true }), ...playColumns() },
  (t) => [
    index("plays_kind_day").on(t.kind, t.day),
    index("plays_track_day").on(t.trackUri, t.day),
    index("plays_ts").on(t.ts),
    index("plays_source_ts").on(t.source, t.ts),
  ],
);

/** Plays the owner deleted, moved out of `plays` so no query counts them. Restore moves the row back with its id. */
export const playTrash = sqliteTable(
  "play_trash",
  { id: integer("id").primaryKey(), ...playColumns(), trashedAt: integer("trashed_at").notNull() },
  (t) => [index("play_trash_ts").on(t.ts)],
);

/** Every deleted play, kept after the trash is emptied, so no import, poll or watcher stores it again. */
export const playTombstones = sqliteTable(
  "play_tombstones",
  {
    dedupeKey: text("dedupe_key").primaryKey(),
    source: text("source", { enum: PLAY_SOURCES }).notNull(),
    trackUri: text("track_uri"),
    ts: integer("ts").notNull(),
    msPlayed: integer("ms_played"),
    deletedAt: integer("deleted_at").notNull(),
  },
  (t) => [index("play_tombstones_track_ts").on(t.trackUri, t.ts)],
);

/** "Count `alias` as `canonical`": artist names as tracks credit them. A canonical artist is never itself an alias. */
export const artistAliases = sqliteTable(
  "artist_aliases",
  {
    alias: text("alias").primaryKey(),
    canonical: text("canonical").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("artist_aliases_canonical").on(t.canonical)],
);

export const artists = sqliteTable(
  "artists",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    imageUrl: text("image_url"),
    fetchedAt: integer("fetched_at"),
    fetchAttempts: integer("fetch_attempts").notNull().default(0),
  },
  (t) => [index("artists_name").on(t.name)],
);

export const trackArtists = sqliteTable(
  "track_artists",
  {
    trackUri: text("track_uri")
      .notNull()
      .references(() => tracks.uri),
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.trackUri, t.position] }), index("track_artists_artist").on(t.artistId)],
);

export const trackTags = sqliteTable("track_tags", {
  songKey: text("song_key").primaryKey(),
  trackUri: text("track_uri").notNull(),
  genres: text("genres", { mode: "json" }).$type<string[]>().notNull(),
  subgenre: text("subgenre"),
  moods: text("moods", { mode: "json" }).$type<string[]>().notNull(),
  energy: integer("energy").notNull(),
  valence: integer("valence").notNull(),
  language: text("language").notNull(),
  model: text("model").notNull(),
  confidence: text("confidence", { enum: ["low", "med", "high"] }).notNull(),
  taggedAt: integer("tagged_at").notNull(),
});

export const spotifyAuth = sqliteTable("spotify_auth", {
  id: integer("id").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: integer("expires_at").notNull(),
  scope: text("scope").notNull(),
  spotifyUserId: text("spotify_user_id"),
  clientId: text("client_id"),
  updatedAt: integer("updated_at").notNull(),
});

/** Settings edited from the dashboard, keyed by field key. `value` is JSON; a secret's is the sealed string. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(),
  codeVerifier: text("code_verifier").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const passkeys = sqliteTable("passkeys", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull(),
  transports: text("transports", { mode: "json" }).$type<string[]>(),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
});

export const sessions = sqliteTable("sessions", {
  idHash: text("id_hash").primaryKey(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const jobState = sqliteTable("job_state", {
  name: text("name").primaryKey(),
  lastRunAt: integer("last_run_at"),
  lastSuccessAt: integer("last_success_at"),
  lastError: text("last_error"),
  data: text("data", { mode: "json" }).$type<Record<string, unknown>>(),
});

export const appPlaylists = sqliteTable("app_playlists", {
  purpose: text("purpose").primaryKey(),
  playlistId: text("playlist_id").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const DJ_STATUSES = ["active", "stopped", "ended"] as const;
export type DjOutcome = { uri: string; outcome: "finished" | "skipped" };

export const djSessions = sqliteTable("dj_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  playlistId: text("playlist_id").notNull(),
  status: text("status", { enum: DJ_STATUSES }).notNull(),
  uris: text("uris", { mode: "json" }).$type<string[]>().notNull(),
  position: integer("position").notNull(),
  outcomes: text("outcomes", { mode: "json" }).$type<DjOutcome[]>().notNull(),
  skipStreak: integer("skip_streak").notNull().default(0),
  replans: integer("replans").notNull().default(0),
  replannedAt: integer("replanned_at"),
  replanSkips: integer("replan_skips"),
  startedAt: integer("started_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  endedAt: integer("ended_at"),
  endReason: text("end_reason"),
});

export const radarArtists = sqliteTable("radar_artists", {
  artistId: text("artist_id").primaryKey(),
  lastCheckedAt: integer("last_checked_at").notNull(),
});

export const releases = sqliteTable(
  "releases",
  {
    id: text("id").primaryKey(),
    uri: text("uri").notNull(),
    artistId: text("artist_id").notNull(),
    artistName: text("artist_name").notNull(),
    name: text("name").notNull(),
    albumType: text("album_type").notNull(),
    releaseDate: text("release_date").notNull(),
    totalTracks: integer("total_tracks"),
    imageUrl: text("image_url"),
    firstSeenAt: integer("first_seen_at").notNull(),
    isNew: integer("is_new", { mode: "boolean" }).notNull(),
    seenAt: integer("seen_at"),
    /** When the release's track list was stored in `release_tracks`. */
    tracksFetchedAt: integer("tracks_fetched_at"),
  },
  (t) => [index("releases_date").on(t.releaseDate), index("releases_artist").on(t.artistId)],
);

/** The first tracks of a new release, from one album tracks call, for the New from your artists playlist. */
export const releaseTracks = sqliteTable(
  "release_tracks",
  {
    releaseId: text("release_id").notNull(),
    position: integer("position").notNull(),
    uri: text("uri").notNull(),
    songKey: text("song_key").notNull(),
    name: text("name").notNull(),
    artist: text("artist").notNull(),
  },
  (t) => [primaryKey({ columns: [t.releaseId, t.position] })],
);

export const savedTracks = sqliteTable("saved_tracks", {
  uri: text("uri").primaryKey(),
  addedAt: integer("added_at").notNull(),
  syncedAt: integer("synced_at").notNull(),
});

export const ownedPlaylists = sqliteTable("owned_playlists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  snapshotId: text("snapshot_id"),
  itemCount: integer("item_count").notNull(),
  syncedAt: integer("synced_at"),
});

export const playlistItems = sqliteTable(
  "playlist_items",
  {
    playlistId: text("playlist_id").notNull(),
    position: integer("position").notNull(),
    uri: text("uri").notNull(),
    addedAt: integer("added_at"),
  },
  (t) => [primaryKey({ columns: [t.playlistId, t.position] }), index("playlist_items_uri").on(t.uri)],
);

export const RULE_KINDS = ["saved_never_played", "saved_dislike", "playlist_skipped", "playlist_duplicate"] as const;
export const CLEANUP_KINDS = [...RULE_KINDS, "plan"] as const;
export const CLEANUP_STATUSES = ["open", "dismissed", "applied", "skipped"] as const;
export const PLAN_ACTIONS = ["archive", "remove", "save", "add", "dedupe"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export type CleanupKind = (typeof CLEANUP_KINDS)[number];
export type PlanAction = (typeof PLAN_ACTIONS)[number];

export const PLAN_SOURCES = ["rule", "analysis", "claude", "standing"] as const;
export const PLAN_STATUSES = ["open", "applied", "dismissed"] as const;
export type PlanSource = (typeof PLAN_SOURCES)[number];

/** A named batch of proposed library actions. Rule plans (one per rule kind) stay open and are refreshed after each library sync. */
export const libraryPlans = sqliteTable("library_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source", { enum: PLAN_SOURCES }).notNull(),
  ruleKind: text("rule_kind", { enum: RULE_KINDS }).unique(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  /** The owner's instruction, for plans Claude made. */
  request: text("request"),
  threadId: integer("thread_id"),
  standingId: integer("standing_id"),
  status: text("status", { enum: PLAN_STATUSES }).notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const STANDING_CADENCES = ["weekly", "monthly"] as const;

/** A saved instruction a job hands to Claude on a schedule. The plan it makes waits for the owner; nothing applies by itself. */
export const libraryStanding = sqliteTable("library_standing", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  instruction: text("instruction").notNull(),
  cadence: text("cadence", { enum: STANDING_CADENCES }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  lastRunAt: integer("last_run_at"),
  lastPlanId: integer("last_plan_id"),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** The items of every plan. Named for the rule proposals they began as; `plan_id` is null only on rows from before plans, until `ensureRulePlans` assigns them. */
export const cleanupProposals = sqliteTable(
  "cleanup_proposals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull().unique(),
    kind: text("kind", { enum: CLEANUP_KINDS }).notNull(),
    planId: integer("plan_id"),
    /** Null on rows from before plans: the rule kind's default action applies. */
    action: text("action", { enum: PLAN_ACTIONS }),
    /** Where the action applies: a playlist id, or null for the liked songs. */
    playlistId: text("playlist_id"),
    uri: text("uri").notNull(),
    included: integer("included", { mode: "boolean" }).notNull().default(true),
    reason: text("reason"),
    evidence: text("evidence", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: CLEANUP_STATUSES }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("cleanup_proposals_status").on(t.status, t.kind), index("cleanup_proposals_plan").on(t.planId, t.status)],
);

export type UndoAction =
  | { type: "library_save"; uris: string[] }
  | { type: "library_remove"; uris: string[] }
  | { type: "playlist_insert"; playlistId: string; uri: string; positions: number[] }
  | { type: "playlist_remove"; playlistId: string; uris: string[] }
  | { type: "archive_remove"; playlistId: string; uris: string[] };

export const BATCH_STATUSES = ["running", "done", "partial", "failed"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];
export type SkippedItem = { id: number; reason: string };

export const cleanupBatches = sqliteTable("cleanup_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  planId: integer("plan_id"),
  /** Items that were applied. */
  proposalIds: text("proposal_ids", { mode: "json" }).$type<number[]>().notNull(),
  /** Items chosen when the apply started. */
  selectedIds: text("selected_ids", { mode: "json" }).$type<number[]>().notNull().default([]),
  skipped: text("skipped", { mode: "json" }).$type<SkippedItem[]>().notNull().default([]),
  /** What undo sends, in order. Written after each Spotify write that succeeded, so it matches what was applied even when the apply stops part way. */
  undo: text("undo", { mode: "json" }).$type<UndoAction[]>().notNull(),
  status: text("status", { enum: BATCH_STATUSES }).notNull().default("done"),
  error: text("error"),
  calls: integer("calls").notNull().default(0),
  appliedAt: integer("applied_at").notNull(),
  finishedAt: integer("finished_at"),
  undoStatus: text("undo_status", { enum: ["running", "done", "failed"] }),
  undoError: text("undo_error"),
  undoneAt: integer("undone_at"),
});

export const LIVING_KINDS = ["picks", "forgotten", "most-played", "new-releases", "this-month", "this-year", "right-now"] as const;
export type LivingKind = (typeof LIVING_KINDS)[number];
export const LIVING_STATUSES = ["refreshed", "unchanged", "empty", "deferred", "failed", "removed"] as const;
export type LivingStatus = (typeof LIVING_STATUSES)[number];
export const LIVING_TRIGGERS = ["enable", "schedule", "manual", "picks", "year-end"] as const;
export type LivingTrigger = (typeof LIVING_TRIGGERS)[number];
export type LivingTrack = { uri: string; songKey: string; name: string; artist: string; album: string | null; albumArtUrl: string | null };

/**
 * A playlist in the owner's account that encore keeps refilling, the same Spotify playlist for good. `kind` is a built-in
 * kind (`LIVING_KINDS`) or the id of one of the owner's rules, which also has `name` and `rule`.
 */
export const livingPlaylists = sqliteTable("living_playlists", {
  kind: text("kind").primaryKey(),
  name: text("name"),
  about: text("about"),
  rule: text("rule", { mode: "json" }).$type<UserRule>(),
  /** When the owner made the rule; null for built-ins. */
  definedAt: integer("defined_at"),
  /** Scheduled refreshes skip a frozen playlist; Refresh now still fills it. */
  frozen: integer("frozen", { mode: "boolean" }).notNull().default(false),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  playlistId: text("playlist_id"),
  playlistUrl: text("playlist_url"),
  createdAt: integer("created_at"),
  /** The owner deleted the playlist in Spotify. Switching the kind on again makes a new one. */
  removedAt: integer("removed_at"),
  /** Cover key of the image last uploaded to the playlist. */
  coverUploadKey: text("cover_upload_key"),
  /** Outcome of the last attempt, with its error when it failed. */
  status: text("status", { enum: LIVING_STATUSES }),
  error: text("error"),
  attemptedAt: integer("attempted_at"),
  /** Last attempt that reached a result: refreshed, unchanged or empty. The schedule counts from here. */
  checkedAt: integer("checked_at"),
  updatedAt: integer("updated_at").notNull(),
});

/** Every refresh that changed a living playlist, with its full contents afterwards and what it added and removed. */
export const livingRefreshes = sqliteTable(
  "living_refreshes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").notNull(),
    playlistId: text("playlist_id").notNull(),
    trigger: text("trigger", { enum: LIVING_TRIGGERS }).notNull(),
    items: text("items", { mode: "json" }).$type<LivingTrack[]>().notNull(),
    added: text("added", { mode: "json" }).$type<LivingTrack[]>().notNull(),
    removed: text("removed", { mode: "json" }).$type<LivingTrack[]>().notNull(),
    calls: integer("calls").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [index("living_refreshes_kind").on(t.kind, t.at)],
);

/** An MCP client registered through OAuth dynamic client registration (RFC 7591). Public clients only: no secret. */
export const oauthClients = sqliteTable("oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris", { mode: "json" }).$type<string[]>().notNull(),
  createdAt: integer("created_at").notNull(),
});

/** One connection the owner allowed: a client holding tokens for `/mcp`. Disconnecting deletes it and its tokens. */
export const oauthGrants = sqliteTable(
  "oauth_grants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    scope: text("scope").notNull(),
    resource: text("resource").notNull(),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => [index("oauth_grants_client").on(t.clientId)],
);

/** Authorization codes, stored as SHA-256 hashes. A code is single use: a second use revokes what the first one issued. */
export const oauthCodes = sqliteTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scope: text("scope").notNull(),
  resource: text("resource").notNull(),
  expiresAt: integer("expires_at").notNull(),
  /** Set when the code is exchanged, with the grant it created. */
  grantId: integer("grant_id"),
  usedAt: integer("used_at"),
});

export const OAUTH_TOKEN_KINDS = ["access", "refresh"] as const;

/** Access and refresh tokens, stored as SHA-256 hashes. */
export const oauthTokens = sqliteTable(
  "oauth_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    grantId: integer("grant_id")
      .notNull()
      .references(() => oauthGrants.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: OAUTH_TOKEN_KINDS }).notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("oauth_tokens_grant").on(t.grantId)],
);

export * from "./assistantSchema";
