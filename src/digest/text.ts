import { fmtHoursPhrase, type RecapPage } from "./page";
import { humanLongDay } from "./periods";

const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const hrs = (h: number) => (h < 10 ? `${Math.round(h * 10) / 10} h` : `${Math.round(h)} h`);

function change(now: number, before: number | null): string {
  if (before === null || before <= 0) return "";
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? ", about the same as" : `, ${Math.abs(pct)}% ${pct > 0 ? "more" : "less"} than`;
}

/** The recap as plain lines for a chat message: the headline, then each section's take and its main figures, dates written out. */
export function recapText(page: RecapPage): string {
  const out: string[] = [page.headline];
  const line = (take: string | null, figures: string) => out.push(take ? `${take} ${figures}` : figures);
  for (const s of page.sections) {
    if (s.id === "listening") {
      const vs = page.compare ? change(s.hours, s.before) : "";
      line(s.take, `${fmtHoursPhrase(s.hours)} of music${vs ? `${vs} ${page.compare!.label} (${fmtHoursPhrase(s.before!)})` : ""}, across ${s.artists} ${s.artists === 1 ? "artist" : "artists"}.`);
    } else if (s.id === "artists") line(s.take, `Most played: ${list(s.top.slice(0, 3).map((a) => `${a.artist} (${hrs(a.hours)})`))}.`);
    else if (s.id === "songs") line(s.take, `Top songs: ${list(s.songs.slice(0, 3).map((t) => `${t.name} by ${t.artist}`))}.`);
    else if (s.id === "finds" && s.songs.count) line(s.take, `${s.songs.count} new ${s.songs.count === 1 ? "song" : "songs"} stuck, led by ${s.songs.top[0]!.name}.`);
    else if (s.id === "rhythm") line(s.take, `Busiest day: ${humanLongDay(s.day.day)}, ${hrs(s.day.hours)}.`);
    else if (s.take) out.push(s.take);
  }
  if (page.note) out.push(page.note);
  return out.join("\n");
}
