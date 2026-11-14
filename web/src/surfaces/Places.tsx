import { useState, type ReactNode } from "react";
import { useDevices, useTrips } from "../api/queries";
import type { Devices, Trip } from "../api/types";
import { songPath } from "../app/paths";
import { RateMeter } from "../charts/RateMeter";
import { countryName, DEVICE_LABELS, fmtCompact, fmtDayRange, fmtHours, fmtInt, fmtPct } from "../lib/format";
import { useRange, type Range } from "../lib/range";
import { cx } from "../ui/cx";
import { Icon } from "../ui/Icon";
import { CaretDownIcon, GlobeHemisphereWestIcon } from "../ui/icons";
import { Section } from "../ui/Page";
import { RangePicker } from "../ui/RangePicker";
import { Row, RowList, RowSkeleton } from "../ui/Rows";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState, ErrorState } from "../ui/States";
import { PatternsFrame } from "./PatternsFrame";

const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`;

function places(trip: Trip, home: string | null): string {
  const away = trip.countries.filter((c) => c.country !== home);
  const names = (away.length > 0 ? away : trip.countries).map((c) => countryName(c.country));
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function TripDetail({ trip }: { trip: Trip }) {
  return (
    <div className="flex flex-col gap-6 pt-2 pb-6">
      {trip.countries.length > 1 && (
        <div className="flex max-w-md min-w-0 flex-col gap-1">
          <h3 className="font-medium text-secondary">Countries</h3>
          <ul className="flex flex-col">
            {trip.countries.map((c) => (
              <li key={c.country} className="grid h-(--row-h-compact) grid-cols-[minmax(0,1fr)_minmax(0,5rem)_5.5rem] items-center gap-3">
                <span className="truncate">{countryName(c.country)}</span>
                <RateMeter rate={c.plays / trip.plays} />
                <span className="text-right text-secondary tabular">{fmtCompact(c.plays)} {c.plays === 1 ? "play" : "plays"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {trip.topTracks.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-baseline justify-between text-secondary">
            <h3 className="font-medium">Most played</h3>
            <span className="text-caption">Plays</span>
          </div>
          <RowList label={`Most played on the trip to ${trip.countries.map((c) => countryName(c.country)).join(", ")}`}>
            {[...trip.topTracks].sort((a, b) => b.plays - a.plays).map((s) => (
              <Row
                key={s.songKey}
                to={songPath(s.songKey)}
                title={s.name}
                subtitle={s.artist}
                art={{ src: s.albumArtUrl }}
                value={fmtCompact(s.plays)}
                song={{ uri: s.uri, name: s.name, songKey: s.songKey, artist: s.artist }}
              />
            ))}
          </RowList>
        </div>
      )}
    </div>
  );
}

function TripRow({ trip, home, open, first, onToggle }: { trip: Trip; home: string | null; open: boolean; first: boolean; onToggle: () => void }) {
  const id = `trip-${trip.start}`;
  return (
    <li className={cx(!first && "hairline-t")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="-mx-2 flex min-h-(--row-h) w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-fill"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium text-primary">{places(trip, home)}</span>
          <span className="truncate text-caption text-secondary tabular">{fmtDayRange(trip.startDay, trip.endDay)}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end text-right tabular">
          <span>{plural(trip.days, "day", "days")}</span>
          <span className="text-caption text-secondary">{plural(trip.plays, "play", "plays")}</span>
        </span>
        <Icon icon={CaretDownIcon} size="sm" className={cx("shrink-0 text-tertiary transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {open && (
        <div id={id}>
          <TripDetail trip={trip} />
        </div>
      )}
    </li>
  );
}

function Trips({ range }: { range: Range }) {
  const q = useTrips(range);
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <div aria-busy className="flex flex-col gap-4">
        <Skeleton className="h-5 w-full max-w-sm" />
        <RowSkeleton rows={6} />
      </div>
    );
  const { trips, homeCountry } = q.data;
  const home = homeCountry ? countryName(homeCountry) : "your home country";
  if (trips.length === 0)
    return (
      <EmptyState
        size="section"
        icon={GlobeHemisphereWestIcon}
        title="No trips in this range"
        description={`A trip is 5 or more plays in a row from outside ${home}. Plays logged from the Spotify API carry no country, so recent travel shows after the next export.`}
        action={<RangePicker />}
      />
    );
  const longest = trips.reduce((a, b) => (b.days > a.days ? b : a));
  const open = openId === undefined ? trips[0]!.start : openId;
  return (
    <div className={cx("flex flex-col gap-4 transition-opacity duration-200", q.isPlaceholderData && "opacity-60")}>
      <p className="text-body text-pretty">
        {plural(trips.length, "trip", "trips")} away from {home}. Longest: <span className="font-medium">{places(longest, homeCountry)}</span>, {plural(longest.days, "day", "days")}.
      </p>
      <ul aria-label="Trips, newest first" className="flex flex-col">
        {trips.map((t, i) => (
          <TripRow key={t.start} trip={t} home={homeCountry} first={i === 0} open={open === t.start} onToggle={() => setOpenId(open === t.start ? null : t.start)} />
        ))}
      </ul>
    </div>
  );
}

function DeviceList({ data }: { data: Devices }) {
  return (
    <ul aria-label="Listening hours by device" className="flex flex-col">
      {data.totals.map((d) => (
        <li key={d.device} className="grid h-(--row-h-compact) grid-cols-[minmax(0,1fr)_minmax(0,4rem)_3rem_4.5rem] items-center gap-3">
          <span className="truncate">{DEVICE_LABELS[d.device]}</span>
          <RateMeter rate={d.share ?? 0} />
          <span className="text-right tabular">{fmtPct(d.share)}</span>
          <span className="text-right text-secondary tabular">{fmtHours(d.hours)}</span>
        </li>
      ))}
    </ul>
  );
}

function DeviceSection({ q }: { q: ReturnType<typeof useDevices> }) {
  const top = q.data?.totals[0];
  return (
    <Section title="Devices" description={top && `Most listening on ${DEVICE_LABELS[top.device]}: ${fmtPct(top.share)} of hours.`}>
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div aria-busy className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-3 w-full" />
          ))}
        </div>
      ) : (
        <div className={cx("transition-opacity duration-200", q.isPlaceholderData && "opacity-60")}>
          <DeviceList data={q.data} />
        </div>
      )}
    </Section>
  );
}

/** Devices count every play, so an empty device list means the range itself is empty. */
function PlacesView({ range }: { range: Range }) {
  const devices = useDevices(range);
  if (devices.data?.totals.length === 0)
    return <EmptyState size="section" title="No plays in this range" description="Pick a wider range to see your trips and devices." action={<RangePicker />} />;
  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
      <Section title="Trips">
        <Trips range={range} />
      </Section>
      <DeviceSection q={devices} />
    </div>
  );
}

export function Places(): ReactNode {
  const { range } = useRange();
  return (
    <PatternsFrame icon={GlobeHemisphereWestIcon} firstUse="Once plays come in, this shows your trips abroad and the devices you listen on.">
      <PlacesView range={range} />
    </PatternsFrame>
  );
}
