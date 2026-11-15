import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useSearchParams } from "wouter";
import { useHistory, useLifetime, useStatus, useTimezone, type HistoryFilters } from "../api/queries";
import type { Device, HistoryItem } from "../api/types";
import { artistPath, songPath } from "../app/paths";
import { useScrollElement } from "../app/Shell";
import { useWidth } from "../charts/core";
import { countryName, DEVICE_LABELS, fmtDuration, fmtInt, fmtTime, OUTCOME_LABELS } from "../lib/format";
import { useRange } from "../lib/range";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Button, IconButton } from "../ui/Button";
import { cx } from "../ui/cx";
import { Icon } from "../ui/Icon";
import { ListBulletsIcon, PlayIcon, XIcon } from "../ui/icons";
import { Page, PageHeader, dimWhile } from "../ui/Page";
import { RangePicker } from "../ui/RangePicker";
import { RowSkeleton } from "../ui/Rows";
import { SearchField } from "../ui/SearchField";
import { Select } from "../ui/Select";
import { SongContext, SongMenu } from "../ui/SongMenu";
import { EmptyState, ErrorState, FirstUseState } from "../ui/States";
import { cellClass, TableHead, useColumns, type Column } from "../ui/Table";
import { usePlayback } from "../player/playback";

type Line = { type: "day"; day: string } | { type: "play"; item: HistoryItem };

const SOURCE_LABELS: Record<HistoryItem["source"], string> = { export: "From the export", api: "Recently played", live: "Watched live" };

const skipLabel = (item: HistoryItem) => (item.outcome === "early" || item.outcome === "midway" ? OUTCOME_LABELS[item.outcome] : null);

const dayHeading = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const COLUMNS: Column[] = [
  { id: "time", label: "Time", width: "44px" },
  { id: "art", label: "Artwork", width: "32px", srLabel: true },
  { id: "song", label: "Song", width: "minmax(0,3fr)" },
  { id: "artist", label: "Artist", width: "minmax(0,2fr)" },
  { id: "album", label: "Album", width: "minmax(0,2fr)", from: "xl" },
  { id: "played", label: "Played", width: "56px", align: "end" },
  { id: "ending", label: "Ending", width: "112px", from: "lg", srLabel: true },
  { id: "where", label: "Device", width: "minmax(0,1.2fr)", from: "lg" },
  { id: "actions", label: "Actions", width: "60px", srLabel: true },
];

function useFilters() {
  const [params, setParams] = useSearchParams();
  const filters: HistoryFilters = {
    q: params.get("q") ?? undefined,
    outcome: params.get("outcome") ?? undefined,
    device: params.get("device") ?? undefined,
    artist: params.get("artist") ?? undefined,
    songKey: params.get("songKey") ?? undefined,
    source: params.get("source") ?? undefined,
  };
  const set = (patch: Partial<HistoryFilters>) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) out.set(k, v);
          else out.delete(k);
        }
        return out;
      },
      { replace: true },
    );
  return [filters, set] as const;
}

function where(item: HistoryItem, home: string | null | undefined) {
  return [item.device === "unknown" ? null : DEVICE_LABELS[item.device], item.country && item.country !== home ? countryName(item.country) : null, item.source === "live" ? "live" : null]
    .filter(Boolean)
    .join(", ");
}

function SongTitle({ item }: { item: HistoryItem }) {
  if (!item.songKey) return <span className="truncate">{item.name ?? "Unknown"}</span>;
  return (
    <AppLink to={songPath(item.songKey)} className="-my-[3px] truncate py-[3px] hover:underline">
      {item.name}
    </AppLink>
  );
}

function ArtistName({ item, className }: { item: HistoryItem; className?: string }) {
  if (!item.artist) return null;
  return (
    <AppLink to={artistPath(item.artist)} className={cx("-my-[3px] truncate py-[3px] text-secondary hover:text-primary hover:underline", className)}>
      {item.artist}
    </AppLink>
  );
}

