import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { DEFAULT_TIMEZONE } from "../lib/dates";
import type { Range } from "../lib/range";
import { ApiError, get } from "./client";

const getOrNull = <T>(path: string, query: Record<string, string>) =>
  get<T>(path, query).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  });
import type {
  LivingDetail,
  LivingKind,
  LivingList,
  LivingRefresh,
  AskThread,
  Devices,
  AskTurn,
  Block,
  Digest,
  DigestItem,
  RecapKind,
  RecapPeriod,
  Note,
  PicksWeek,
  SetDetail,
  SetSummary,
  Spend,
  Cleanup,
  CleanupBatch,
  CleanupKind,
  DjSession,
  Energy,
  PlayerNow,
  PlayerQueue,
  Radar,
  TrackIdentity,
  AlbumPage,
  ArtistPage,
  AlbumStats,
  ArtistStats,
  Clock,
  Eras,
  Forgotten,
  History,
  MomentClass,
  OnThisDay,
  Overview,
  PendingTags,
  Period,
  SearchResult,
  Session,
  SkipSplit,
  Skips,
  Song,
  Status,
  TagSeries,
  TimeSeries,
  TrackPage,
  Trips,
  Onboarding,
  Settings,
} from "./types";

const ranged = <T>(path: string, range: Range, extra: Record<string, string | number | undefined> = {}) => ({
  queryKey: [path, range.from ?? null, range.to ?? null, extra],
  queryFn: () => get<T>(path, { from: range.from, to: range.to, ...extra }),
  placeholderData: keepPreviousData,
});

export const useSession = () => useQuery({ queryKey: ["session"], queryFn: () => get<Session>("/api/auth/session"), staleTime: Infinity });

export const useStatus = () => useQuery({ queryKey: ["status"], queryFn: () => get<Status>("/api/status"), refetchInterval: 60_000 });

export const useTimezone = () => useStatus().data?.timezone ?? DEFAULT_TIMEZONE;

export const useLifetime = () => useQuery({ queryKey: ["lifetime"], queryFn: () => get<Overview>("/api/stats/overview"), staleTime: 10 * 60_000 });

export const useOverview = (range: Range) => useQuery(ranged<Overview>("/api/stats/overview", range));

export const useTimeSeries = (range: Range, period: Period) => useQuery(ranged<TimeSeries>("/api/stats/timeseries", range, { period }));

export const useTopArtists = (range: Range, limit: number, at: { weekday?: number; hour?: number } = {}) =>
  useQuery(ranged<{ items: ArtistStats[] }>("/api/stats/top/artists", range, { limit, ...at }));

export const useTopAlbums = (range: Range, limit: number) => useQuery(ranged<{ items: AlbumStats[] }>("/api/stats/top/albums", range, { limit }));

export const useTopTracks = (range: Range, limit: number, at: { weekday?: number; hour?: number } = {}, enabled = true) =>
  useQuery({ ...ranged<{ items: Song[] }>("/api/stats/top/tracks", range, { limit, ...at }), enabled });

export type TopKind = "artists" | "albums" | "tracks";
export type TopSort = "hours" | "listens" | "plays";
export type TopItem = { artists: ArtistStats; albums: AlbumStats; tracks: Song };
export const TOP_PAGE = 200;

