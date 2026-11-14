import { useState } from "react";
import { useArtistPage, useEras, useTimezone, useTopArtists, useTopTracks } from "../api/queries";
import type { Eras as ErasData } from "../api/types";
import { Legend } from "../charts/Legend";
import { SERIES_COLORS, StackedArea } from "../charts/StackedArea";
import { monthBounds } from "../lib/dates";
import { fmtDate, fmtHours, fmtMonth, fmtMonthLong } from "../lib/format";
import { useRange, type Range } from "../lib/range";
import { useDesktop } from "../lib/useMedia";
import { AppLink, artistPath, songPath } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Page, Section } from "../ui/Page";
import { Row, RowList } from "../ui/rows";
import { Empty, ErrorState, Skeleton, SkeletonRows } from "../ui/states";

const ARTISTS = 8;

function leadingQuiet(data: ErasData): number {
  const totals = data.months.map((_, j) => data.series.reduce((sum, s) => sum + (s.hours[j] ?? 0), 0));
  const peak = Math.max(0, ...totals);
  const first = totals.findIndex((t) => t >= peak * 0.05);
  return first > 12 ? first : 0;
}

function ArtistDetail({ era, month, range }: { era: ErasData["artists"][number]; month: string | null; range: Range }) {
  const timezone = useTimezone();
  const scope = month ? monthBounds(month) : range;
  const q = useArtistPage(era.artist, scope, "month");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Artwork src={era.imageUrl} name={era.artist} round size="md" className="w-16 md:w-20" />
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-body-lg font-semibold">
            <AppLink to={artistPath(era.artist)} className="underline-offset-4 hover-fine:underline">
              {era.artist}
            </AppLink>
            {month && <span className="font-normal text-secondary"> in {fmtMonthLong(month)}</span>}
          </h3>
          <p className="text-secondary">
            Peak in {fmtMonth(era.peakMonth)} with {fmtHours(era.peakMonthHours)}. First played {fmtDate(era.firstPlayed, timezone)}, last played{" "}
            {fmtDate(era.lastPlayed, timezone)}.
          </p>
        </div>
      </div>
      {q.isError ? (
        <Empty title={`No ${era.artist} in ${month ? fmtMonthLong(month) : "this range"}`} />
      ) : !q.data ? (
        <SkeletonRows rows={5} />
      ) : (
        <RowList>
          {q.data.tracks.slice(0, 8).map((s, i) => (
            <Row
              key={s.songKey}
              to={songPath(s.songKey)}
              rank={i + 1}
              art={{ src: s.albumArtUrl }}
              title={s.name}
              subtitle={s.album ?? undefined}
              value={fmtHours(s.hours)}
            />
          ))}
        </RowList>
      )}
    </div>
  );
}

function MonthDetail({ month }: { month: string }) {
  const range = monthBounds(month);
  const songs = useTopTracks(range, 8);
  const artists = useTopArtists(range, 5);
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-body-lg font-semibold">{fmtMonthLong(month)}</h3>
      <div className="grid gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <p className="text-body-sm font-medium text-secondary">Top songs</p>
          {!songs.data ? (
            <SkeletonRows rows={5} />
          ) : songs.data.items.length === 0 ? (
            <Empty title="Nothing played this month" />
          ) : (
            <RowList>
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
            <RowList>
              {artists.data.items.map((a, i) => (
                <Row key={a.artist} to={artistPath(a.artist)} rank={i + 1} art={{ src: a.imageUrl, round: true }} title={a.artist} value={fmtHours(a.hours)} />
              ))}
            </RowList>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Eras() {
  const { range } = useRange();
  const timezone = useTimezone();
  const q = useEras(range, ARTISTS);
  const desktop = useDesktop();
  const [artist, setArtist] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null);

  const data = q.data;
  const start = data ? leadingQuiet(data) : 0;
  const months = data?.months.slice(start) ?? [];
  const series = data?.series.map((s, i) => ({ id: s.artist, label: s.artist, values: s.hours.slice(start), color: SERIES_COLORS[i]! })) ?? [];
  const leftOut = data ? data.series.reduce((sum, s) => sum + s.hours.slice(0, start).reduce((a, b) => a + b, 0), 0) : 0;
  const era = data?.artists.find((a) => a.artist === artist);

  return (
    <Page title="Eras" ranged>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !data ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-60 w-full md:h-80" />
          <Skeleton className="h-8 w-full max-w-xl" />
        </div>
      ) : data.months.length === 0 ? (
        <Empty title="No plays in this range">Pick a wider range to see which artists defined each stretch.</Empty>
      ) : (
        <Section>
          <div className={`flex flex-col gap-3 ${q.isPlaceholderData ? "opacity-60" : ""}`}>
            <p className="text-body-sm text-secondary">Hours per month for your top {data.series.length} artists. Select a month or an artist for details.</p>
            <StackedArea
              months={months}
              series={series}
              height={desktop ? 340 : 240}
              format={fmtHours}
              label="Hours per month by artist"
              highlight={artist}
              selectedMonth={month}
              onSelectMonth={(m) => setMonth((cur) => (cur === m ? null : m))}
            />
            {start > 0 && (
              <p className="text-body-sm text-secondary">
                Before {fmtMonth(months[0]!)} these artists add up to {fmtHours(leftOut)}, too little to show.
              </p>
            )}
            <Legend items={series} active={artist} onToggle={(id) => setArtist((cur) => (cur === id ? null : id))} />
          </div>
        </Section>
      )}

      {data && (artist || month) && (
        <Section
          aside={
            <button
              type="button"
              className="btn btn-tertiary"
              onClick={() => {
                setArtist(null);
                setMonth(null);
              }}
            >
              Clear selection
            </button>
          }
        >
          {era ? <ArtistDetail era={era} month={month} range={range} /> : month && <MonthDetail month={month} />}
        </Section>
      )}

      {data && data.artists.length > 0 && (
        <Section title="Artists">
          <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <table className="w-full min-w-[560px] text-left tabular">
              <thead className="text-caption-lg text-secondary">
                <tr className="border-b-[0.5px] border-border-strong">
                  <th className="h-9 pr-3 font-medium">Artist</th>
                  <th className="h-9 px-3 text-right font-medium">Hours</th>
                  <th className="h-9 px-3 font-medium">Peak month</th>
                  <th className="h-9 px-3 font-medium">First played</th>
                  <th className="h-9 pl-3 font-medium">Last played</th>
                </tr>
              </thead>
              <tbody className="text-body-sm">
                {data.artists.map((a, i) => (
                  <tr key={a.artist} className="border-b-[0.5px] border-border-default last:border-0">
                    <td className="py-2.5 pr-3">
                      <span className="flex items-center gap-3">
                        <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: SERIES_COLORS[i] }} />
                        <Artwork src={a.imageUrl} name={a.artist} round className="size-8" />
                        <AppLink to={artistPath(a.artist)} className="font-medium hover-fine:underline">
                          {a.artist}
                        </AppLink>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">{fmtHours(a.hours)}</td>
                    <td className="px-3 py-2.5">
                      {fmtMonth(a.peakMonth)}, {fmtHours(a.peakMonthHours)}
                    </td>
                    <td className="px-3 py-2.5">{fmtDate(a.firstPlayed, timezone)}</td>
                    <td className="py-2.5 pl-3">{fmtDate(a.lastPlayed, timezone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </Page>
  );
}
