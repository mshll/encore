import { useLibraryAnalysis } from "../api/queries";
import type { ChatOutcomeKind, PageContext } from "../api/types";
import { contextLabel } from "../app/pageContext";
import { useAskStarters, useSetStarters } from "../lib/prompts";

/** A starting point and what sending it makes, so the owner knows before they tap. */
export type Starter = { text: string; makes: ChatOutcomeKind };

export const MAKES: Record<ChatOutcomeKind, string> = { answer: "An answer", set: "A set", plan: "A cleanup plan", rule: "A playlist rule", play: "Songs to play" };

const PATTERN_ASKS: Record<string, string> = {
  when: "When in the week do I listen most here?",
  eras: "Which artists defined these months?",
  taste: "How did my genres and moods shift here?",
  discovery: "Which new artists stuck with me here?",
  records: "What were my biggest listening days here?",
  skips: "Which songs do I skip most here, and in what context?",
  places: "What did I play on these trips?",
};

const answer = (text: string): Starter => ({ text, makes: "answer" });
const set = (text: string): Starter => ({ text, makes: "set" });

/** About the page the chat is opened over: its own questions first, then one thing to make from it. */
function about(c: PageContext): Starter[] {
  const name = contextLabel(c);
  switch (c.kind) {
    case "artist":
      return [
        answer(`How has my ${name} listening changed this year?`),
        set(`An hour of ${name}: the songs I play through most`),
        { text: `A playlist of the ${name} songs I played most this year`, makes: "rule" },
      ];
    case "album":
      return [answer(`Which songs on ${name} do I play through?`), set(`Built around ${name}, with a few songs I haven’t heard`)];
    case "song":
      return [answer(`When do I play ${name} most?`), set(`Songs that sit next to ${name}, some known and some new`)];
    case "playlist":
      return [answer(`How often do I play the songs in ${name}?`), set(`The best of ${name}, an hour of it`)];
    case "recap":
      return [answer(`What changed in ${name} against the period before?`), set(`The best of ${name}, an hour of it`)];
    case "patterns":
      return [answer(PATTERN_ASKS[c.view]!)];
    case "library":
      return c.planId
        ? [{ text: `Keep anything I played this year in ${name}`, makes: "plan" }, answer(`Have I played the songs in ${name} lately?`)]
        : [{ text: "Archive liked songs I haven’t played in a year", makes: "plan" }, answer("How many of my liked songs have I not played in a year?")];
    case "set":
      return [answer(`Which songs in ${name} have I played since?`)];
  }
}

function useTidyStarter(): Starter | null {
  const a = useLibraryAnalysis().data;
  const stale = a?.playlists.filter((p) => p.songs >= 20).sort((x, y) => x.classes.active / x.songs - y.classes.active / y.songs)[0];
  return stale ? { text: `Tidy ${stale.name}: keep what I still play`, makes: "plan" } : null;
}

/** Starting points for an empty conversation: about the page first, then one of each kind from the owner's own listening. At most four. */
export function useStarters(context: PageContext | null): Starter[] {
  const asks = useAskStarters();
  const sets = useSetStarters();
  const tidy = useTidyStarter();
  const general = [asks[0] && answer(asks[0]), sets[0] && set(sets[0]), { text: "Play the songs I had on repeat last month", makes: "play" } as Starter, tidy, asks[1] && answer(asks[1])].filter(
    (s): s is Starter => Boolean(s),
  );
  const seen = new Set<string>();
  return [...(context ? about(context) : []), ...general].filter((s) => !seen.has(s.text) && Boolean(seen.add(s.text))).slice(0, 4);
}