export const useTopPages = <K extends TopKind>(kind: K, range: Range, sort: TopSort, q: string | undefined) =>
  useInfiniteQuery({
    queryKey: [`/api/stats/top/${kind}`, "pages", range.from ?? null, range.to ?? null, sort, q ?? null],
    queryFn: ({ pageParam }) => get<{ items: TopItem[K][] }>(`/api/stats/top/${kind}`, { ...range, sort, q, limit: TOP_PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.items.length === TOP_PAGE ? pages.length * TOP_PAGE : undefined),
    placeholderData: keepPreviousData,
  });

export const useEras = (range: Range, limit: number) => useQuery(ranged<Eras>("/api/stats/eras", range, { limit }));

export const useClock = (range: Range) => useQuery(ranged<Clock>("/api/stats/clock", range));

export const useSkips = (range: Range) => useQuery(ranged<Skips>("/api/stats/skips", range, { limit: 100 }));

export const useSkipSplit = (range: Range, cls: MomentClass) => useQuery(ranged<SkipSplit>("/api/stats/skips/split", range, { class: cls, limit: 200 }));

export const useForgotten = (days: number) =>
  useQuery({ queryKey: ["forgotten", days], queryFn: () => get<Forgotten>("/api/stats/forgotten", { days, limit: 100 }), placeholderData: keepPreviousData });

export const useOnThisDay = () => useQuery({ queryKey: ["on-this-day"], queryFn: () => get<OnThisDay>("/api/stats/on-this-day", { limit: 3 }) });

export const useTrips = (range: Range) => useQuery(ranged<Trips>("/api/stats/trips", range, { topTracks: 5 }));

export const useDevices = (range: Range) => useQuery(ranged<Devices>("/api/stats/devices", range, { period: "year" }));

/** Only the count is read: how many played songs have no tags yet. */
export const usePendingTags = () => useQuery({ queryKey: ["tags", "pending"], queryFn: () => get<PendingTags>("/api/tags/pending", { limit: 1 }) });

export const useTagSeries = (kind: "genres" | "moods", range: Range, period: Period) =>
  useQuery(ranged<TagSeries>(`/api/stats/tags/${kind}`, range, { period }));

export const useEnergy = (range: Range) => useQuery(ranged<Energy>("/api/stats/tags/energy", range));

export const useArtistPage = (name: string, range: Range, period: Period) => useQuery(ranged<ArtistPage>("/api/entities/artist", range, { name, period }));

export const useAlbumPage = (artist: string, album: string, range: Range, period: Period) =>
  useQuery(ranged<AlbumPage>("/api/entities/album", range, { artist, album, period }));

export const useTrackPage = (songKey: string, range: Range, period: Period) => useQuery(ranged<TrackPage>("/api/entities/track", range, { songKey, period }));

export const useTrackByUri = (uri: string | undefined) =>
  useQuery({
    queryKey: ["track-by-uri", uri],
    queryFn: () => get<TrackPage>("/api/entities/track", { uri, period: "month" }),
    enabled: Boolean(uri),
    retry: false,
  });

export const useSearch = (q: string, limit = 8) =>
  useQuery({
    queryKey: ["search", q, limit],
    queryFn: () => get<SearchResult>("/api/search", { q, limit }),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
  });

export type HistoryFilters = { q?: string; skipped?: "true" | "false"; device?: string; artist?: string; songKey?: string; country?: string; source?: string };

export const HISTORY_PAGE = 200;

export const useHistory = (range: Range, filters: HistoryFilters) =>
  useInfiniteQuery({
    queryKey: ["history", range.from ?? null, range.to ?? null, filters],
    queryFn: ({ pageParam }) => get<History>("/api/history", { ...range, ...filters, limit: HISTORY_PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
    placeholderData: keepPreviousData,
  });

export const usePlayerNow = () =>
  useQuery({ queryKey: ["player", "now"], queryFn: () => get<PlayerNow>("/api/player/now"), refetchInterval: 5_000, staleTime: 0, retry: false });

export const usePlayerQueue = (enabled: boolean) =>
  useQuery({
    queryKey: ["player", "queue"],
    queryFn: () => get<PlayerQueue>("/api/player/queue"),
    enabled,
    refetchInterval: enabled ? 15_000 : false,
    retry: false,
  });

export const useDj = () =>
  useQuery({
    queryKey: ["dj"],
    queryFn: () => get<{ session: DjSession | null }>("/api/dj"),
    refetchInterval: (q) => (q.state.data?.session?.status === "active" ? 5_000 : false),
  });

export const useTracks = (uris: string[]) =>
  useQuery({
    queryKey: ["tracks", uris],
    queryFn: async () => {
      const params = new URLSearchParams(uris.map((u) => ["uri", u]));
      return get<{ items: TrackIdentity[] }>(`/api/tracks?${params}`);
    },
    enabled: uris.length > 0,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });

export const useRadar = (status: "new" | "recent", days = 30) =>
  useQuery({ queryKey: ["radar", status, days], queryFn: () => get<Radar>("/api/radar", { status, days, limit: 200 }) });

export const useLiving = () => useQuery({ queryKey: ["living"], queryFn: () => get<LivingList>("/api/living") });

export const useLivingPlaylist = (kind: LivingKind) => useQuery({ queryKey: ["living", kind], queryFn: () => get<LivingDetail>(`/api/living/${kind}`) });

export const useLivingRefresh = (kind: LivingKind, id: number | null) =>
  useQuery({ queryKey: ["living", kind, "refresh", id], queryFn: () => get<LivingRefresh>(`/api/living/${kind}/refreshes/${id}`), enabled: id !== null, staleTime: Infinity });

export const useCleanup = (kind: CleanupKind | undefined, status: "open" | "dismissed" | "applied") =>
  useQuery({
    queryKey: ["cleanup", kind ?? null, status],
    queryFn: () => get<Cleanup>("/api/cleanup", { kind, status, limit: 500 }),
    placeholderData: keepPreviousData,
  });

export const useCleanupBatches = () => useQuery({ queryKey: ["cleanup", "batches"], queryFn: () => get<{ items: CleanupBatch[] }>("/api/cleanup/batches") });

export const useSets = () =>
  useQuery({
    queryKey: ["sets"],
    queryFn: () => get<{ items: (SetSummary & { tracks: number })[]; total: number }>("/api/sets", { limit: 100 }),
  });

export const useSet = (id: number) => useQuery({ queryKey: ["sets", id], queryFn: () => get<SetDetail>(`/api/sets/${id}`), retry: false });

export const usePicks = (week?: string) => useQuery({ queryKey: ["picks", week ?? "current"], queryFn: () => get<PicksWeek>("/api/picks", { week }) });

export const usePickWeeks = () =>
  useQuery({
    queryKey: ["picks", "weeks"],
    queryFn: () => get<{ items: { week: string; picks: number; played: number }[] }>("/api/picks/weeks", { limit: 26 }),
  });

export const useBlocks = () => useQuery({ queryKey: ["blocks"], queryFn: () => get<{ items: Block[] }>("/api/blocks") });

export const useAskThreads = () => useQuery({ queryKey: ["ask", "threads"], queryFn: () => get<{ items: AskThread[] }>("/api/ask/threads", { limit: 50 }) });

export const useAskThread = (id: number | null) =>
  useQuery({ queryKey: ["ask", "threads", id], queryFn: () => get<AskThread & { turns: AskTurn[] }>(`/api/ask/threads/${id}`), enabled: id !== null });

export const useNote = (songKey: string) =>
  useQuery({ queryKey: ["note", songKey], queryFn: () => getOrNull<Note>("/api/notes", { songKey }), staleTime: Infinity });

export const useDigests = () => useQuery({ queryKey: ["digests"], queryFn: () => get<{ items: DigestItem[] }>("/api/digests", { limit: 30 }) });

export const useDigest = (id: number) => useQuery({ queryKey: ["digests", id], queryFn: () => get<Digest>(`/api/digests/${id}`), staleTime: Infinity });

export const useRecapPeriod = (kind: RecapKind, key: string) =>
  useQuery({ queryKey: ["digests", "period", kind, key], queryFn: () => get<RecapPeriod>(`/api/digests/periods/${kind}/${key}`), placeholderData: keepPreviousData });

export const useLatestRecapKey = (kind: RecapKind) => useQuery({ queryKey: ["digests", "latest", kind], queryFn: () => get<{ kind: RecapKind; key: string }>(`/api/digests/latest/${kind}`) });

export const useSpend = () => useQuery({ queryKey: ["spend"], queryFn: () => get<Spend>("/api/llm/spend", { limit: 12 }) });

export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: () => get<Settings>("/api/settings") });

export const useOnboarding = () => useQuery({ queryKey: ["onboarding"], queryFn: () => get<Onboarding>("/api/onboarding") });
