import type { CardInput } from "../covers/card";
import { fmtHoursPhrase, type RecapPage } from "./page";

const count = (n: number) => new Intl.NumberFormat("en-GB").format(n);
const hoursShort = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : h < 10 ? `${Math.round(h * 10) / 10} h` : `${count(Math.round(h))} h`);

/** What a recap's share card shows: the period, the headline, hours, the change against the period before, and songs. */
export function recapCardInput(page: Pick<RecapPage, "label" | "headline" | "inProgress" | "compare" | "sections">): Omit<CardInput, "fetchFn"> & { fallbackHeadline: string } {
  const listening = page.sections.find((s) => s.id === "listening");
  const figures: CardInput["figures"] = [];
  if (listening) {
    figures.push({ value: hoursShort(listening.hours), label: "of music" });
    if (page.compare && listening.before !== null && listening.before > 0) {
      const pct = Math.round(((listening.hours - listening.before) / listening.before) * 100);
      figures.push(pct === 0 ? { value: "Same", label: `as ${page.compare.label}` } : { value: `${Math.abs(pct)}% ${pct > 0 ? "more" : "less"}`, label: `than ${page.compare.label}` });
    }
    figures.push({ value: count(listening.songs), label: listening.songs === 1 ? "song" : "songs" });
  }
  const artists = page.sections.find((s) => s.id === "artists");
  const songs = page.sections.find((s) => s.id === "songs");
  const art = [...(songs?.songs.map((s) => s.albumArtUrl) ?? []), ...(artists?.top.map((a) => a.imageUrl) ?? [])].filter((u): u is string => !!u);
  return {
    label: page.inProgress ? `${page.label} so far` : page.label,
    headline: page.headline,
    fallbackHeadline: listening ? `${fmtHoursPhrase(listening.hours)} of music` : page.label,
    figures,
    art: [...new Set(art)],
  };
}
