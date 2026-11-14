import { useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { useLifetime, useTimezone } from "../../api/queries";
import type { ContextDimension, SkipProfile, Song, Stats, TimePoint } from "../../api/types";
import { songPath } from "../../app/paths";
import { DitherArea } from "../../charts/Dither";
import { SkipProfileChart } from "../../charts/SkipProfileChart";
import { periodTick, periodTitle } from "../../charts/ticks";
import { todayIn } from "../../lib/dates";
import { contextPhrase, fmtAgo, fmtDate, fmtHours, fmtHoursValue, fmtInt, fmtPct } from "../../lib/format";
import { periodFor, useRange, type Range } from "../../lib/range";
import { fillPeriods } from "../../lib/series";
import { useDesktop } from "../../lib/useMedia";
import { AppLink } from "../../ui/AppLink";
import { Button, buttonClass } from "../../ui/Button";
import { EntityHeaderSkeleton } from "../../ui/EntityHeader";
import { Section } from "../../ui/Page";
import { RangePicker } from "../../ui/RangePicker";
import { Row, RowList, RowSkeleton } from "../../ui/Rows";
import { Skeleton } from "../../ui/Skeleton";
import { StatStrip, type StatItem } from "../../ui/Stat";
import { EmptyState, ErrorState } from "../../ui/States";

export function usePeriod(range: Range) {
  const timezone = useTimezone();
  const lifetime = useLifetime();
  const today = todayIn(timezone);
  return { period: periodFor(range, lifetime.data?.firstPlayed?.slice(0, 10) ?? null, today), today };
}

/** First and last play in the range, as one line under the title. */
export function FirstLast({ totals }: { totals: Stats }) {
  const timezone = useTimezone();
  if (!totals.firstPlayed || !totals.lastPlayed) return null;
  if (totals.firstPlayed === totals.lastPlayed) return <>Played once, {fmtDate(totals.firstPlayed, timezone)}</>;
  return (
    <>
      First played {fmtDate(totals.firstPlayed, timezone)}, last played {fmtAgo(totals.lastPlayed)}
    </>
  );
}

type Metric = "hours" | "plays" | "listens";
const METRIC_LABEL: Record<Metric, string> = { hours: "Hours", plays: "Plays", listens: "Listens" };

/** Three figures for the range; the chosen one draws listening over time under them. */
export function Listening({ totals, timeline }: { totals: Stats; timeline: TimePoint[] }) {
  const { range } = useRange();
  const { period, today } = usePeriod(range);
  const desktop = useDesktop();
  const [metric, setMetric] = useState<Metric>("hours");
  const items: StatItem<Metric>[] = [
    { id: "hours", label: "Time listened", value: fmtHoursValue(totals.hours), unit: totals.hours === 1 ? "hour" : "hours" },
    { id: "plays", label: "Plays", value: fmtInt(totals.plays) },
    { id: "listens", label: "Listens", value: fmtInt(totals.listens) },
  ];
  const unit = period === "day" ? "per day" : period === "week" ? "per week" : "per month";
  const rows = fillPeriods(timeline, period, range, today, (p) => ({ period: p, hours: 0, plays: 0, listens: 0 })).map((p) => ({
    period: p.period,
    title: periodTitle(p.period, period),
    value: p[metric],
  }));
  return (
    <StatStrip items={items} value={metric} onChange={setMetric} label="Listening figures">
      {rows.length === 0 ? (
        <EmptyState size="inline" title="Nothing played in this range" />
      ) : (
        <DitherArea
          label={`${METRIC_LABEL[metric]} ${unit}`}
          rows={rows}
          xKey="period"
          tipLabel="title"
          valueKey="value"
          valueLabel={METRIC_LABEL[metric]}
          xFormat={(p) => periodTick(p, period)}
          format={metric === "hours" ? fmtHours : fmtInt}
          height={desktop ? 200 : 160}
        />
      )}
    </StatStrip>
  );
}

const DIMENSIONS: ContextDimension[] = ["hourBucket", "dayType", "startMode", "shuffle", "device"];

/** The context with the lowest and highest skip rate, from values with enough plays to mean something. */
export function bestAndWorst(profile: SkipProfile, minPlays: number) {
  const all = DIMENSIONS.flatMap((d) => profile[d].filter((v) => v.plays >= minPlays && v.skipRate !== null).map((v) => ({ d, value: v.value, rate: v.skipRate! })));
  if (all.length < 2) return null;
  const sorted = [...all].sort((a, b) => a.rate - b.rate);
  const best = sorted[0]!;
  const worst = sorted[sorted.length - 1]!;
  return worst.rate - best.rate < 0.1 ? null : { best, worst };
}

/** Skips as context: where it plays through and where it gets skipped. Never a verdict on the music. */
export function SkipContext({ totals, profile, minPlays = 5, lead }: { totals: Stats; profile: SkipProfile; minPlays?: number; lead?: ReactNode }) {
  if (totals.skipRate === null) return null;
  const bw = bestAndWorst(profile, minPlays);
  return (
    <Section title="Skips in context" labelledBy="skips-title">
      <div className="flex max-w-2xl flex-col gap-1">
        {lead}
        <p className="text-body text-pretty">
          Skipped in {fmtPct(totals.skipRate)} of plays
          {totals.quickSkips > 0 && <>, {fmtInt(totals.quickSkips)} of them within 5 seconds</>}.
          {bw && (
            <>
              {" "}
              Plays through most {contextPhrase(bw.best.d, bw.best.value)} ({fmtPct(bw.best.rate)} skipped), skipped most {contextPhrase(bw.worst.d, bw.worst.value)} (
              {fmtPct(bw.worst.rate)}).
            </>
          )}
        </p>
      </div>
      <SkipProfileChart profile={profile} overall={totals.skipRate} minPlays={minPlays} />
    </Section>
  );
}

/** Ranked songs with a show-all toggle past `initial` rows. */
export function SongList({ songs, label, subtitle, initial = 10 }: { songs: Song[]; label: string; subtitle: (s: Song) => string | undefined; initial?: number }) {
  const [all, setAll] = useState(false);
  const top = songs[0]?.hours || 1;
  const shown = all ? songs : songs.slice(0, initial);
  return (
    <div className="flex flex-col gap-2">
      <RowList label={label}>
        {shown.map((s, i) => (
          <Row
            key={s.songKey}
            to={songPath(s.songKey)}
            rank={i + 1}
            title={s.name}
            subtitle={subtitle(s)}
            art={{ src: s.albumArtUrl }}
            value={fmtHours(s.hours)}
            share={s.hours / top}
            song={{ uri: s.uri, name: s.name, songKey: s.songKey, artist: s.artist }}
          />
        ))}
      </RowList>
      {songs.length > initial && (
        <Button variant="ghost" size="sm" className="-ml-2.5 self-start" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${fmtInt(songs.length)}`}
        </Button>
      )}
    </div>
  );
}

export function EntityLoading({ round = false }: { round?: boolean }) {
  return (
    <>
      <EntityHeaderSkeleton round={round} />
      <div aria-busy className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2 md:flex md:gap-10">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2 pb-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
        <Skeleton className="h-[160px] w-full md:h-[200px]" />
      </div>
      <RowSkeleton rows={8} rank />
    </>
  );
}

/**
 * A failed entity load. A 404 means no plays in this range: offer all time, or, if already all time,
 * say encore has none. Anything else is an error with retry.
 */
export function EntityMissing({ error, onRetry, title, what }: { error: unknown; onRetry: () => void; title: string; what: "artist" | "album" | "song" }) {
  const { range, setRange } = useRange();
  const lifetime = useLifetime();
  if (!(error instanceof ApiError && error.status === 404)) return <ErrorState size="page" error={error} onRetry={onRetry} title={`Could not load this ${what}`} />;
  if (lifetime.data?.plays === 0)
    return (
      <EmptyState
        size="page"
        title="No listening yet"
        description="Import your Spotify history or connect Spotify, and every artist, album and song gets a page."
        action={
          <AppLink to="/setup" className={buttonClass({ variant: "primary" })}>
            Set up encore
          </AppLink>
        }
      />
    );
  const allTime = !range.from && !range.to;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <h1 className="font-serif text-title text-balance break-words text-primary">{title}</h1>
        {!allTime && <RangePicker />}
      </div>
      <EmptyState
        size="page"
        title={allTime ? `No plays of this ${what}` : `No plays of this ${what} in this range`}
        description={allTime ? "encore has no music plays under this name." : undefined}
        action={
          allTime ? (
            <AppLink to="/music/artists" className={buttonClass()}>
              Open Music
            </AppLink>
          ) : (
            <Button onClick={() => setRange({})}>Show all time</Button>
          )
        }
      />
    </div>
  );
}