function DesktopRow({ item, timezone, columns, style, home }: { item: HistoryItem; timezone: string; columns: Column[]; style: React.CSSProperties; home: string | null | undefined }) {
  const playback = usePlayback();
  const song = item.kind === "track" && item.uri && item.name ? { uri: item.uri, name: item.name, songKey: item.songKey, artist: item.artist } : null;
  const cells: Record<string, React.ReactNode> = {
    time: <span className="text-secondary tabular">{fmtTime(item.ts, timezone)}</span>,
    art: <Artwork src={item.albumArtUrl} kind="song" box={32} />,
    song: <SongTitle item={item} />,
    artist: <ArtistName item={item} />,
    album: <span className="truncate text-secondary">{item.album}</span>,
    played: <span className="tabular">{fmtDuration(item.msPlayed)}</span>,
    ending: skipLabel(item) && <span className="text-secondary">{skipLabel(item)}</span>,
    where: <span className="truncate text-secondary">{where(item, home)}</span>,
    actions: song ? (
      <span className="flex justify-end can-hover:opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-open]]:opacity-100">
        <IconButton icon={PlayIcon} label={`Play ${song.name}`} size="sm" onClick={() => playback.play([song.uri])} />
        <SongMenu song={song} />
      </span>
    ) : null,
  };
  const row = (
    <div role="row" className="group grid h-full items-center gap-4 rounded-md px-2 transition-colors duration-150 hover:bg-fill" style={style}>
      {columns.map((c) => (
        <span key={c.id} role="cell" className={cellClass(c, "flex min-w-0 items-center")}>
          {c.align === "end" ? <span className="ml-auto">{cells[c.id]}</span> : cells[c.id]}
        </span>
      ))}
    </div>
  );
  return song ? (
    <SongContext song={song} className="h-full">
      {row}
    </SongContext>
  ) : (
    row
  );
}

function PhoneRow({ item, timezone }: { item: HistoryItem; timezone: string }) {
  const song = item.kind === "track" && item.uri && item.name ? { uri: item.uri, name: item.name, songKey: item.songKey, artist: item.artist } : null;
  const body = (
    <div className="relative flex h-full items-center gap-3">
      {item.songKey && <AppLink to={songPath(item.songKey)} aria-label={`${item.name}, ${item.artist}`} className="absolute inset-0" />}
      <Artwork src={item.albumArtUrl} kind="song" box={40} className="pointer-events-none" />
      <span className="pointer-events-none flex min-w-0 flex-1 flex-col">
        <span className="truncate">{item.name ?? "Unknown"}</span>
        <span className="truncate text-caption text-secondary">{item.artist}</span>
      </span>
      <span className="pointer-events-none flex shrink-0 flex-col items-end text-caption tabular">
        <span>{fmtTime(item.ts, timezone)}</span>
        <span className="text-secondary">{skipLabel(item) ?? fmtDuration(item.msPlayed)}</span>
      </span>
    </div>
  );
  return song ? (
    <SongContext song={song} className="h-full">
      {body}
    </SongContext>
  ) : (
    body
  );
}

const ENDING_OPTIONS = [
  { value: "all", label: "Any ending" },
  { value: "early,midway", label: "Skipped" },
  ...(["early", "midway", "through", "interrupted"] as const).map((o) => ({ value: o, label: OUTCOME_LABELS[o] })),
];
const DEVICE_OPTIONS = [{ value: "all", label: "All devices" }, ...(Object.keys(DEVICE_LABELS) as Device[]).map((d) => ({ value: d, label: DEVICE_LABELS[d] }))];
const SOURCE_OPTIONS = [{ value: "all", label: "All sources" }, ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))];

function Toolbar({ filters, setFilters }: { filters: HistoryFilters; setFilters: (p: Partial<HistoryFilters>) => void }) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center">
      <SearchField label="Search plays" placeholder="Song, artist or album…" value={filters.q ?? ""} onChange={(v) => setFilters({ q: v.trim() || undefined })} />
      <div className="-mx-(--gutter) flex gap-2 overflow-x-auto px-(--gutter) no-scrollbar md:mx-0 md:px-0">
        <Select label="Ending" value={filters.outcome ?? "all"} options={ENDING_OPTIONS} onChange={(v) => setFilters({ outcome: v === "all" ? undefined : v })} />
        <Select label="Device" value={filters.device ?? "all"} options={DEVICE_OPTIONS} onChange={(v) => setFilters({ device: v === "all" ? undefined : v })} />
        <Select label="Source" value={filters.source ?? "all"} options={SOURCE_OPTIONS} onChange={(v) => setFilters({ source: v === "all" ? undefined : v })} />
      </div>
    </div>
  );
}

