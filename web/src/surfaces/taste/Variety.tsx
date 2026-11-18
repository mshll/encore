import { useState } from "react";
import { useSeasonal, useVariety } from "../../api/queries";
import type { Seasonal, Variety } from "../../api/types";
import { artistPath, songPath } from "../../app/paths";
import { DitherArea } from "../../charts/Dither";
import { periodTick, periodTitle } from "../../charts/ticks";
import { weekSequence } from "../../lib/dates";
import { fmtDay, fmtHours, fmtInt, fmtPct } from "../../lib/format";
import { leadInEnd } from "../../lib/leadIn";
import type { Range } from "../../lib/range";
import { useDesktop } from "../../lib/useMedia";
import { cx } from "../../ui/cx";
import { SIDE_COLUMNS, Section, dimWhile } from "../../ui/Page";
import { Row, RowList, RowSkeleton } from "../../ui/Rows";
import { ChartSkeleton } from "../../ui/Skeleton";
import { StatStrip, type StatItem } from "../../ui/Stat";
import { EmptyState, ErrorState } from "../../ui/States";

type Metric = "artists" | "topShare";

const monthName = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" });
const seasonText = (seasons: { month: number; years: number[] }[]) =>
  seasons.map((s) => `${monthName.format(new Date(Date.UTC(2000, s.month - 1, 1)))} ${s.years.join(", ")}`).join("; ");

function weeklyRows(weeks: Variety["weeks"], metric: Metric) {
  const byWeek = new Map(weeks.map((w) => [w.week, w]));
  const all = weekSequence(weeks[0]!.week, weeks.at(-1)!.week);
  const start = leadInEnd(all.map((w) => byWeek.get(w)?.hours ?? 0));
  const value = (w: Variety["weeks"][number] | undefined) => (!w ? 0 : metric === "artists" ? w.artists : Math.round((w.topShare ?? 0) * 1000) / 10);
  return { rows: all.slice(start).map((week) => ({ week, title: periodTitle(week, "week"), value: value(byWeek.get(week)) })), cutFrom: start > 0 ? all[start]! : null };
}

function VarietyBody({ data }: { data: Variety }) {
  const desktop = useDesktop();
  const [metric, setMetric] = useState<Metric>("artists");
  const figures: StatItem<Metric>[] = [
    { id: "artists", label: "Artists a week", value: data.averageArtists === null ? "n/a" : fmtInt(Math.round(data.averageArtists)) },
    { id: "topShare", label: `On a week's top ${data.topArtists}`, value: fmtPct(data.averageTopShare) },
  ];
  const t = weeklyRows(data.weeks, metric);
  const label = metric === "artists" ? "Artists with a listen each week" : `Share of each week's hours on its top ${data.topArtists} artists`;
  return (
    <StatStrip items={figures} value={metric} onChange={setMetric} label="Variety figures">
      <div className="flex flex-col gap-3 pt-5">
        <DitherArea
          label={label}
          rows={t.rows}
          xKey="week"
          tipLabel="title"
          valueKey="value"
          valueLabel={metric === "artists" ? "Artists" : "Top artists"}
          xFormat={(p) => periodTick(p.slice(0, 7), "month")}
          format={metric === "artists" ? (v) => fmtInt(Math.round(v)) : (v) => `${Math.round(v)}%`}
          table={metric === "topShare" ? { format: (v) => String(Math.round(v)), unit: "%" } : undefined}
          height={desktop ? 180 : 140}
        />
        {t.cutFrom && <p className="text-caption text-secondary">Starts the week of {fmtDay(t.cutFrom)}; the quiet weeks before it are left out.</p>}
      </div>
    </StatStrip>
  );
}

function VarietySection({ range }: { range: Range }) {
  const q = useVariety(range);
  return (
    <Section title="Variety" labelledBy="taste-variety">
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <ChartSkeleton className="h-[260px]" />
      ) : (
        <div className={dimWhile(q.isPlaceholderData)}>
          <VarietyBody data={q.data} />
        </div>
      )}
    </Section>
  );
}

function SeasonalLists({ data }: { data: Seasonal }) {
  return (
    <div className={cx(SIDE_COLUMNS)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="font-medium text-secondary">Songs</h3>
        {data.songs.length === 0 ? (
          <EmptyState size="inline" title="No song comes back in the same month" />
        ) : (
          <RowList label="Seasonal songs">
            {data.songs.map((s) => (
              <Row
                key={s.songKey}
                to={songPath(s.songKey)}
                title={s.name}
                subtitle={`${s.artist} · ${seasonText(s.seasons)}`}
                art={{ src: s.albumArtUrl, kind: "song" }}
                value={fmtInt(s.listens)}
                song={{ uri: s.uri, name: s.name, songKey: s.songKey, artist: s.artist }}
              />
            ))}
          </RowList>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="font-medium text-secondary">Artists</h3>
        {data.artists.length === 0 ? (
          <EmptyState size="inline" title="No artist comes back in the same month" />
        ) : (
          <RowList label="Seasonal artists">
            {data.artists.map((a) => (
              <Row key={a.artist} to={artistPath(a.artist)} title={a.artist} subtitle={seasonText(a.seasons)} art={{ src: a.imageUrl, kind: "artist" }} value={fmtHours(a.hours)} />
            ))}
          </RowList>
        )}
      </div>
    </div>
  );
}

function SeasonalSection({ range }: { range: Range }) {
  const q = useSeasonal(range);
  return (
    <Section title="Seasonal favourites" description={q.data && `Played most in the same month in ${q.data.rules.minYears} years or more; songs by listens and artists by hours in those months`} labelledBy="taste-seasonal">
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <RowSkeleton rows={4} />
      ) : q.data.songs.length + q.data.artists.length === 0 ? (
        <EmptyState size="inline" title="No seasonal favourites in this range" description="A season shows once a month stands out in two years of listening." />
      ) : (
        <div className={dimWhile(q.isPlaceholderData)}>
          <SeasonalLists data={q.data} />
        </div>
      )}
    </Section>
  );
}

/** Variety and seasonal favourites; both stand down when the range has no plays, where the page already says so. */
export function VarietyAndSeasons({ range }: { range: Range }) {
  const q = useVariety(range);
  if (q.data && q.data.weeks.length === 0) return null;
  return (
    <>
      <VarietySection range={range} />
      <SeasonalSection range={range} />
    </>
  );
}
