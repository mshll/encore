import type { AnswerAxis, AnswerItem, AnswerUnit, AnswerVisual } from "../api/types";
import { albumPath, artistPath, songPath } from "../app/paths";
import { DataTable } from "../charts/DataTable";
import { DitherBars } from "../charts/Dither";
import { DitherMeter } from "../charts/DitherMeter";
import { InlineChange, InlineColumns, InlinePair, InlineShare } from "../charts/Inline";
import { PairMeter } from "../charts/PairMeter";
import { fmtDay, fmtDayShort, fmtCompact, fmtHour, fmtHours, fmtInt, fmtMonth, fmtMonthLong, fmtPct, WEEKDAYS, WEEKDAYS_SHORT } from "../lib/format";
import { Row, RowList } from "./Rows";
import { Skeleton } from "./Skeleton";

export function fmtValue(v: number, unit: AnswerUnit): string {
  if (unit.type === "hours") return fmtHours(v);
  if (unit.type === "percent") return fmtPct(v);
  return `${fmtInt(v)} ${v === 1 ? unit.noun.replace(/s$/, "") : unit.noun}`;
}

/** A short figure for a column of numbers: the unit word is in the heading or the sentence, and huge values go compact. */
function fmtFigure(v: number, unit: AnswerUnit): string {
  if (unit.type === "count") return fmtCompact(v);
  if (unit.type === "hours" && v >= 10_000) return `${fmtCompact(v)} h`;
  return fmtValue(v, unit);
}

function fmtX(x: string, axis: AnswerAxis, long: boolean): string {
  if (axis === "month") return long ? fmtMonthLong(x) : fmtMonth(x);
  if (axis === "day") return long ? fmtDay(x) : fmtDayShort(x);
  if (axis === "hour") return fmtHour(Number(x));
  if (axis === "weekday") return (long ? WEEKDAYS : WEEKDAYS_SHORT)[Number(x) - 1] ?? x;
  return x;
}

const peak = (points: { x: string; y: number }[]) => points.reduce((a, b) => (b.y > a.y ? b : a), { x: "", y: 0 });

function seriesLabel(v: Extract<AnswerVisual, { kind: "series" }>) {
  const top = peak(v.points);
  return top.y > 0 ? `${v.title}: highest ${fmtValue(top.y, v.unit)}, ${fmtX(top.x, v.axis, true)}` : `${v.title}: none`;
}

/** An inline visual, sized for a line of text, beside the figure the sentence already states. */
export function InlineVisual({ visual }: { visual: AnswerVisual }) {
  switch (visual.kind) {
    case "pair":
      return (
        <span className="inline-flex items-center gap-1.5 align-middle">
          <InlinePair now={visual.now} before={visual.before} label={`${visual.label}: ${fmtValue(visual.now, visual.unit)} against ${fmtValue(visual.before, visual.unit)}`} />
          <InlineChange now={visual.now} before={visual.before} className="text-caption" />
        </span>
      );
    case "share":
      return (
        <InlineShare
          share={visual.share}
          before={visual.before}
          label={`${visual.label}: ${fmtPct(visual.share)}${visual.before === null ? "" : `, from ${fmtPct(visual.before)}`}`}
        />
      );
    case "series": {
      const top = peak(visual.points);
      return <InlineColumns values={visual.points.map((p) => p.y)} mark={top.y > 0 ? visual.points.indexOf(top) : null} label={seriesLabel(visual)} />;
    }
    default:
      return null;
  }
}

function ItemRow({ item, rank, value, share }: { item: AnswerItem; rank: number; value: string; share: number }) {
  switch (item.kind) {
    case "song":
      return (
        <Row
          to={songPath(item.songKey)}
          title={item.name}
          subtitle={item.artist}
          art={{ src: item.art, kind: "song" }}
          rank={rank}
          value={value}
          share={share}
          song={item.uri ? { uri: item.uri, name: item.name, songKey: item.songKey, artist: item.artist } : undefined}
        />
      );
    case "artist":
      return <Row to={artistPath(item.name)} title={item.name} art={{ src: item.art, kind: "artist" }} rank={rank} value={value} share={share} />;
    case "album":
      return <Row to={albumPath(item.artist, item.name)} title={item.name} subtitle={item.artist} art={{ src: item.art, kind: "album" }} rank={rank} value={value} share={share} />;
    case "label":
      return (
        <li className="-mx-2 flex min-h-(--row-h) items-center gap-3 px-2">
          <span className="w-[var(--rank-w,1.25rem)] shrink-0 text-right text-caption text-tertiary tabular">{rank}</span>
          <span className="min-w-0 flex-1 truncate text-primary first-letter:uppercase">{item.name}</span>
          <DitherMeter share={share} className="hidden w-24 shrink-0 @lg:block" />
          <span className="w-16 shrink-0 text-right text-secondary tabular">{value}</span>
        </li>
      );
  }
}

