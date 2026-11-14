import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const PLAY_KINDS = ["track", "episode", "audiobook", "video"] as const;
export const PLAY_SOURCES = ["export", "api"] as const;
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
  },
  (t) => [
    index("plays_kind_day").on(t.kind, t.day),
    index("plays_track_day").on(t.trackUri, t.day),
    index("plays_ts").on(t.ts),
    index("plays_source_ts").on(t.source, t.ts),
  ],
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
