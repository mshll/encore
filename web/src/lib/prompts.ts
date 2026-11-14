import { useClock, useEras, useTrips } from "../api/queries";
import { countryName, fmtHour, fmtMonthLong, WEEKDAYS } from "./format";

const ALL_TIME = {};

const places = (codes: string[]) => {
  const names = codes.map(countryName);
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

const monthYear = (day: string) => fmtMonthLong(day.slice(0, 7));

/** Starting points built from the owner's own listening: their biggest eras, their busiest hour and their latest trip. */
export function useListeningHooks() {
  const eras = useEras(ALL_TIME, 6);
  const clock = useClock(ALL_TIME);
  const trips = useTrips(ALL_TIME);
  const artists = eras.data?.artists ?? [];
  // An era at least a year old reads as a memory; the current one does not.
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 7);
  const peak = artists.find((a) => a.peakMonth <= yearAgo) ?? artists[0];
  const twoMonthsAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const faded = [...artists].sort((a, b) => a.lastPlayed.localeCompare(b.lastPlayed)).find((a) => a.lastPlayed < twoMonthsAgo);
  const busiest = clock.data?.cells.reduce<(typeof clock.data.cells)[number] | null>((best, c) => (!best || c.hours > best.hours ? c : best), null);
  const trip = trips.data?.trips[0];
  return {
    ready: Boolean(eras.data && clock.data && trips.data),
    peak: peak ? { artist: peak.artist, month: fmtMonthLong(peak.peakMonth) } : null,
    faded: faded && faded !== peak ? { artist: faded.artist, since: monthYear(faded.lastPlayed.slice(0, 10)) } : null,
    busiest: busiest ? { day: WEEKDAYS[busiest.weekday - 1]!, hour: fmtHour(busiest.hour) } : null,
    trip: trip ? { places: places(trip.countries.map((c) => c.country)), when: monthYear(trip.startDay) } : null,
  };
}

export function useSetStarters(): string[] {
  const h = useListeningHooks();
  return [
    h.peak && `My ${h.peak.artist} era around ${h.peak.month}, but the songs I haven’t played since`,
    h.busiest && `${h.busiest.day} at ${h.busiest.hour}: what usually works then, plus a few songs I’ve never heard`,
    h.trip && `Back on the ${h.trip.places} trip in ${h.trip.when}, an hour of it`,
    h.faded && `Bring back ${h.faded.artist}, the songs I finished most`,
  ].filter((s): s is string => Boolean(s));
}

export function useAskStarters(): string[] {
  const h = useListeningHooks();
  return [
    h.faded && `Why did I stop playing ${h.faded.artist}?`,
    h.busiest && `What do I play on ${h.busiest.day}s at ${h.busiest.hour}?`,
    h.trip && `What did I listen to on the ${h.trip.places} trip?`,
    "Which songs do I skip only on weekends?",
  ].filter((s): s is string => Boolean(s));
}
