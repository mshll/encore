import { useMemo, useState, type KeyboardEvent } from "react";
import { useClock, useTopArtists, useTopTracks } from "../api/queries";
import { fmtHour, fmtHours, fmtInt, WEEKDAYS, WEEKDAYS_SHORT } from "../lib/format";
import { useRange, type Range } from "../lib/range";
import { useDesktop } from "../lib/useMedia";
import { artistPath, songPath } from "../ui/AppLink";
import { Page, Section } from "../ui/Page";
import { Row, RowList } from "../ui/rows";
import { Empty, ErrorState, Skeleton, SkeletonRows } from "../ui/states";

const DAY_ORDER = [7, 1, 2, 3, 4, 5, 6];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

type Cell = { weekday: number; hour: number; hours: number; plays: number };

const shade = (v: number, max: number) =>
  v <= 0 ? "var(--component)" : `color-mix(in oklab, var(--chart-key) ${Math.round(4 + (v / max) * 96)}%, var(--component))`;
const plural = (weekday: number) => `${WEEKDAYS[weekday - 1]}s`;

function Heatmap({ cells, selected, onSelect, vertical }: { cells: Cell[]; selected: Cell | null; onSelect: (c: Cell) => void; vertical: boolean }) {
  const max = Math.max(...cells.map((c) => c.hours), 0.0001);
  const at = (weekday: number, hour: number) => cells.find((c) => c.weekday === weekday && c.hour === hour)!;
  const [focus, setFocus] = useState<{ d: number; h: number }>({ d: 0, h: 21 });

  const move = (e: KeyboardEvent) => {
    const delta: Record<string, [number, number]> = vertical
      ? { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      : { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(at(DAY_ORDER[focus.d]!, focus.h));
      return;
    }
    const step = delta[e.key];
    if (!step) return;
    e.preventDefault();
    const next = { d: Math.max(0, Math.min(6, focus.d + step[0])), h: Math.max(0, Math.min(23, focus.h + step[1])) };
    setFocus(next);
    onSelect(at(DAY_ORDER[next.d]!, next.h));
  };

  const cell = (d: number, h: number) => {
    const c = at(DAY_ORDER[d]!, h);
    const isSel = selected?.weekday === c.weekday && selected.hour === c.hour;
    return (
      <div
        key={`${d}-${h}`}
        role="gridcell"
        aria-selected={isSel}
        aria-label={`${plural(c.weekday)} at ${fmtHour(h)}: ${fmtHours(c.hours)}, ${fmtInt(c.plays)} plays`}
        onClick={() => {
          setFocus({ d, h });
          onSelect(c);
        }}
        title={`${WEEKDAYS_SHORT[c.weekday - 1]} ${fmtHour(h)}: ${fmtHours(c.hours)}`}
        className={`rounded-[3px] ${isSel ? "outline-2 outline-offset-1 outline-(--fg-primary)" : ""}`}
        style={{ background: shade(c.hours, max) }}
      />
    );
  };

  const common = {
    role: "grid",
    tabIndex: 0,
    "aria-label": "Listening by weekday and hour, Kuwait time. Use arrow keys to move.",
    onKeyDown: move,
    className: "outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--fg-primary) rounded-sm",
  } as const;

  if (vertical)
    return (
      <div {...common} className={`${common.className} grid grid-cols-[40px_repeat(7,1fr)] gap-[3px]`}>
        <div />
        {DAY_ORDER.map((d) => (
          <div key={d} className="pb-1 text-center text-caption-lg text-tertiary">
            {WEEKDAYS_SHORT[d - 1]}
          </div>
        ))}
        {HOURS.map((h) => (
          <div key={h} role="row" className="contents">
            <div className="flex h-[18px] items-center text-caption-base text-tertiary tabular">{h % 3 === 0 ? fmtHour(h) : ""}</div>
            {DAY_ORDER.map((_, d) => cell(d, h))}
          </div>
        ))}
      </div>
    );

  return (
    <div {...common} className={`${common.className} grid grid-cols-[44px_repeat(24,1fr)] gap-[3px]`}>
      {DAY_ORDER.map((weekday, d) => (
        <div key={weekday} role="row" className="contents">
          <div className="flex h-8 items-center text-caption-lg text-tertiary">{WEEKDAYS_SHORT[weekday - 1]}</div>
          {HOURS.map((h) => cell(d, h))}
        </div>
      ))}
      <div />
      {HOURS.map((h) => (
        <div key={h} className="pt-1 text-caption-base text-tertiary tabular">
          {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
        </div>
      ))}
    </div>
  );
}

function CellDetail({ cell, range }: { cell: Cell; range: Range }) {
  const at = { weekday: cell.weekday, hour: cell.hour };
  const songs = useTopTracks(range, 8, at);
  const artists = useTopArtists(range, 5, at);
  return (
    <Section
      title={`${plural(cell.weekday)}, ${fmtHour(cell.hour)} to ${fmtHour((cell.hour + 1) % 24)}`}
      aside={
        <span className="text-body-sm text-secondary tabular">
          {fmtHours(cell.hours)}, {fmtInt(cell.plays)} plays
        </span>
      }
    >
      {cell.plays === 0 ? (
        <Empty title="Nothing played in this hour" />
      ) : (
        <div className="grid gap-8 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <p className="text-body-sm font-medium text-secondary">Top songs</p>
            {!songs.data ? (
              <SkeletonRows rows={5} />
            ) : (
              <RowList className={songs.isPlaceholderData ? "opacity-60" : ""}>
                {songs.data.items.map((s, i) => (
                  <Row
                    key={s.songKey}
                    to={songPath(s.songKey)}
                    rank={i + 1}
                    art={{ src: s.albumArtUrl }}
                    title={s.name}
                    subtitle={s.artist}
                    value={fmtHours(s.hours)}
                  />
                ))}
              </RowList>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-body-sm font-medium text-secondary">Top artists</p>
            {!artists.data ? (
              <SkeletonRows rows={5} />
            ) : (
              <RowList className={artists.isPlaceholderData ? "opacity-60" : ""}>
                {artists.data.items.map((a, i) => (
                  <Row
                    key={a.artist}
                    to={artistPath(a.artist)}
                    rank={i + 1}
                    art={{ src: a.imageUrl, round: true }}
                    title={a.artist}
                    value={fmtHours(a.hours)}
                  />
                ))}
              </RowList>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

export default function Clock() {
  const { range } = useRange();
  const q = useClock(range);
  const desktop = useDesktop();
  const [selected, setSelected] = useState<{ weekday: number; hour: number } | null>(null);
  const peak = useMemo(() => q.data?.cells.reduce((best, c) => (c.hours > best.hours ? c : best)), [q.data]);
  const pick = selected ?? peak;
  const current = q.data && pick ? q.data.cells.find((c) => c.weekday === pick.weekday && c.hour === pick.hour)! : null;
  const total = q.data?.cells.reduce((s, c) => s + c.hours, 0) ?? 0;

  return (
    <Page title="Clock" ranged>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || !peak ? (
        <Skeleton className="h-[480px] w-full md:h-[300px]" />
      ) : total === 0 ? (
        <Empty title="No plays in this range">Pick a wider range to see when you listen.</Empty>
      ) : (
        <Section>
          <p className="max-w-2xl text-body-lg text-secondary text-pretty">
            Busiest hour:{" "}
            <strong className="font-semibold text-primary">
              {plural(peak.weekday)} at {fmtHour(peak.hour)}
            </strong>
            , {fmtHours(peak.hours)} in total. Times are Kuwait time.
          </p>
          <div className={q.isPlaceholderData ? "opacity-60" : ""}>
            <Heatmap cells={q.data.cells} selected={current} onSelect={setSelected} vertical={!desktop} />
          </div>
          <div className="flex items-center gap-2 text-caption-lg text-secondary">
            <span>Less</span>
            <span aria-hidden className="h-2 w-24 rounded-full" style={{ background: "linear-gradient(to right, var(--component), var(--chart-key))" }} />
            <span>More</span>
          </div>
        </Section>
      )}
      {current && <CellDetail cell={current} range={range} />}
    </Page>
  );
}
