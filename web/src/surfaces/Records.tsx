import type { ReactNode } from "react";
import { useMilestones, useRecords, useStreaks } from "../api/queries";
import type { Milestone, Records as RecordsData, Streaks } from "../api/types";
import { artistPath, songPath } from "../app/paths";
import { fmtDay, fmtDayRange, fmtHours, fmtInt, fmtMonthLong } from "../lib/format";
import { fmtMinutes, milestoneText, plural } from "../lib/insights";
import { useRange, type Range } from "../lib/range";
import { AppLink } from "../ui/AppLink";
import { cx } from "../ui/cx";
import { TrophyIcon } from "../ui/icons";
import { SECTIONS, SIDE_COLUMNS, Section, dimWhile } from "../ui/Page";
import { RangePicker } from "../ui/RangePicker";
import { Row, RowList, RowSkeleton } from "../ui/Rows";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState, ErrorState } from "../ui/States";
import { PatternsFrame } from "./PatternsFrame";

/** The streak that leads the page: the current one, else the longest in the range. */
function StreakFigure({ streaks }: { streaks: Streaks }) {
  const { current, longest } = streaks;
  const lead = current ?? longest;
  if (!lead) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption font-medium text-secondary">{current ? "Days in a row with music" : "Longest run of days with music"}</span>
      <p className="flex items-baseline gap-1.5">
        <span className="font-display text-figure text-primary tabular">{fmtInt(lead.days)}</span>
        <span className="text-secondary">{lead.days === 1 ? "day" : "days"}</span>
      </p>
      <p className="text-secondary text-pretty">
        {current ? `Since ${fmtDay(current.from)}` : fmtDayRange(lead.from, lead.to)}
        {current && longest && longest.days > current.days && `; the longest in this range is ${plural(longest.days, "day", "days")}, ${fmtDayRange(longest.from, longest.to)}`}
      </p>
    </div>
  );
}

type Best = { label: string; figure: string; detail: ReactNode };

function bests(r: RecordsData): Best[] {
  const out: Best[] = [];
  if (r.day) out.push({ label: "Biggest day", figure: fmtHours(r.day.hours), detail: fmtDay(r.day.day) });
  if (r.week) out.push({ label: "Biggest week", figure: fmtHours(r.week.hours), detail: `Week of ${fmtDay(r.week.week)}` });
  if (r.month) out.push({ label: "Biggest month", figure: fmtHours(r.month.hours), detail: fmtMonthLong(r.month.month) });
  if (r.session)
    out.push({ label: "Longest session", figure: fmtMinutes(r.session.minutes), detail: `${fmtDay(r.session.day)}, ${plural(r.session.plays, "play", "plays")}` });
  if (r.songDay)
    out.push({
      label: "One song in a day",
      figure: plural(r.songDay.listens, "listen", "listens"),
      detail: (
        <>
          <AppLink to={songPath(r.songDay.song.songKey)} className="text-primary hover:underline">
            {r.songDay.song.name}
          </AppLink>
          , {fmtDay(r.songDay.day)}
        </>
      ),
    });
  return out;
}

function Bests({ records }: { records: RecordsData }) {
  const rows = bests(records);
  return (
    <Section title="Bests" description={`A session ends after ${records.sessionGapMinutes} minutes with nothing playing.`} labelledBy="records-bests">
      <dl className="flex flex-col">
        {rows.map((b) => (
          <div key={b.label} className="grid min-h-(--row-h) grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-1.5 md:grid-cols-[10rem_7rem_minmax(0,1fr)]">
            <dt className="text-secondary">{b.label}</dt>
            <dd className="text-right font-medium text-primary tabular md:text-left">{b.figure}</dd>
            <dd className="col-span-2 truncate text-caption text-secondary md:col-span-1 md:text-body-sm">{b.detail}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function ArtistRuns({ streaks }: { streaks: Streaks }) {
  return (
    <Section title="Longest runs by artist" description="Most days in a row with a listen of them" labelledBy="records-artists">
      {streaks.artists.length === 0 ? (
        <EmptyState size="inline" title="No artist played two days running" />
      ) : (
        <RowList label="Longest runs by artist">
          {streaks.artists.map((a) => (
            <Row key={a.artist} to={artistPath(a.artist)} title={a.artist} subtitle={fmtDayRange(a.from, a.to)} art={{ src: a.imageUrl, kind: "artist" }} value={fmtInt(a.days)} />
          ))}
        </RowList>
      )}
    </Section>
  );
}

function MilestoneRow({ m }: { m: Milestone }) {
  const { title, figure, detail } = milestoneText(m);
  if (m.kind === "song")
    return (
      <Row
        to={songPath(m.song.songKey)}
        title={title}
        subtitle={detail}
        art={{ src: m.song.albumArtUrl, kind: "song" }}
        value={figure}
        song={{ uri: m.song.uri, name: m.song.name, songKey: m.song.songKey, artist: m.song.artist }}
      />
    );
  if (m.kind === "artist") return <Row to={artistPath(m.artist)} title={title} subtitle={detail} art={{ src: m.imageUrl, kind: "artist" }} value={figure} />;
  return <Row title={title} subtitle={detail} art={{ src: null, kind: "song" }} value={figure} />;
}

function MilestoneList({ range }: { range: Range }) {
  const q = useMilestones(range);
  return (
    <Section title="Milestones" description="Newest first: a song's 10th, 25th, 50th listen and on, an artist's 10th, 50th, 100th hour and on" labelledBy="records-milestones">
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <RowSkeleton rows={6} />
      ) : q.data.items.length === 0 ? (
        <EmptyState size="inline" title="No milestones in this range" />
      ) : (
        <RowList label="Milestones" className={dimWhile(q.isPlaceholderData)}>
          {q.data.items.map((m) => (
            <MilestoneRow key={`${m.kind}|${m.kind === "song" ? m.song.songKey : m.kind === "artist" ? m.artist : ""}|${m.threshold}`} m={m} />
          ))}
        </RowList>
      )}
    </Section>
  );
}

function RecordsView({ range }: { range: Range }) {
  const records = useRecords(range);
  const streaks = useStreaks(range);
  const error = records.error ?? streaks.error;
  if (error) return <ErrorState error={error} onRetry={() => void Promise.all([records.refetch(), streaks.refetch()])} />;
  if (!records.data || !streaks.data)
    return (
      <div aria-busy className="flex flex-col gap-6">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-64" />
        <RowSkeleton rows={5} />
      </div>
    );
  if (!records.data.day) return <EmptyState size="section" title="No plays in this range" description="Pick a wider range to see your records." action={<RangePicker />} />;
  return (
    <div className={cx(SECTIONS, dimWhile(records.isPlaceholderData || streaks.isPlaceholderData))}>
      <StreakFigure streaks={streaks.data} />
      <div className={SIDE_COLUMNS}>
        <div className={SECTIONS}>
          <Bests records={records.data} />
          <MilestoneList range={range} />
        </div>
        <ArtistRuns streaks={streaks.data} />
      </div>
    </div>
  );
}

export function Records(): ReactNode {
  const { range } = useRange();
  return (
    <PatternsFrame icon={TrophyIcon} firstUse="Once plays come in, this shows your biggest days, longest runs and the milestones you pass.">
      <RecordsView range={range} />
    </PatternsFrame>
  );
}
