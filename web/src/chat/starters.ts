import { useLibraryAnalysis } from "../api/queries";
import type { PageContext } from "../api/types";
import { contextLabel } from "../app/pageContext";
import { useAskStarters, useSetStarters } from "../lib/prompts";
import type { ChatMode } from "./state";

function useTidyStarters(): string[] {
  const a = useLibraryAnalysis().data;
  const stale = a?.playlists.filter((p) => p.songs >= 20).sort((x, y) => x.classes.active / x.songs - y.classes.active / y.songs)[0];
  return [
    "Archive liked songs I haven’t played in a year",
    stale && `Tidy ${stale.name}: keep what I still play`,
    a && a.unsaved.total > 0 && "Like the songs I keep playing but never liked",
  ].filter((s): s is string => Boolean(s));
}

const PATTERN_ASKS: Record<string, string> = {
  when: "When in the week do I listen most here?",
  eras: "Which artists defined these months?",
  taste: "How did my genres and moods shift here?",
  skips: "Which songs do I skip most here, and in what context?",
  places: "What did I play on these trips?",
};

function askAbout(c: PageContext): string[] {
  const name = contextLabel(c);
  switch (c.kind) {
    case "artist":
      return [`How has my ${name} listening changed this year?`, `Which ${name} songs do I skip, and when?`, `When did I start playing ${name}?`];
    case "album":
      return [`Which songs on ${name} do I play through?`, `When did I play ${name} most?`];
    case "song":
      return [`When do I play ${name} most?`, `Do I skip ${name}, and where?`];
    case "playlist":
      return [`How often do I play the songs in ${name}?`];
    case "recap":
      return [`What changed in ${name} against the period before?`, `Which artists led ${name}?`];
    case "patterns":
      return [PATTERN_ASKS[c.view]!];
    case "library":
      return c.planId ? [`Have I played the songs in ${name} lately?`] : ["How many of my liked songs have I not played in a year?"];
    case "set":
      return [`Which songs in ${name} have I played since?`];
  }
}

function setAbout(c: PageContext): string[] {
  const name = contextLabel(c);
  switch (c.kind) {
    case "artist":
      return [`An hour of ${name}: the songs I play through most`, `${name} and the artists I play around them, a few I’ve never heard`];
    case "album":
      return [`Built around ${name}, with a few songs I haven’t heard`];
    case "song":
      return [`Songs that sit next to ${name}, some known and some new`];
    case "playlist":
    case "recap":
      return [`The best of ${name}, an hour of it`];
    default:
      return [];
  }
}

function tidyAbout(c: PageContext): string[] {
  if (c.kind === "artist") return [`Archive the ${c.artist} songs I liked but no longer play`];
  if (c.kind === "library" && c.planId) return [`Keep anything I played this year in ${contextLabel(c)}`];
  return [];
}

/** Starting points for an empty conversation: about the page first, then from the owner's own listening. At most four. */
export function useStarters(mode: ChatMode, context: PageContext | null): string[] {
  const ask = useAskStarters();
  const set = useSetStarters();
  const tidy = useTidyStarters();
  const about = context ? (mode === "ask" ? askAbout(context) : mode === "set" ? setAbout(context) : tidyAbout(context)) : [];
  const general = mode === "ask" ? ask : mode === "set" ? set : tidy;
  return [...about, ...general].slice(0, 4);
}
