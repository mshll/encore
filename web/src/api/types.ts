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
  source: "export" | "api";
};

export type History = { total: number; limit: number; offset: number; items: HistoryItem[] };
