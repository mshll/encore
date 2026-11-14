import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const LLM_FEATURES = ["sets", "picks", "ask", "notes", "digest"] as const;
export type LlmFeature = (typeof LLM_FEATURES)[number];

export const PICK_STATES = ["new", "saved", "not_now", "never"] as const;
export type PickState = (typeof PICK_STATES)[number];

export const llmCalls = sqliteTable(
  "llm_calls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: integer("ts").notNull(),
    month: text("month").notNull(),
    feature: text("feature", { enum: LLM_FEATURES }).notNull(),
    ref: text("ref"),
    requestedModel: text("requested_model").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull(),
    cacheWriteTokens: integer("cache_write_tokens").notNull(),
    webSearches: integer("web_searches").notNull(),
    usd: real("usd").notNull(),
    stopReason: text("stop_reason"),
    durationMs: integer("duration_ms").notNull(),
  },
  (t) => [index("llm_calls_month").on(t.month, t.feature)],
);

export const llmThreads = sqliteTable("llm_threads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  feature: text("feature", { enum: LLM_FEATURES }).notNull(),
  system: text("system").notNull(),
  messages: text("messages", { mode: "json" }).$type<unknown[]>().notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const sets = sqliteTable("sets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  threadId: integer("thread_id")
    .notNull()
    .references(() => llmThreads.id),
  request: text("request").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  version: integer("version").notNull(),
  playlistId: text("playlist_id"),
  playlistUrl: text("playlist_url"),
  savedVersion: integer("saved_version"),
  savedAt: integer("saved_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const setItems = sqliteTable(
  "set_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    setId: integer("set_id")
      .notNull()
      .references(() => sets.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: text("kind", { enum: ["library", "new"] }).notNull(),
    songKey: text("song_key").notNull(),
    uri: text("uri").notNull(),
    name: text("name").notNull(),
    artist: text("artist").notNull(),
    album: text("album"),
    albumArtUrl: text("album_art_url"),
    reason: text("reason").notNull(),
    playsAfter: integer("plays_after").notNull().default(0),
    finished: integer("finished").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    firstPlayedAt: integer("first_played_at"),
  },
  (t) => [index("set_items_set").on(t.setId, t.position), index("set_items_song").on(t.songKey)],
);

export const picks = sqliteTable(
  "picks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    week: text("week").notNull(),
    position: integer("position").notNull(),
    uri: text("uri").notNull(),
    songKey: text("song_key").notNull(),
    name: text("name").notNull(),
    artist: text("artist").notNull(),
    album: text("album"),
    releaseDate: text("release_date"),
    albumArtUrl: text("album_art_url"),
    reason: text("reason").notNull(),
    sourceUrl: text("source_url"),
    sourceTitle: text("source_title"),
    distance: text("distance", { enum: ["near", "far"] }).notNull(),
    state: text("state", { enum: PICK_STATES }).notNull().default("new"),
    stateAt: integer("state_at").notNull(),
    createdAt: integer("created_at").notNull(),
    plays: integer("plays").notNull().default(0),
    finished: integer("finished").notNull().default(0),
    playDays: integer("play_days").notNull().default(0),
    inLibrary: integer("in_library", { mode: "boolean" }),
    firstPlayedAt: integer("first_played_at"),
  },
  (t) => [index("picks_week").on(t.week, t.position), index("picks_song").on(t.songKey)],
);

export const blocks = sqliteTable(
  "blocks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: ["song", "artist"] }).notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    reason: text("reason").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("blocks_kind_key").on(t.kind, t.key)],
);

export const trackNotes = sqliteTable("track_notes", {
  songKey: text("song_key").primaryKey(),
  uri: text("uri").notNull(),
  name: text("name").notNull(),
  artist: text("artist").notNull(),
  albumArtUrl: text("album_art_url"),
  text: text("text").notNull(),
  sources: text("sources", { mode: "json" }).$type<{ url: string; title: string }[]>().notNull(),
  model: text("model").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const digests = sqliteTable(
  "digests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: ["weekly", "monthly"] }).notNull(),
    periodKey: text("period_key").notNull(),
    fromDay: text("from_day").notNull(),
    toDay: text("to_day").notNull(),
    facts: text("facts", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    text: text("text").notNull(),
    model: text("model").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("digests_kind_period").on(t.kind, t.periodKey)],
);

export const spotifyLookups = sqliteTable("spotify_lookups", {
  query: text("query").primaryKey(),
  result: text("result", { mode: "json" }).$type<unknown>().notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});
