import { useTrips } from "../api/queries";
import type { Trip } from "../api/types";
import { countryName, fmtDayRange, fmtHours, fmtInt } from "../lib/format";
import { useRange } from "../lib/range";
import { songPath } from "../ui/AppLink";
import { Page } from "../ui/Page";
import { StartSessionButton } from "../ui/SongMenu";
import { Row, RowList } from "../ui/rows";
import { Empty, ErrorState, SkeletonRows } from "../ui/states";

function places(trip: Trip) {
  const names = trip.countries.map((c) => countryName(c.country));
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function TripBlock({ trip }: { trip: Trip }) {
  return (
    <article className="grid gap-x-10 gap-y-3 border-t-[0.5px] border-border-strong pt-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="flex flex-col gap-1">
        <h2 className="text-heading-6 font-semibold text-pretty">{places(trip)}</h2>
        <p className="text-secondary tabular">{fmtDayRange(trip.startDay, trip.endDay)}</p>
        <p className="text-body-sm text-secondary tabular">
          {trip.days} {trip.days === 1 ? "day" : "days"}, {fmtInt(trip.plays)} plays, {fmtHours(trip.hours)}
        </p>
        <StartSessionButton uris={trip.topTracks.map((s) => s.uri)} className="mt-2 self-start" />
      </div>
      {trip.topTracks.length > 0 && (
        <RowList>
          {trip.topTracks.map((s) => (
            <Row
              key={s.songKey}
              to={songPath(s.songKey)}
              art={{ src: s.albumArtUrl }}
              song={{ uri: s.uri, name: s.name }}
              title={s.name}
              subtitle={s.artist}
              value={`${s.plays} ${s.plays === 1 ? "play" : "plays"}`}
            />
          ))}
        </RowList>
      )}
    </article>
  );
}

export default function Trips() {
  const { range } = useRange();
  const q = useTrips(range);
  return (
    <Page title="Trips" ranged>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <SkeletonRows rows={8} />
      ) : q.data.trips.length === 0 ? (
        <Empty title="No trips in this range">
          A trip is 5 or more plays in a row from outside {q.data.homeCountry ? countryName(q.data.homeCountry) : "your home country"}. Spotify’s export records the country; plays logged live from the
          API do not, so recent travel shows up after the next export.
        </Empty>
      ) : (
        <div className={`flex flex-col gap-10 ${q.isPlaceholderData ? "opacity-60" : ""}`}>
          <p className="text-body-lg text-secondary">
            <strong className="font-semibold text-primary tabular">{q.data.trips.length}</strong> {q.data.trips.length === 1 ? "trip" : "trips"} abroad, newest
            first.
          </p>
          {q.data.trips.map((t) => (
            <TripBlock key={t.start} trip={t} />
          ))}
        </div>
      )}
    </Page>
  );
}
