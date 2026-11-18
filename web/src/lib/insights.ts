import type { Milestone, Moment, RecordSet } from "../api/types";
import { fmtDay, fmtDayShort, fmtHours, fmtInt, fmtMonthLong } from "./format";

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${fmtInt(n)}th`;
  return `${fmtInt(n)}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export function fmtMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`;

/** A milestone as a row: what passed it, the threshold as its figure, and the line under the title. */
export function milestoneText(m: Milestone): { title: string; figure: string; detail: string } {
  if (m.kind === "song") return { title: m.song.name, figure: ordinal(m.threshold), detail: `${m.song.artist} · ${fmtDay(m.day)}` };
  if (m.kind === "artist") return { title: m.artist, figure: `${fmtInt(m.threshold)} h`, detail: fmtDay(m.day) };
  return { title: "All music", figure: `${fmtInt(m.threshold)} h`, detail: fmtDay(m.day) };
}

function recordText(r: RecordSet): string {
  switch (r.record) {
    case "day":
      return `Your biggest day yet: ${fmtHours(r.hours)} on ${fmtDayShort(r.day)}`;
    case "session":
      return `Your longest session yet: ${fmtMinutes(r.minutes)} on ${fmtDayShort(r.day)}`;
    case "songDay":
      return `${r.song.name} ${fmtInt(r.listens)} times in one day, more than any song before`;
    case "week":
      return `Your biggest week yet: ${fmtHours(r.hours)}`;
    case "month":
      return `Your biggest month yet: ${fmtHours(r.hours)} in ${fmtMonthLong(r.month)}`;
  }
}

/** One of Home's moments this week, as a short phrase. */
export function momentText(m: Moment): string {
  switch (m.kind) {
    case "record":
      return recordText(m);
    case "milestone": {
      const x = m.milestone;
      if (x.kind === "song") return `${ordinal(x.threshold)} listen of ${x.song.name} by ${x.song.artist}`;
      if (x.kind === "artist") return `${fmtInt(x.threshold)} hours of ${x.artist}`;
      return `${fmtInt(x.threshold)} hours of music in all`;
    }
    case "newArtists":
      return m.count === 1 && m.artists[0] ? `${m.artists[0].artist}, new to you` : `${fmtInt(m.count)} new artists`;
    case "streak":
      return `${fmtInt(m.days)} days in a row with music`;
    case "comeback":
      return `${m.comeback.artist} back after ${fmtInt(m.comeback.gapMonths)} months`;
  }
}
