export type Period = "day" | "week" | "month" | "year";
export type Device = "ios" | "android" | "mac" | "windows" | "linux" | "web" | "console" | "tv" | "speaker" | "car" | "unknown" | "other";
export type PlayKind = "track" | "episode" | "audiobook" | "video";
export type MomentClass = "keeper" | "wrong_moment" | "dislike" | "mixed";
export type ContextDimension = "hourBucket" | "dayType" | "shuffle" | "device" | "startMode";

export type Stats = {
  hours: number;
  plays: number;
  listens: number;
  skips: number;
  skipRate: number | null;
  quickSkips: number;
  firstPlayed: string | null;
  lastPlayed: string | null;
};

export type SongIdentity = {
  songKey: string;
  uri: string;
  name: string;
  artist: string;
  album: string | null;
  albumArtUrl: string | null;
};

export type Song = SongIdentity & Stats;
export type ArtistStats = { artist: string; imageUrl: string | null; songs?: number } & Stats;
export type AlbumStats = { album: string; artist: string; albumArtUrl: string | null; songs?: number } & Stats;

export type TimePoint = { period: string; hours: number; plays: number; listens: number };

export type ContextStat = { value: string; plays: number; skips: number; skipRate: number | null };
export type SkipProfile = Record<ContextDimension, ContextStat[]>;

export type Status = {
  timezone: string;
  weekendDays: number[];
  homeCountry: string | null;
  spotify: {
    connected: boolean;
    userId: string | null;
    scopes: string[];
    missingScopes: string[];
    paused: null | { reason: "rate_limited" | "quota_exceeded"; until: string | null; since: string | null };
    pacing: { minIntervalMs: number; queued: { interactive: number; background: number }; calls: number };
  };
  poll: JobStatus;
  enrichment: JobStatus & {
    total: number;
    enriched: number;
    failed: number;
    withArt: number;
    artists: { total: number; fetched: number; withImage: number };
    art: JobStatus;
  };
  import: null | { lastImportAt: string | null; result: ImportResult | null };
  tags: { songs: number; tagged: number; coverage: number | null };
  plays: { plays: number; music: number; api: number; live: number };
  live: { watch: JobStatus; radar: JobStatus; library: JobStatus };
  integrations: { discord: boolean; mcp: boolean };
  llm: LlmStatus;
};

export type LlmFeature = "sets" | "picks" | "ask" | "notes" | "digest" | "dj";

export type Budget = { month: string; spentUsd: number; capUsd: number; remainingUsd: number; exhausted: boolean };

export type LlmStatus = Budget & {
  configured: boolean;
  model: string;
  byFeature: { feature: LlmFeature; calls: number; usd: number }[];
  jobs: { picks: JobStatus; digest: JobStatus; outcomes: JobStatus };
  schedule: { enabled: boolean; picks: Slot; digest: Slot };
};

export type Slot = { weekday: number; hour: number };

export type Spend = {
  month: string;
  byFeature: { feature: LlmFeature; calls: number; usd: number; webSearches: number }[];
  recent: {
    id: number;
    ts: string;
    feature: LlmFeature;
    ref: string | null;
    model: string;
    requestedModel: string;
    usd: number;
    durationMs: number;
    webSearches: number;
  }[];
  budget: Budget;
  model: string;
};

export type Artwork = { albumArtUrl: string | null; artistImageUrl: string | null };

export type SetTrack = Artwork & {
  position: number;
  kind: "library" | "new";
  songKey: string;
  uri: string;
  name: string;
  artist: string;
  album: string | null;
  reason: string;
  pinned: boolean;
  history: { listens: number; lastPlayed: string } | null;
  outcome: { plays: number; finished: number; skipped: number; firstPlayedAt: string | null };
  dj: { finished: number; skipped: number };
};

export type SetChangeTrack = { songKey: string; name: string; artist: string };
export type SetChange = {
  version: number;
  source: "claude" | "owner";
  message: string | null;
  added: SetChangeTrack[];
  removed: SetChangeTrack[];
  moved: (SetChangeTrack & { from: number; to: number })[];
  at: string;
};

