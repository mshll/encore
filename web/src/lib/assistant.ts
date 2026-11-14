import { ApiError } from "../api/client";
import type { StreamEvent } from "../api/stream";
import { playbackProblem } from "../player/playback";

const usd = (n: unknown) => (typeof n === "number" ? `$${n.toFixed(2)}` : null);

/** The first day of the month after `month` (YYYY-MM), as "1 December". */
export function resetDay(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = new Date(Date.UTC(m === 12 ? y + 1 : y, m % 12, 1));
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(next);
}

export function assistantProblem(error: unknown): string {
  if (!(error instanceof ApiError)) return "Could not reach encore. Check that it is running, then try again.";
  const d = error.details ?? {};
  switch (error.code) {
    case "llm_budget_exceeded": {
      const spent = usd(d.spentUsd);
      const cap = usd(d.capUsd);
      const amounts = spent && cap ? ` (${spent} of ${cap})` : "";
      return `This month’s spending cap is reached${amounts}. It resets on ${typeof d.month === "string" ? resetDay(d.month) : "the 1st"}, or raise MONTHLY_BUDGET_USD.`;
    }
    case "llm_not_configured":
      return "No Anthropic API key is set. Add ANTHROPIC_API_KEY to the server, then try again.";
    case "llm_refused":
      return "This request was declined. Try wording it differently.";
    case "llm_incomplete":
      return "It stopped before finishing. Try again.";
    case "llm_failed":
      return "The Anthropic API did not answer. Try again in a minute.";
    case "set_empty":
      return "This set has no tracks yet.";
    case "picks_exist":
      return "This week already has picks.";
    case "spotify_failed":
      return "Spotify did not answer. Try again in a minute.";
    default:
      return playbackProblem(error);
  }
}

/** One line describing a tool call while a set, picks or an answer is being made. */
export function progressLine(event: Extract<StreamEvent, { type: "tool" }>): string {
  const i = event.input;
  const list = (v: unknown) => (Array.isArray(v) && v.length ? v.join(", ") : null);
  switch (event.name) {
    case "find_songs": {
      const when = [
        typeof i.hourBucket === "string" && `${i.hourBucket} plays`,
        typeof i.dayType === "string" && `${i.dayType}s`,
        typeof i.notPlayedForDays === "number" && `not played for ${i.notPlayedForDays} days`,
        typeof i.playedFrom === "string" && `played since ${i.playedFrom}`,
        typeof i.energyMin === "number" && `energy ${i.energyMin} and up`,
        Array.isArray(i.classes) && i.classes.length > 0 && `${(i.classes as string[]).map((c) => c.replace("_", " ")).join(" or ")} songs`,
      ];
      const what = [list(i.artists), list(i.genres), list(i.moods), typeof i.text === "string" ? `“${i.text}”` : null, ...when].filter(Boolean).join(", ");
      return what ? `Searching your history: ${what}` : "Searching your history";
    }
    case "artist_profile":
      return `Looking at how you play ${String(i.artist)}`;
    case "verify_new_song":
      return `Checking “${String(i.title)}” by ${String(i.artist)} on Spotify`;
    case "submit_set":
      return "Putting the set in order";
    case "submit_picks":
      return "Choosing this week’s picks";
    case "artist_history":
    case "song_history":
      return `Reading your history${i.artist ? ` with ${String(i.artist)}` : ""}`;
    default:
      return "Reading your listening";
  }
}