export function Plays() {
  const { range } = useRange();
  const [filters, setFilters] = useFilters();
  const timezone = useTimezone();
  const lifetime = useLifetime();
  const home = useStatus().data?.homeCountry;
  const q = useHistory(range, filters);
  const scroller = useScrollElement();
  const [listRef, width] = useWidth<HTMLDivElement>();
  const desktop = width >= 640;
  const { visible, style } = useColumns(COLUMNS, width);
  const [margin, setMargin] = useState(0);

  const lines = useMemo<Line[]>(() => {
    const out: Line[] = [];
    let day = "";
    for (const page of q.data?.pages ?? [])
      for (const item of page.items) {
        if (item.day !== day) {
          day = item.day;
          out.push({ type: "day", day });
        }
        out.push({ type: "play", item });
      }
    return out;
  }, [q.data]);

  useLayoutEffect(() => {
    const el = listRef.current;
    const sc = scroller.current;
    if (!el || !sc) return;
    setMargin(el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop);
  }, [listRef, scroller, lines.length > 0, width]);

  const rowH = desktop ? 44 : 60;
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (lines[i]?.type === "day" ? 44 : rowH),
    overscan: 12,
    scrollMargin: margin,
  });
  const items = virtualizer.getVirtualItems();
  const last = items[items.length - 1];
  useEffect(() => {
    if (last && last.index >= lines.length - 20 && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
  }, [last, lines.length, q]);

  const total = q.data?.pages[0]?.total;
  const scoped = filters.artist ?? filters.songKey;
  const filtered = Boolean(filters.q || filters.outcome || filters.device || filters.source || scoped);
  const firstUse = lifetime.data?.plays === 0;

  return (
    <Page>
      <PageHeader title="Plays" actions={!firstUse && <RangePicker />} />
      {firstUse ? (
        <FirstUseState icon={ListBulletsIcon} description="Every play you import or encore logs from Spotify lands here." />
      ) : (
        <div className="flex flex-col gap-4">
          <Toolbar filters={filters} setFilters={setFilters} />
          <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-secondary tabular" aria-live="polite">
              {total === undefined ? " " : `${fmtInt(total)} ${total === 1 ? "play" : "plays"}`}
            </span>
            {scoped && (
              <Button size="sm" variant="secondary" iconEnd={XIcon} onClick={() => setFilters({ artist: undefined, songKey: undefined })}>
                {filters.artist ? `Artist: ${filters.artist}` : "One song"}
              </Button>
            )}
          </div>
          <div ref={listRef} role="table" aria-label="Plays" aria-rowcount={total} className={dimWhile(q.isPlaceholderData)}>
            {desktop && <TableHead columns={visible} style={style} className="mb-1" />}
            {q.isError ? (
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            ) : !q.data ? (
              <RowSkeleton rows={12} />
            ) : lines.length === 0 ? (
              <EmptyState
                title="No plays match"
                description={filtered ? "Clear the search or filters, or pick a wider range." : "Pick a wider range to see plays."}
                action={
                  filtered && (
                    <Button size="sm" onClick={() => setFilters({ q: undefined, outcome: undefined, device: undefined, source: undefined, artist: undefined, songKey: undefined })}>
                      Clear filters
                    </Button>
                  )
                }
              />
            ) : (
              <div role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
                {items.map((v) => {
                  const line = lines[v.index]!;
                  return (
                    <div key={v.key} className="absolute inset-x-0" style={{ top: 0, height: v.size, transform: `translateY(${v.start - margin}px)` }}>
                      {line.type === "day" ? (
                        <h2 role="row" className="flex h-full items-end px-2 pb-2 text-caption font-medium text-secondary">
                          <span role="cell">{dayHeading.format(new Date(`${line.day}T00:00:00Z`))}</span>
                        </h2>
                      ) : desktop ? (
                        <DesktopRow item={line.item} timezone={timezone} columns={visible} style={style} home={home} />
                      ) : (
                        <PhoneRow item={line.item} timezone={timezone} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {q.isFetchingNextPage && (
              <p role="status" className="flex items-center gap-2 py-4 text-secondary">
                <Icon icon={ListBulletsIcon} className="text-tertiary" />
                Loading more plays…
              </p>
            )}
          </div>
        </div>
      )}
    </Page>
  );
}
