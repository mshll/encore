import type { Answer } from "../answers/answer";
import { answerCardInput, publicVisual, type AnswerCardInput, type PublicVisual } from "../answers/card";
import type { CardInput } from "../covers/card";
import { recapCardInput } from "../digest/card";
import type { RecapPage, RecapSection } from "../digest/page";
import type { RecapKind } from "../digest/periods";

/**
 * What a public link shows, frozen when the link is made. Built field by field from the recap page, so nothing the
 * page does not list here can reach a stranger: no ids, no song keys, no model, no Claude spend, no settings, no
 * owner name, account, devices, countries or IP data. Changing or deleting plays later does not change it.
 */
export type RecapSnapshot = {
  version: 1;
  kind: "recap";
  recap: {
    kind: RecapKind;
    label: string;
    from: string;
    to: string;
    inProgress: boolean;
    headline: string;
    compare: { label: string } | null;
    note: string | null;
    quiet: boolean;
    sections: SnapshotSection[];
  };
  card: Omit<CardInput, "fetchFn"> & { fallbackHeadline: string };
};

type Song = { uri: string | null; name: string; artist: string; albumArtUrl: string | null; listens: number };
type Artist = { artist: string; imageUrl: string | null; hours: number; before: number | null };

export type SnapshotSection =
  | { id: "listening"; take: string | null; hours: number; before: number | null; listens: number; artists: number; songs: number; daily: number[] | null }
  | { id: "months"; take: string | null; months: { month: string; hours: number; artist: string | null; imageUrl: string | null }[] }
  | { id: "artists"; take: string | null; top: (Artist & { share: number })[]; up: Artist[]; down: Artist[] }
  | { id: "songs"; take: string | null; songs: Song[] }
  | { id: "taste"; take: string | null; genres: { value: string; share: number; before: number | null }[]; moods: { value: string; share: number; before: number | null }[] }
  | { id: "finds"; take: string | null; songs: { count: number; ofNew: number; top: Song[] }; artists: { count: number; ofNew: number; top: { artist: string; imageUrl: string | null }[] } }
  | { id: "rhythm"; take: string | null; day: { day: string; hours: number }; hour: { hour: number; hours: number } | null; byHour: number[] | null };

const song = (s: { uri: string | null; name: string; artist: string; albumArtUrl: string | null; listens: number }): Song => ({
  uri: s.uri,
  name: s.name,
  artist: s.artist,
  albumArtUrl: s.albumArtUrl,
  listens: s.listens,
});
const artist = (a: { artist: string; imageUrl: string | null; hours: number; before: number | null }): Artist => ({ artist: a.artist, imageUrl: a.imageUrl, hours: a.hours, before: a.before });
const share = (s: { value: string; share: number; before: number | null }) => ({ value: s.value, share: s.share, before: s.before });

function section(s: RecapSection): SnapshotSection {
  switch (s.id) {
    case "listening":
      return { id: s.id, take: s.take, hours: s.hours, before: s.before, listens: s.listens, artists: s.artists, songs: s.songs, daily: s.daily };
    case "months":
      return { id: s.id, take: s.take, months: s.months.map((m) => ({ month: m.month, hours: m.hours, artist: m.artist, imageUrl: m.imageUrl })) };
    case "artists":
      return { id: s.id, take: s.take, top: s.top.map((a) => ({ ...artist(a), share: a.share })), up: s.up.map(artist), down: s.down.map(artist) };
    case "songs":
      return { id: s.id, take: s.take, songs: s.songs.map(song) };
    case "taste":
      return { id: s.id, take: s.take, genres: s.genres.map(share), moods: s.moods.map(share) };
    case "finds":
      return {
        id: s.id,
        take: s.take,
        songs: { count: s.songs.count, ofNew: s.songs.ofNew, top: s.songs.top.map(song) },
        artists: { count: s.artists.count, ofNew: s.artists.ofNew, top: s.artists.top.map((a) => ({ artist: a.artist, imageUrl: a.imageUrl })) },
      };
    case "rhythm":
      return { id: s.id, take: s.take, day: { day: s.day.day, hours: s.day.hours }, hour: s.hour ? { hour: s.hour.hour, hours: s.hour.hours } : null, byHour: s.byHour };
  }
}

/** The recap as a stranger may see it. A recap from before recaps were pages keeps its sections but not its old text. */
export function recapSnapshot(page: RecapPage): RecapSnapshot {
  return {
    version: 1,
    kind: "recap",
    recap: {
      kind: page.kind,
      label: page.label,
      from: page.span.from,
      to: page.span.to,
      inProgress: page.inProgress,
      headline: page.headline,
      compare: page.compare ? { label: page.compare.label } : null,
      note: page.note,
      quiet: page.quiet,
      sections: page.sections.map(section),
    },
    card: recapCardInput(page),
  };
}

/**
 * An answer as a stranger may see it, frozen when the link is made: the question, the prose with its visuals, and
 * the "Based on" line. Built field by field like the recap, so the thread, the tool calls, the model, song keys and
 * every other answer in the thread stay out.
 */
export type AnswerSnapshot = {
  version: 1;
  kind: "answer";
  question: string;
  answer: { blocks: Answer["blocks"]; visuals: Record<string, PublicVisual>; basis: string | null };
  card: AnswerCardInput;
};

export type ShareSnapshot = RecapSnapshot | AnswerSnapshot;

const block = (b: Answer["blocks"][number]): Answer["blocks"][number] =>
  b.type === "visual"
    ? { type: "visual", id: b.id }
    : { type: "text", spans: b.spans.map((s) => ("visual" in s ? { visual: s.visual } : s.unchecked ? { text: s.text, unchecked: true as const } : { text: s.text })) };

export function answerSnapshot(question: string, answer: Answer): AnswerSnapshot {
  return {
    version: 1,
    kind: "answer",
    question,
    answer: {
      blocks: answer.blocks.map(block),
      visuals: Object.fromEntries(Object.entries(answer.visuals).map(([id, v]) => [id, publicVisual(v)])),
      basis: answer.basis,
    },
    card: answerCardInput(question, answer),
  };
}
