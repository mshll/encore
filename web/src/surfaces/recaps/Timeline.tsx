import { useState } from "react";
import type { RecapTimeline, TimelineRow } from "../../api/types";
import { recapPath } from "../../app/paths";
import { InlineChange, InlinePair } from "../../charts/Inline";
import { fmtDayShort, fmtHoursValue, fmtInt, fmtMonthShort } from "../../lib/format";
import { AppLink } from "../../ui/AppLink";
import { Button } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { Notice } from "../../ui/Notice";
import type { RecapWriter } from "./write";

/** Years open on arrival; older years show their own row and open on a tap. */
const OPEN_YEARS = 2;

type Level = "year" | "month" | "week";

const monthName = (key: string) => new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`));
const shortHours = (h: number) => (h <= 0 ? "0 h" : h * 60 < 60 ? `${Math.round(h * 60)} min` : `${fmtHoursValue(h)} h`);
const weekLabel = (r: TimelineRow) => (r.from.slice(0, 7) === r.to.slice(0, 7) ? `${Number(r.from.slice(8))} – ${fmtDayShort(r.to)}` : `${fmtDayShort(r.from)} – ${fmtDayShort(r.to)}`);

function label(r: TimelineRow): string {
  if (r.kind === "weekly") return r.inProgress ? "This week so far" : weekLabel(r);
  if (r.kind === "monthly") return r.inProgress ? `${monthName(r.key)} so far` : monthName(r.key);
  return r.inProgress ? `${r.key} so far` : r.key;
}

/** What the row says: the written headline, else the figures' own line; a period with no recap says so. */
function line(r: TimelineRow): { text: string; quiet: boolean } {
  if (r.hours <= 0 && (!r.recap || !r.recap.headline)) return { text: "No listening", quiet: true };
  if (!r.recap) return { text: "No recap yet", quiet: true };
  if (r.recap.headline) return { text: r.recap.headline, quiet: false };
  return { text: r.recap.topArtist ? `Mostly ${r.recap.topArtist}` : "Figures only", quiet: false };
}

const compareLabel = (r: TimelineRow) => (r.kind === "weekly" ? "the week before" : r.kind === "monthly" ? fmtMonthShort(shiftMonth(r.key)) : String(Number(r.key) - 1));
const shiftMonth = (key: string) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);

const LABEL: Record<Level, string> = {
  year: "font-display text-figure text-primary tabular",
  month: "text-heading font-medium text-primary",
  week: "text-body-sm text-secondary tabular",
};

/** The whole row is the link; Write it sits above the link, so a tap on it does not open the recap. */
function Row({ r, level, writer }: { r: TimelineRow; level: Level; writer: RecapWriter }) {
  const said = line(r);
  const name = label(r);
  const canWrite = writer.canWrite && !r.recap && r.hours > 0;
  const writing = writer.writing(r.kind, r.key);
  return (
    <li
      className={cx(
        "group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 rounded-md px-2 -mx-2 transition-colors duration-(--dur-hover) hover:bg-fill",
        "md:grid-cols-[10rem_minmax(0,1fr)_auto_auto]",
        level === "year" ? "min-h-14 py-2" : level === "month" ? "min-h-(--row-h) py-1.5" : "min-h-(--row-h-compact) py-1",
      )}
    >
      <AppLink to={recapPath(r.kind, r.key)} className="absolute inset-0 rounded-md" aria-label={`${name}: ${said.text}, ${shortHours(r.hours)}`} />
      <span className={cx("min-w-0 truncate", LABEL[level], level === "week" && "md:pl-6")}>{name}</span>
      <span className="col-start-1 row-start-2 flex min-w-0 items-center gap-3 md:col-start-2 md:row-start-1">
        <span className={cx("line-clamp-2 min-w-0 md:line-clamp-1", level === "week" ? "text-body-sm" : "text-body", said.quiet ? "text-tertiary" : "text-primary")}>{said.text}</span>
        {canWrite && (
          <Button size="sm" variant="ghost" className={cx("relative z-10 -my-1 shrink-0", !writing && "can-hover:opacity-0 can-hover:group-hover:opacity-100 can-hover:focus-visible:opacity-100")} busy={writing} busyLabel="Writing" disabled={writer.working && !writing} onClick={() => void writer.write(r.kind, r.key)}>
            Write it
          </Button>
        )}
      </span>
      <span className="col-start-2 row-span-2 row-start-1 flex items-center justify-end gap-3 md:col-start-3 md:row-span-1">
        {r.before !== null && r.hours + r.before > 0 && (
          <InlinePair now={r.hours} before={r.before} label={`${shortHours(r.hours)}, against ${shortHours(r.before)} in ${compareLabel(r)}`} />
        )}
        <span className="flex w-14 flex-col items-end">
          <span className={cx("tabular", level === "week" ? "text-body-sm text-secondary" : "text-body text-primary")}>{shortHours(r.hours)}</span>
          {r.before !== null && r.hours + r.before > 0 && <InlineChange className="text-caption md:hidden" now={r.hours} before={r.before} />}
        </span>
      </span>
      <span className="hidden w-14 text-right text-body-sm md:block">{r.before !== null && r.hours + r.before > 0 && <InlineChange now={r.hours} before={r.before} />}</span>
    </li>
  );
}

function Weeks({ weeks, writer }: { weeks: TimelineRow[]; writer: RecapWriter }) {
  if (weeks.length === 0) return null;
  return (
    <ul aria-label="Weeks" className="flex flex-col">
      {weeks.map((w) => (
        <Row key={w.key} r={w} level="week" writer={writer} />
      ))}
    </ul>
  );
}

function Year({ y, open, writer }: { y: RecapTimeline["years"][number]; open: boolean; writer: RecapWriter }) {
  const [shown, setShown] = useState(open);
  return (
    <section aria-label={y.year.key} className="flex flex-col gap-2">
      <ul>
        <Row r={y.year} level="year" writer={writer} />
      </ul>
      {shown ? (
        <ul className="flex flex-col gap-2">
          {y.months.map((m) => (
            <li key={m.month.key} className="flex flex-col">
              <ul>
                <Row r={m.month} level="month" writer={writer} />
              </ul>
              <Weeks weeks={m.weeks} writer={writer} />
            </li>
          ))}
        </ul>
      ) : (
        y.months.length > 0 && (
          <Button variant="ghost" size="sm" className="-ml-2.5 self-start" onClick={() => setShown(true)}>
            Show {fmtInt(y.months.length)} {y.months.length === 1 ? "month" : "months"}
          </Button>
        )
      )}
    </section>
  );
}

/** Every period the history reaches: the week and month still going, then each year with its months and weeks. */
export function Timeline({ timeline, writer }: { timeline: RecapTimeline; writer: RecapWriter }) {
  const { week, month, weeks } = timeline.current;
  return (
    <div className="flex flex-col gap-10 md:gap-12">
      {writer.problem && (
        <Notice tone="danger">
          {writer.problem}
        </Notice>
      )}
      {(week || month) && (
        <section aria-label="So far" className="flex flex-col gap-2">
          <ul>
            {week && <Row r={week} level="month" writer={writer} />}
            {month && <Row r={month} level="month" writer={writer} />}
          </ul>
          <Weeks weeks={weeks} writer={writer} />
        </section>
      )}
      {timeline.years.map((y, i) => (
        <Year key={y.year.key} y={y} open={i < OPEN_YEARS} writer={writer} />
      ))}
    </div>
  );
}
