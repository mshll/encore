import { ApiError } from "../api/client";
import type { StreamEvent } from "../api/stream";
import type { MomentClass, SavedPlaylist } from "../api/types";
import { playbackProblem } from "../player/playback";
import { CLASS_LABELS } from "./format";

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
      return `This month’s AI budget is spent${amounts}. It resets on ${typeof d.month === "string" ? resetDay(d.month) : "the 1st"}.`;
    }
    case "llm_not_configured":
      return "AI is not set up. Set it up in Settings › AI.";
    case "llm_price_required":
      return "This model has no price. Set one in Settings › AI.";
    case "llm_refused":
      return "This request was declined. Try wording it differently.";
    case "llm_incomplete":
      return "It stopped before finishing. Try again.";
    case "llm_failed":
      return "The AI provider did not answer. Try again in a minute.";
    case "set_empty":
      return "This set has no songs yet.";
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
        Array.isArray(i.classes) && i.classes.length > 0 && `${(i.classes as string[]).map((c) => (CLASS_LABELS[c as MomentClass] ?? c.replace("_", " ")).toLowerCase()).join(" or ")} songs`,
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
    case "library_overview":
      return "Reading your library";
    case "find_library_songs": {
      const where = typeof i.where === "string" ? (i.where === "liked" ? "your liked songs" : i.where) : "your library";
      const what = [list(i.artists), list(i.lastPlayed) && `last played ${list(i.lastPlayed)}`, typeof i.text === "string" ? `“${i.text}”` : null].filter(Boolean).join(", ");
      return `Looking through ${where}${what ? `: ${what}` : ""}`;
    }
    case "played_not_liked":
      return "Finding songs you play but never liked";
    case "submit_plan":
      return "Writing the plan";
    case "find_artists":
      return `Looking for ${typeof i.q === "string" ? `“${i.q}”` : "an artist"} in your history`;
    case "submit_rule":
      return "Checking what the rule would hold";
    case "suggest_songs":
      return "Lining up the songs";
    case "show":
      return "Drawing the numbers";
    case "artist_history":
    case "song_history":
      return `Reading your history${i.artist ? ` with ${String(i.artist)}` : ""}`;
    default:
      return "Reading your listening";
  }
}

/** What saving a set to Spotify did, for its toast. */
export function savedMessage(updated: boolean, cover: SavedPlaylist["cover"]["status"]): string {
  const base = updated ? "Playlist updated in Spotify" : "Saved to Spotify as a private playlist";
  if (cover === "failed") return `${base}, without its cover.`;
  if (cover === "missing_scope") return `${base}. Connect Spotify again in Settings to add its cover.`;
  return `${base}.`;
}
