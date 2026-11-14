import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "wouter";
import { useHistory, useTimezone, type HistoryFilters } from "../api/queries";
import type { Device, HistoryItem } from "../api/types";
import { countryName, DEVICE_LABELS, fmtDuration, fmtInt, fmtTime } from "../lib/format";
import { useRange } from "../lib/range";
import { useDesktop } from "../lib/useMedia";
import { AppLink, artistPath, songPath } from "../ui/AppLink";
import { Cancel01Icon, Icon } from "../ui/Icon";
import { Page } from "../ui/Page";
import { Artwork } from "../ui/Artwork";
import { SongContext, SongMenu } from "../ui/SongMenu";
import { Empty, ErrorState, SkeletonRows } from "../ui/states";

type Line = { type: "day"; day: string } | { type: "play"; item: HistoryItem };

const SOURCE_LABELS: Record<HistoryItem["source"], string> = { export: "From export", api: "Recently played", live: "Watched live" };

const dayHeading = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function useFilters() {
  const [params, setParams] = useSearchParams();
  const filters: HistoryFilters = {
    q: params.get("q") ?? undefined,
    skipped: (params.get("skipped") as "true" | "false" | null) ?? undefined,
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

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => text !== value && onChange(text), 250);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  return (
    <label className="field md:max-w-72">
      <span className="sr-only">Search plays</span>
      <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Song, artist or album" />
    </label>
  );
}

function PlayRow({ item, timezone, desktop }: { item: HistoryItem; timezone: string; desktop: boolean }) {
  const time = fmtTime(item.ts, timezone);
  const played = fmtDuration(item.msPlayed);
  const title = item.songKey ? (
    <AppLink to={songPath(item.songKey)} className="truncate font-medium hover-fine:underline">
      {item.name}
    </AppLink>
  ) : (
    <span className="truncate font-medium">{item.name ?? "Unknown"}</span>
  );
  const artist = item.artist ? (
    <AppLink to={artistPath(item.artist)} className="truncate text-secondary hover-fine:underline">
      {item.artist}
    </AppLink>
  ) : null;
  const skipped = item.skipped ? "Skipped" : "";
  if (!desktop) {
    const row = (
      <div className="flex h-full items-center gap-3">
        <Artwork src={item.albumArtUrl} name={item.name ?? undefined} className="size-11" />
        <span className="flex min-w-0 flex-1 flex-col">
          {title}
          <span className="flex min-w-0 text-body-sm">{artist}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end text-body-sm tabular">
          <span>{time}</span>
          <span className="text-secondary">{skipped || played}</span>
        </span>
      </div>
    );
    return item.kind === "track" && item.uri && item.name ? (
      <SongContext song={{ uri: item.uri, name: item.name }} element="div" className="h-full">
        {row}
      </SongContext>
    ) : (
      row
    );
  }
  return (
    <div className="group grid h-full grid-cols-[48px_40px_minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)_56px_72px_minmax(0,1.2fr)_32px] items-center gap-4 text-body-sm">
      <span className="text-secondary tabular">{time}</span>
      <Artwork src={item.albumArtUrl} name={item.name ?? undefined} className="size-10" />
      <span className="flex min-w-0">{title}</span>
      <span className="flex min-w-0">{artist}</span>
      <span className="truncate text-secondary">{item.album}</span>
      <span className="text-right tabular">{played}</span>
      <span className="text-secondary">{skipped}</span>
      <span className="truncate text-secondary">
        {[
          item.device === "unknown" ? null : DEVICE_LABELS[item.device],
          item.country && item.country !== "KW" ? countryName(item.country) : null,
          item.source === "live" ? "live" : null,
        ]
          .filter(Boolean)
          .join(", ")}
      </span>
      {item.kind === "track" && item.uri && item.name ? (
        <SongMenu
          song={{ uri: item.uri, name: item.name }}
          className="md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[popup-open]:opacity-100"
        />
      ) : (
        <span />
      )}
    </div>
  );
}

