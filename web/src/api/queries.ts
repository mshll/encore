import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { DEFAULT_TIMEZONE } from "../lib/dates";
import type { Range } from "../lib/range";
import { get } from "./client";
import type {
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

export const useEras = (range: Range, limit: number) => useQuery(ranged<Eras>("/api/stats/eras", range, { limit }));

export const useClock = (range: Range) => useQuery(ranged<Clock>("/api/stats/clock", range));

export const useSkips = (range: Range) => useQuery(ranged<Skips>("/api/stats/skips", range, { limit: 100 }));

export const useSkipSplit = (range: Range, cls: MomentClass) => useQuery(ranged<SkipSplit>("/api/stats/skips/split", range, { class: cls, limit: 200 }));

export const useForgotten = (days: number) =>
  useQuery({ queryKey: ["forgotten", days], queryFn: () => get<Forgotten>("/api/stats/forgotten", { days, limit: 100 }), placeholderData: keepPreviousData });

export const useOnThisDay = () => useQuery({ queryKey: ["on-this-day"], queryFn: () => get<OnThisDay>("/api/stats/on-this-day", { limit: 3 }) });

export const useTrips = (range: Range) => useQuery(ranged<Trips>("/api/stats/trips", range, { topTracks: 5 }));

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

export const useCleanup = (kind: CleanupKind | undefined, status: "open" | "dismissed" | "applied") =>
  useQuery({
    queryKey: ["cleanup", kind ?? null, status],
    queryFn: () => get<Cleanup>("/api/cleanup", { kind, status, limit: 500 }),
    placeholderData: keepPreviousData,
  });

export const useCleanupBatches = () => useQuery({ queryKey: ["cleanup", "batches"], queryFn: () => get<{ items: CleanupBatch[] }>("/api/cleanup/batches") });
