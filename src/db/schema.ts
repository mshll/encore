import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    artist: text("artist").notNull(),
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

export const plays = sqliteTable(
  "plays",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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
  },
  (t) => [
    index("plays_kind_day").on(t.kind, t.day),
    index("plays_track_day").on(t.trackUri, t.day),
    index("plays_ts").on(t.ts),
    index("plays_source_ts").on(t.source, t.ts),
  ],
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
  },
  (t) => [index("releases_date").on(t.releaseDate), index("releases_artist").on(t.artistId)],
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

export const CLEANUP_KINDS = ["saved_never_played", "saved_dislike", "playlist_skipped", "playlist_duplicate"] as const;
export const CLEANUP_STATUSES = ["open", "dismissed", "applied"] as const;
export type CleanupKind = (typeof CLEANUP_KINDS)[number];

export const cleanupProposals = sqliteTable(
  "cleanup_proposals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull().unique(),
    kind: text("kind", { enum: CLEANUP_KINDS }).notNull(),
    playlistId: text("playlist_id"),
    uri: text("uri").notNull(),
    evidence: text("evidence", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: CLEANUP_STATUSES }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("cleanup_proposals_status").on(t.status, t.kind)],
);

export type UndoAction =
  | { type: "library_save"; uris: string[] }
  | { type: "playlist_insert"; playlistId: string; uri: string; positions: number[] };

export const cleanupBatches = sqliteTable("cleanup_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  proposalIds: text("proposal_ids", { mode: "json" }).$type<number[]>().notNull(),
  undo: text("undo", { mode: "json" }).$type<UndoAction[]>().notNull(),
  appliedAt: integer("applied_at").notNull(),
  undoneAt: integer("undone_at"),
});

export * from "./assistantSchema";
