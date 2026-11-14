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
  spotify: {
    connected: boolean;
    userId: string | null;
    scopes: string[];
    missingScopes: string[];
    paused: null | { reason: "rate_limited" | "quota_exceeded"; until: string | null; since: string | null };
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
  plays: { plays: number; music: number; api: number };
  live: { watch: JobStatus; radar: JobStatus; library: JobStatus };
  integrations: { discord: boolean; mcp: boolean };
};

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
  apiPlaysRemoved: number;
  range: { from: string; to: string } | null;
};

export type Session = { authenticated: boolean; setupRequired: boolean };

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

export type Trips = { homeCountry: string; trips: Trip[] };

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