export type SetSummary = {
  id: number;
  title: string;
  description: string;
  request: string;
  version: number;
  playlist: { id: string; url: string; savedVersion: number; outdated: boolean } | null;
  /** The generated cover; null while the set has no songs. */
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SavedPlaylist = {
  playlistId: string;
  playlistUrl: string;
  tracks: number;
  cover: { status: "uploaded" | "unchanged" | "missing_scope" | "failed" };
};

export type SetDetail = SetSummary & {
  items: SetTrack[];
  djSessions: number;
  conversation: { role: "owner" | "assistant"; text: string }[];
  changes: SetChange[];
};

export type SetResult = { set: SetDetail; reply: string | null; changed?: boolean };

export type PickState = "new" | "saved" | "not_now" | "never";

export type Pick = Artwork & {
  id: number;
  week: string;
  position: number;
  uri: string;
  songKey: string;
  name: string;
  artist: string;
  album: string | null;
  releaseDate: string | null;
  reason: string;
  source: { url: string; title: string } | null;
  distance: "near" | "far";
  state: PickState;
  stateAt: string | null;
  outcome: { plays: number; finished: number; playDays: number; inLibrary: boolean; firstPlayedAt: string | null; hit: boolean };
};

export type PickStats = { settled: number; played: number; hits: number; hitRate: number | null };
export type PicksWeek = { week: string; picks: Pick[]; stats: PickStats };

export type Block = { id: number; kind: "song" | "artist"; key: string; label: string; reason: string; createdAt: string };

export type AskThread = { id: number; title: string; createdAt: string; updatedAt: string };
export type AskTurn = { role: "owner" | "assistant"; text: string };
export type AskResult = { threadId: number; answer: string };

export type Note = Artwork & {
  songKey: string;
  uri: string;
  name: string;
  artist: string;
  text: string;
  sources: { url: string; title: string }[];
  createdAt: string;
  cached: boolean;
};

export type DigestItem = { id: number; kind: "weekly" | "monthly"; periodKey: string; from: string; to: string; title: string; createdAt: string };
export type Digest = DigestItem & { text: string; facts: Record<string, unknown>; model: string };

export type JobStatus = {
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastResult: Record<string, unknown> | null;
};

export type ImportResult = {
  files: { name: string; kind: string; rows: number; invalid: number }[];
  ignoredFiles: string[];
  rowsParsed: number;
  invalidRows: number;
  inserted: number;
  alreadyPresent: number;
  beforeHistoryStart: number;
  apiPlaysRemoved: number;
  range: { from: string; to: string } | null;
};

export type Session = { authenticated: boolean; setupRequired: boolean; setupTokenConfigured: boolean };

export type SettingGroup = "spotify" | "locale" | "claude" | "picks" | "digest" | "dj" | "discord" | "mcp" | "access" | "jobs" | "history";
export type SettingType = "string" | "integer" | "number" | "boolean" | "enum" | "timezone" | "weekdays" | "date";
export type SettingUnit = "ms" | "seconds" | "minutes" | "hours" | "days" | "usd" | "weekday" | "hour";
export type SettingValue = string | number | boolean | number[];
export type SettingSource = "env" | "db" | "default";

export type SettingField = {
  key: string;
  env: string;
  type: SettingType;
  secret: boolean;
  value: SettingValue | null;
  default: SettingValue | null;
  source: SettingSource;
  locked: boolean;
  set: boolean;
  hint: string | null;
  unreadable: boolean;
  stored: boolean;
  min?: number;
  max?: number;
  unit?: SettingUnit;
  options?: string[];
};

export type SecretStorage = { available: boolean; envVar: "SECRETS_KEY" };
export type Settings = { groups: { id: SettingGroup; fields: SettingField[] }[]; secretStorage: SecretStorage };

export type PlaysBefore = { plays: number; firstDay: string | null; lastDay: string | null; hours: number };
export type HistoryStartResult = Settings & { removed: PlaysBefore; snapshot: string | null };

export type SettingsEffect =
  | { type: "spotify_disconnected" }
  | { type: "timezone_forward_only" }
  | { type: "discord_commands_registered"; count: number }
  | { type: "discord_registration_failed"; message: string };

export type SettingsPatchResult = Settings & { changed: string[]; effects: SettingsEffect[] };
export type SettingsAdoptResult = Settings & { adopted: string[]; replaced: string[]; skipped: { key: string; reason: "invalid" | "secrets_key_missing" }[] };
export type SettingIssue = { key: string; reason: "unknown" | "locked" | "invalid" | "secrets_key_missing"; message: string };

export type ClaudeKeyCheck = { valid: true; model: string } | { valid: false; model: string; message: string };
export type DiscordRegistration = { registered: number; commands: string[] };

type OnboardingStep = { required: boolean; done: boolean };
type SourceInfo = { source: SettingSource; locked: boolean };
export type OnboardingStepId = "passkey" | "spotifyApp" | "spotifyConnect" | "locale" | "import" | "claude" | "discord" | "mcp";

export type Onboarding = {
  complete: boolean;
  order: OnboardingStepId[];
  steps: {
    passkey: OnboardingStep & { passkeys: number };
    spotifyApp: OnboardingStep & SourceInfo & { redirectUri: string };
    spotifyConnect: OnboardingStep & { userId: string | null; missingScopes: string[] };
    locale: OnboardingStep & SourceInfo & { timezone: string; playsStored: number };
    import: OnboardingStep & { plays: number; exportPlays: number; lastImportAt: string | null };
    claude: OnboardingStep & SourceInfo;
    discord: OnboardingStep & { interactionsUrl: string; commandsRegistrable: boolean };
    mcp: OnboardingStep & SourceInfo & { url: string };
  };
  secretStorage: SecretStorage;
};

export type Overview = {
  hours: number;
  plays: number;
  listens: number;
  uniqueTracks: number;
  uniqueArtists: number;
  skipRate: number | null;
  shuffleRate: number | null;
  firstPlayed: string | null;
  lastPlayed: string | null;
  topArtist: { artist: string; imageUrl: string | null; hours: number; listens: number } | null;
  topTrack: { songKey: string; uri: string; name: string; artist: string; albumArtUrl: string | null; hours: number; listens: number } | null;
};

export type TimeSeries = { period: Period; points: TimePoint[] };

export type Eras = {
  months: string[];
  series: { artist: string; hours: number[] }[];
  artists: { artist: string; imageUrl: string | null; hours: number; firstPlayed: string; lastPlayed: string; peakMonth: string; peakMonthHours: number }[];
};

export type Clock = { cells: { weekday: number; hour: number; hours: number; plays: number }[] };

export type Skips = {
  minPlays: number;
  summary: { plays: number; skips: number; skipRate: number | null; quickSkips: number };
  mostSkippedTracks: Song[];
  mostSkippedArtists: ArtistStats[];
  quickSkips: Song[];
  neverSkipped: Song[];
  profile: SkipProfile;
  /** Always 10: skipped plays by the share of the song played before the skip. */
  positions: { start: number; end: number; skips: number }[];
};

export type ContextRef = { dimension: ContextDimension; value: string; plays: number; skips: number; skipRate: number };

export type SkipSplit = {
  params: { minPlays: number; minContextPlays: number; keeperBelow: number; dislikeAtLeast: number; worksAtMost: number; failsAtLeast: number };
  eligibleSongs: number;
  counts: Record<MomentClass, number>;
  songs: (Song & { class: MomentClass; bestContext: ContextRef | null; worstContext: ContextRef | null })[];
};

export type Forgotten = { days: number; minListens: number; asOf: string; items: Song[] };

export type OnThisDay = {
  date: string;
  years: { year: number; day: string; hours: number; plays: number; listens: number; topTracks: Song[] }[];
};

export type Trip = {
  start: string;
  end: string;
  startDay: string;
  endDay: string;
  days: number;
  countries: { country: string; plays: number }[];
  plays: number;
  hours: number;
  topTracks: { songKey: string; uri: string; name: string; artist: string; albumArtUrl: string | null; plays: number; listens: number; hours: number }[];
};

export type Trips = { homeCountry: string | null; trips: Trip[] };

export type Devices = {
  period: Period;
  totals: { device: Device; hours: number; plays: number; share: number | null }[];
  series: { period: string; device: Device; hours: number; plays: number }[];
};

export type PendingTags = { items: { uri: string; name: string; artist: string; album: string | null; listens: number }[]; total: number; limit: number; offset: number };

export type Energy = {
  coverage: { hoursTagged: number; hoursTotal: number; share: number | null };
  hours: { hour: number; energy: number | null; valence: number | null; listens: number }[];
};

export type TagSeries = {
  period: Period;
  coverage: { hoursTagged: number; hoursTotal: number; share: number | null };
  totals: { value: string; hours: number; plays: number }[];
  series: { period: string; value: string; hours: number; plays: number }[];
};

export type ArtistPage = {
  artist: string;
  imageUrl: string | null;
  totals: Stats;
  timeline: TimePoint[];
  skipProfile: SkipProfile;
  tracks: Song[];
  albums: ({ album: string; albumArtUrl: string | null } & Stats)[];
};

export type AlbumPage = {
  album: string;
  artist: string;
  albumArtUrl: string | null;
  totals: Stats;
  timeline: TimePoint[];
  skipProfile: SkipProfile;
  tracks: Song[];
};

export type TrackPage = Song & {
  totals: Stats;
  timeline: TimePoint[];
  skipProfile: SkipProfile;
  class: MomentClass | null;
  uris: { uri: string; name: string; album: string | null; plays: number }[];
};

export type SearchResult = { artists: ArtistStats[]; songs: Song[]; albums: AlbumStats[] };

export type HistoryItem = {
  id: number;
  ts: string;
  day: string;
  hour: number;
  kind: PlayKind;
  uri: string | null;
  songKey: string | null;
  name: string | null;
  artist: string | null;
  album: string | null;
  albumArtUrl: string | null;
  msPlayed: number | null;
  skipped: boolean | null;
  shuffle: boolean | null;
  reasonStart: string | null;
  reasonEnd: string | null;
  device: Device;
  country: string | null;
  source: "export" | "api" | "live";
};

export type History = { total: number; limit: number; offset: number; items: HistoryItem[] };

export type TrackRef = { uri: string; name: string; artist: string; albumArtUrl: string | null };
export type TrackIdentity = TrackRef & { songKey: string; album: string | null };

export type PlayerNow = {
  playing: boolean;
  track: (TrackRef & { album: string | null; durationMs: number }) | null;
  progressMs: number | null;
  shuffle: boolean | null;
  device: { name: string; type: string } | null;
  contextUri: string | null;
  fetchedAt: string;
};

export type PlayerQueue = { current: TrackRef | null; queue: TrackRef[] };

export type DjSession = {
  id: number;
  status: "active" | "stopped" | "ended";
  playlistUri: string;
  position: number;
  current: string | null;
  upcoming: string[];
  played: { uri: string; outcome: "finished" | "skipped" | string }[];
  skipStreak: number;
  replans: number;
  replannedAt: string | null;
  replanSkips: number | null;
  set: { id: number; title: string } | null;
  startedAt: string;
  endedAt: string | null;
  endReason: "stopped" | "replaced" | "left_playlist" | null;
};

export type Release = {
  id: string;
  uri: string;
  url: string;
  name: string;
  artist: string;
  artistId: string;
  albumType: "album" | "single" | "compilation";
  releaseDate: string;
  totalTracks: number;
  imageUrl: string | null;
  isNew: boolean;
  seen: boolean;
  firstSeenAt: string;
};

export type Radar = { artists: number; withId: number; checkedRecently: number; unseenNew: number; lastRunAt: string | null; items: Release[] };

export type CleanupKind = "saved_never_played" | "saved_dislike" | "playlist_skipped" | "playlist_duplicate";

export type CleanupProposal = {
  id: number;
  kind: CleanupKind;
  playlistId: string | null;
  uri: string;
  status: "open" | "dismissed" | "applied";
  updatedAt: string;
  evidence: {
    name: string;
    artist: string;
    albumArtUrl: string | null;
    songKey: string | null;
    plays: number;
    listens: number;
    skips: number;
    skipRate: number | null;
    lastPlayed: string | null;
    savedAt?: string | null;
    class?: MomentClass | null;
    playlistName?: string;
    duplicates?: { position: number; uri: string }[];
  };
};

export type Cleanup = {
  counts: Record<CleanupKind, number>;
  library: { savedTracks: number; playlists: number; syncing: boolean; lastSyncAt: string | null };
  total: number;
  limit: number;
  offset: number;
  items: CleanupProposal[];
};

export type CleanupBatch = { id: number; proposalIds: number[]; actions: number; appliedAt: string; undoneAt: string | null };