export default function History() {
  const { range } = useRange();
  const [filters, setFilters] = useFilters();
  const timezone = useTimezone();
  const desktop = useDesktop();
  const q = useHistory(range, filters);
  const listRef = useRef<HTMLDivElement>(null);

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

  const rowH = desktop ? 52 : 60;
  const virtualizer = useWindowVirtualizer({
    count: lines.length,
    estimateSize: (i) => (lines[i]?.type === "day" ? 48 : rowH),
    overscan: 12,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });
  const items = virtualizer.getVirtualItems();
  const last = items[items.length - 1];
  useEffect(() => {
    if (last && last.index >= lines.length - 20 && q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
  }, [last, lines.length, q]);

  const total = q.data?.pages[0]?.total;
  const scoped = filters.artist ?? filters.songKey;

  return (
    <Page title="History" ranged>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <SearchField value={filters.q ?? ""} onChange={(v) => setFilters({ q: v.trim() || undefined })} />
            <div className="grid grid-cols-2 gap-2 md:flex">
              <label className="field md:w-40">
                <span className="sr-only">Skipped</span>
                <select value={filters.skipped ?? ""} onChange={(e) => setFilters({ skipped: (e.target.value || undefined) as HistoryFilters["skipped"] })}>
                  <option value="">All plays</option>
                  <option value="true">Skipped</option>
                  <option value="false">Played through</option>
                </select>
              </label>
              <label className="field md:w-40">
                <span className="sr-only">Device</span>
                <select value={filters.device ?? ""} onChange={(e) => setFilters({ device: e.target.value || undefined })}>
                  <option value="">All devices</option>
                  {(Object.keys(DEVICE_LABELS) as Device[]).map((d) => (
                    <option key={d} value={d}>
                      {DEVICE_LABELS[d]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field md:w-44">
                <span className="sr-only">Source</span>
                <select value={filters.source ?? ""} onChange={(e) => setFilters({ source: e.target.value || undefined })}>
                  <option value="">All sources</option>
                  {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {filters.source === "live" && (
            <p className="max-w-2xl text-body-sm text-secondary text-pretty">
              Live plays are watched as they happen. Play time is what encore saw, and a skip means the song changed before 90% of it.
            </p>
          )}
          <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-secondary">
            {total !== undefined && <span className="tabular">{fmtInt(total)} plays</span>}
            {scoped && (
              <button type="button" className="btn btn-tertiary" onClick={() => setFilters({ artist: undefined, songKey: undefined })}>
                {filters.artist ? `Artist: ${filters.artist}` : "One song"}
                <Icon icon={Cancel01Icon} size={16} />
              </button>
            )}
          </div>
        </div>

        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <SkeletonRows rows={12} />
        ) : lines.length === 0 ? (
          <Empty title="No plays match">Clear the search or filters, or pick a wider date range.</Empty>
        ) : (
          <div ref={listRef} className={q.isPlaceholderData ? "opacity-60" : ""}>
            {desktop && (
              <div className="grid h-9 grid-cols-[48px_40px_minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)_56px_72px_minmax(0,1.2fr)_32px] items-center gap-4 border-b-[0.5px] border-border-strong text-caption-lg font-medium text-secondary">
                <span>Time</span>
                <span />
                <span>Song</span>
                <span>Artist</span>
                <span>Album</span>
                <span className="text-right">Played</span>
                <span />
                <span>Device</span>
                <span />
              </div>
            )}
            <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {items.map((v) => {
                const line = lines[v.index]!;
                return (
                  <div
                    key={v.key}
                    className="absolute inset-x-0"
                    style={{ top: 0, height: v.size, transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}
                  >
                    {line.type === "day" ? (
                      <h2 className="flex h-full items-end pb-2 text-body-sm font-semibold">{dayHeading.format(new Date(`${line.day}T00:00:00Z`))}</h2>
                    ) : (
                      <PlayRow item={line.item} timezone={timezone} desktop={desktop} />
                    )}
                  </div>
                );
              })}
            </div>
            {q.isFetchingNextPage && <p className="py-4 text-body-sm text-secondary">Loading more plays</p>}
          </div>
        )}
      </div>
    </Page>
  );
}
