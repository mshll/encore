import { useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { useLifetime, useTimezone } from "../../api/queries";
import type { SkipProfile, Song, Stats, TimePoint } from "../../api/types";
import { songPath } from "../../app/paths";
import { DitherArea } from "../../charts/Dither";
import { ContextRates, contextRates, type ContextRate } from "../../charts/ContextRates";
import { periodTick, periodTitle } from "../../charts/ticks";
import { todayIn } from "../../lib/dates";
import { contextPhrase, fmtAgo, fmtDate, fmtHours, fmtHoursValue, fmtInt, fmtPct } from "../../lib/format";
import { periodFor, useRange, type Range } from "../../lib/range";
import { fillPeriods } from "../../lib/series";
import { useDesktop } from "../../lib/useMedia";
import { AppLink } from "../../ui/AppLink";
import { Button, buttonClass } from "../../ui/Button";
import { EntityHeaderSkeleton } from "../../ui/EntityHeader";
import { PageHeader, Section } from "../../ui/Page";
import { RangePicker } from "../../ui/RangePicker";
import { Row, RowList, RowSkeleton } from "../../ui/Rows";
import { ChartSkeleton, Skeleton } from "../../ui/Skeleton";
import { StatStrip, type StatItem } from "../../ui/Stat";
import { EmptyState, ErrorState, FirstUseState } from "../../ui/States";
import { VinylRecordIcon } from "../../ui/icons";

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
          table={{ format: metric === "hours" ? fmtHoursValue : fmtInt }}
          height={desktop ? 200 : 160}
        />
      )}
    </StatStrip>
  );
}

/** The context with the lowest and highest skip rate, from values with enough plays to mean something. */
function bestAndWorst(rates: ContextRate[]) {
  if (rates.length < 2) return null;
  const sorted = [...rates].sort((a, b) => a.skipRate - b.skipRate);
  const best = sorted[0]!;
  const worst = sorted[sorted.length - 1]!;
  return worst.skipRate - best.skipRate < 0.1 ? null : { best, worst };
}

/** Skips as context: where it plays through and where it gets skipped. Never a verdict on the music. */
export function SkipContext({ totals, profile, minPlays = 5, lead }: { totals: Stats; profile: SkipProfile; minPlays?: number; lead?: ReactNode }) {
  if (totals.skipRate === null) return null;
  const rates = contextRates(profile, minPlays);
  const bw = bestAndWorst(rates);
  return (
    <Section title="Skips in context" labelledBy="skips-title">
      <div className="flex max-w-2xl flex-col gap-1">
        {lead}
        <p className="text-body text-pretty">
          Skipped in {fmtPct(totals.skipRate)} of plays
          {totals.earlySkips > 0 && <>, {fmtInt(totals.earlySkips)} of them in the first 30 seconds</>}.
          {bw && (
            <>
              {" "}
              Plays through most {contextPhrase(bw.best.dimension, bw.best.value)} ({fmtPct(bw.best.skipRate)} skipped), skipped most{" "}
              {contextPhrase(bw.worst.dimension, bw.worst.value)} ({fmtPct(bw.worst.skipRate)}).
            </>
          )}
        </p>
      </div>
      {rates.length > 0 && <ContextRates rates={rates} overall={totals.skipRate} />}
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
            art={{ src: s.albumArtUrl, kind: "song" }}
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
        <ChartSkeleton className="h-[160px] md:h-[200px]" />
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
      <div className="flex flex-col gap-6">
        <PageHeader title={title} />
        <FirstUseState icon={VinylRecordIcon} description="Import your Spotify history or connect Spotify, and every artist, album and song gets a page." />
      </div>
    );
  const allTime = !range.from && !range.to;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} actions={!allTime && <RangePicker />} />
      <EmptyState
        size="page"
        title={allTime ? `No plays of this ${what}` : `No plays of this ${what} in this range`}
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
