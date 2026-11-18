import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "wouter";
import { useLifetime, useOverview, useTopPages, type TopItem, type TopKind, type TopSort } from "../api/queries";
import type { AlbumStats, ArtistStats, Song } from "../api/types";
import { MUSIC_TABS } from "../app/nav";
import { useScrollElement } from "../app/Shell";
import { fmtHours, fmtInt } from "../lib/format";
import { useRange } from "../lib/range";
import { useDesktop } from "../lib/useMedia";
import { Button } from "../ui/Button";
import { VinylRecordIcon } from "../ui/icons";
import { Page, PageHeader, dimWhile } from "../ui/Page";
import { RangePicker } from "../ui/RangePicker";
import { AlbumRow, ArtistRow, RowSkeleton, TrackRow } from "../ui/Rows";
import { SearchField } from "../ui/SearchField";
import { Select } from "../ui/Select";
import { EmptyState, ErrorState, FirstUseState } from "../ui/States";
import { TabNav } from "../ui/TabNav";
import { Forgotten } from "./Forgotten";
import { Podcasts } from "./Podcasts";

export type MusicTab = "artists" | "albums" | "songs" | "forgotten" | "podcasts";
type RankedTab = Exclude<MusicTab, "forgotten" | "podcasts">;

const KIND: Record<RankedTab, TopKind> = { artists: "artists", albums: "albums", songs: "tracks" };
const NOUN: Record<RankedTab, [string, string]> = { artists: ["artist", "artists"], albums: ["album", "albums"], songs: ["song", "songs"] };
const COLUMN: Record<RankedTab, string> = { artists: "Artist", albums: "Album", songs: "Song" };

const SORTS: { value: TopSort; label: string }[] = [
  { value: "hours", label: "Hours" },
  { value: "listens", label: "Listens" },
  { value: "plays", label: "Plays" },
];

function useListParams() {
  const [params, setParams] = useSearchParams();
  const sort = (SORTS.find((s) => s.value === params.get("sort"))?.value ?? "hours") as TopSort;
  const q = params.get("q") ?? undefined;
  const set = (patch: { sort?: TopSort; q?: string }) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if ("q" in patch) {
          if (patch.q) out.set("q", patch.q);
          else out.delete("q");
        }
        if (patch.sort) {
          if (patch.sort === "hours") out.delete("sort");
          else out.set("sort", patch.sort);
        }
        return out;
      },
      { replace: true },
    );
  return { sort, q, set };
}

type Stats = { hours: number; listens: number; plays: number };

const figure = (item: Stats, sort: TopSort) => (sort === "hours" ? fmtHours(item.hours) : fmtInt(item[sort]));

function subtitle(tab: RankedTab, item: TopItem[TopKind]) {
  if (tab === "artists") {
    const a = item as ArtistStats;
    return a.songs === undefined ? undefined : `${fmtInt(a.songs)} ${a.songs === 1 ? "song" : "songs"}`;
  }
  return undefined;
}

function ListRow({ tab, item, rank, sort, share, style }: { tab: RankedTab; item: TopItem[TopKind]; rank?: number; sort: TopSort; share: number; style: React.CSSProperties }) {
  const value = figure(item, sort);
  if (tab === "artists") return <ArtistRow artist={item as ArtistStats} rank={rank} value={value} share={share} subtitle={subtitle(tab, item)} style={style} />;
  if (tab === "albums") return <AlbumRow album={item as AlbumStats} rank={rank} value={value} share={share} style={style} />;
  return <TrackRow song={item as Song} rank={rank} value={value} share={share} style={style} />;
}

const keyOf = (tab: RankedTab, item: TopItem[TopKind]) =>
  tab === "artists" ? (item as ArtistStats).artist : tab === "albums" ? `${(item as AlbumStats).artist}|${(item as AlbumStats).album}` : (item as Song).songKey;