const Title = ({ children }: { children: string }) => <figcaption className="font-medium text-primary">{children}</figcaption>;

function Compare({ visual }: { visual: Extract<AnswerVisual, { kind: "compare" }> }) {
  const max = Math.max(...visual.rows.flatMap((r) => [r.now, r.before]), 0);
  const cols = "grid grid-cols-[minmax(0,1fr)_5rem_5rem] items-center gap-x-3 @md:grid-cols-[minmax(0,1fr)_6rem_5rem_5rem]";
  return (
    <>
      <div className="@container">
        <div aria-hidden className={`${cols} pb-1 text-caption text-secondary`}>
          <span />
          <span className="hidden @md:block" />
          <span className="truncate text-right" title={visual.nowLabel}>
            {visual.nowLabel}
          </span>
          <span className="truncate text-right" title={visual.beforeLabel}>
            {visual.beforeLabel}
          </span>
        </div>
        <ol aria-hidden>
          {visual.rows.map((r, i) => (
            <li key={i} className={`${cols} min-h-(--row-h)`}>
              <span className="truncate text-primary" title={r.label}>
                {r.label}
              </span>
              <PairMeter now={r.now} before={r.before} max={max} className="hidden w-full @md:flex" />
              <span className="text-right text-primary tabular">{fmtFigure(r.now, visual.unit)}</span>
              <span className="text-right text-secondary tabular">{fmtFigure(r.before, visual.unit)}</span>
            </li>
          ))}
        </ol>
      </div>
      <DataTable
        label={visual.title}
        head={["", visual.nowLabel, visual.beforeLabel]}
        rows={visual.rows.map((r, i) => ({ key: String(i), cells: [r.label, fmtValue(r.now, visual.unit), fmtValue(r.before, visual.unit)] }))}
      />
    </>
  );
}

/** A visual on a line of its own: a ranked list, a chart over periods, or labelled rows now against before. */
export function BlockVisual({ visual }: { visual: AnswerVisual | undefined }) {
  if (!visual) return <Skeleton className="h-40 w-full" />;
  const empty = visual.kind === "series" ? visual.points.every((p) => p.y === 0) : visual.kind === "ranked" || visual.kind === "compare" ? visual.rows.length === 0 : false;
  if (empty && "title" in visual)
    return (
      <figure className="flex flex-col gap-1">
        <Title>{visual.title}</Title>
        <p className="text-secondary">Nothing in this period.</p>
      </figure>
    );
  if (visual.kind === "ranked") {
    const max = Math.max(...visual.rows.map((r) => r.value), 0);
    return (
      <figure className="flex flex-col gap-1">
        <Title>{visual.title}</Title>
        <RowList label={visual.title}>
          {visual.rows.map((r, i) => (
            <ItemRow key={i} item={r.item} rank={i + 1} value={fmtFigure(r.value, visual.unit)} share={max > 0 ? r.value / max : 0} />
          ))}
        </RowList>
      </figure>
    );
  }
  if (visual.kind === "series") {
    const unitLabel = visual.unit.type === "hours" ? "Hours" : visual.unit.type === "percent" ? "Share" : visual.unit.noun.replace(/^./, (c) => c.toUpperCase());
    return (
      <figure className="flex flex-col gap-2">
        <Title>{visual.title}</Title>
        <DitherBars
          label={seriesLabel(visual)}
          rows={visual.points.map((p) => ({ x: p.x, period: fmtX(p.x, visual.axis, true), value: p.y }))}
          xKey="x"
          valueKey="value"
          valueLabel={unitLabel}
          tipLabel="period"
          xFormat={(x) => fmtX(x, visual.axis, false)}
          format={(v) => fmtFigure(v, visual.unit)}
          height={160}
        />
      </figure>
    );
  }
  if (visual.kind === "compare")
    return (
      <figure className="flex flex-col gap-1">
        <Title>{visual.title}</Title>
        <Compare visual={visual} />
      </figure>
    );
  return null;
}