function RankedList({ tab }: { tab: RankedTab }) {
  const { range } = useRange();
  const { sort, q, set } = useListParams();
  const overview = useOverview(range);
  const query = useTopPages(KIND[tab], range, sort, q);
  const scroller = useScrollElement();
  const listRef = useRef<HTMLOListElement>(null);
  const [margin, setMargin] = useState(0);
  const desktop = useDesktop();
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  useLayoutEffect(() => {
    const el = listRef.current;
    const sc = scroller.current;
    if (!el || !sc) return;
    setMargin(el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop);
  }, [scroller, items.length > 0, desktop]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => (desktop ? 44 : 60),
    overscan: 12,
    scrollMargin: margin,
  });
  const rows = virtualizer.getVirtualItems();
  const last = rows[rows.length - 1];
  useEffect(() => {
    if (last && last.index >= items.length - 30 && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [last, items.length, query]);

  const [one, many] = NOUN[tab];
  const total = tab === "artists" ? overview.data?.uniqueArtists : tab === "songs" ? overview.data?.uniqueTracks : undefined;
  const count = q ? (query.hasNextPage ? undefined : items.length) : total;
  const top = items[0] ? (items[0] as Stats)[sort] || 1 : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <SearchField label={`Search ${many}`} placeholder={tab === "artists" ? "Artist name…" : tab === "albums" ? "Album or artist…" : "Song or artist…"} value={q ?? ""} onChange={(v) => set({ q: v.trim() || undefined })} className="min-w-0 flex-1 md:flex-none" />
        <Select label="Sort by" value={sort} options={SORTS} onChange={(v) => set({ sort: v })} className="shrink-0" />
      </div>
      <p className="min-h-5 text-secondary tabular" aria-live="polite">
        {count === undefined ? " " : `${fmtInt(count)} ${count === 1 ? one : many}`}
      </p>
      <div className={dimWhile(query.isPlaceholderData)}>
        <div aria-hidden className="@container">
          <div className="flex h-9 items-center gap-3 text-caption text-secondary">
            {!q && <span className="w-8 shrink-0" />}
            <span className="size-8 shrink-0 phone:size-10" />
            <span className="flex-1">{COLUMN[tab]}</span>
            <span className="hidden w-24 shrink-0 @lg:block" />
            <span className="w-16 shrink-0 text-right">{SORTS.find((s) => s.value === sort)!.label}</span>
            {tab === "songs" && <span className="hidden w-(--control-h-sm) shrink-0 max-md:block" />}
          </div>
        </div>
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : !query.data ? (
          <RowSkeleton rows={12} rank />
        ) : items.length === 0 ? (
          <EmptyState
            title={q ? `No ${many} match “${q}”` : `No ${many} in this range`}
            description={q ? "Check the spelling, or pick a wider range." : "Pick a wider range."}
            action={
              q ? (
                <Button size="sm" onClick={() => set({ q: undefined })}>
                  Clear search
                </Button>
              ) : (
                <RangePicker />
              )
            }
          />
        ) : (
          <ol ref={listRef} aria-label={`${COLUMN[tab]}s by ${sort}`} className="@container relative [--rank-w:--spacing(8)]" style={{ height: virtualizer.getTotalSize() }}>
            {rows.map((v) => {
              const item = items[v.index]!;
              return (
                <ListRow
                  key={keyOf(tab, item)}
                  tab={tab}
                  item={item}
                  rank={q ? undefined : v.index + 1}
                  sort={sort}
                  share={(item as Stats)[sort] / top}
                  style={{ position: "absolute", top: 0, left: 0, right: 0, height: v.size, transform: `translateY(${v.start - margin}px)` }}
                />
              );
            })}
          </ol>
        )}
        {query.isFetchingNextPage && <RowSkeleton rows={3} rank />}
      </div>
    </div>
  );
}

export function Music({ tab }: { tab: MusicTab }) {
  const lifetime = useLifetime();
  const firstUse = lifetime.data?.plays === 0;
  return (
    <Page>
      <PageHeader title="Music" actions={!firstUse && tab !== "forgotten" && <RangePicker />}>
        <TabNav items={MUSIC_TABS} label="Music" />
      </PageHeader>
      {firstUse ? (
        <FirstUseState icon={VinylRecordIcon} description="Import your Spotify history or connect Spotify, and the artists, albums and songs you play rank here." />
      ) : tab === "forgotten" ? (
        <Forgotten />
      ) : tab === "podcasts" ? (
        <Podcasts />
      ) : (
        <RankedList key={tab} tab={tab} />
      )}
    </Page>
  );
}
