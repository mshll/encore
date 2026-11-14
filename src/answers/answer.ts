import { BLOCK_KINDS, type Unit, type Visual } from "./visuals";

/** A run of prose; `unchecked` marks a number that matches nothing the tools returned in that run. */
export type Span = { text: string; unchecked?: true } | { visual: string };

export type AnswerBlock = { type: "text"; spans: Span[] } | { type: "visual"; id: string };

/** An answer as stored and drawn: prose with visuals in it, the visuals' values, and the closing "Based on" line. */
export type Answer = { version: 1; blocks: AnswerBlock[]; visuals: Record<string, Visual>; basis: string | null };

const MARKER = /\[\[(v\d+)\]\]/g;

/** Splits text into paragraphs of prose and visual markers. A block visual breaks its paragraph; unknown markers are dropped. */
export function parseAnswer(text: string, visuals: Record<string, Visual>): Answer {
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const basisAt = paragraphs.findLastIndex((p) => /^Based on\b/.test(p));
  const basis = basisAt > 0 ? paragraphs[basisAt]!.replace(/^Based on:?\s*/, "") : null;
  const body = basisAt > 0 ? paragraphs.filter((_, i) => i !== basisAt) : paragraphs;
  const blocks: AnswerBlock[] = [];
  const used = new Set<string>();
  for (const paragraph of body) {
    let spans: Span[] = [];
    const flush = () => {
      const trimmed = trimSpans(spans);
      if (trimmed.some((s) => "visual" in s || s.text.trim())) blocks.push({ type: "text", spans: trimmed });
      spans = [];
    };
    const onlyMarker = paragraph.replace(MARKER, "").trim() === "";
    for (const [i, part] of paragraph.split(MARKER).entries()) {
      if (i % 2 === 0) {
        if (part) spans.push({ text: part });
        continue;
      }
      const visual = visuals[part];
      if (!visual || used.has(part)) continue;
      used.add(part);
      if (BLOCK_KINDS.has(visual.kind) || (onlyMarker && visual.kind === "series")) {
        flush();
        blocks.push({ type: "visual", id: part });
      } else spans.push({ visual: part });
    }
    flush();
  }
  return { version: 1, blocks, visuals: Object.fromEntries([...used].map((id) => [id, visuals[id]!])), basis };
}

function trimSpans(spans: Span[]): Span[] {
  const out = spans.map((s) => ({ ...s }));
  const first = out[0];
  const last = out.at(-1);
  if (first && "text" in first) first.text = first.text.trimStart();
  if (last && "text" in last) last.text = last.text.trimEnd();
  return out.filter((s) => !("text" in s) || s.text);
}

const NUMBER = /(?<![\p{L}\p{Nd}.,:/-])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?![\p{L}\p{Nd}:/-]|[.,]\d)(\s*%|\s*min)?/gu;
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
const DAY_OF_MONTH = new RegExp(`^\\s*(${MONTHS})\\b|\\b(${MONTHS})\\s*$`);

/** Every number in a tool result, plus the length of every list (a count of rows is data too). */
export function numbersOf(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  else if (Array.isArray(value)) {
    out.push(value.length);
    for (const v of value) numbersOf(v, out);
  } else if (value && typeof value === "object") for (const v of Object.values(value)) numbersOf(v, out);
  return out;
}

function matches(written: number, decimals: number, unit: string, known: number[]): boolean {
  const half = 0.5 * 10 ** -decimals;
  const zeros = decimals === 0 && written >= 1000 ? /0*$/.exec(String(written))![0].length : 0;
  const tolerance = zeros >= 2 ? 0.5 * 10 ** zeros : half;
  const scales = unit === "%" ? [1, 100] : unit === "min" ? [1, 60] : [1];
  return known.some((k) => scales.some((s) => Math.abs(k * s - written) < tolerance + 1e-9));
}

/**
 * Marks each number in the prose that no tool result of the run holds (to the precision it is written, or as a
 * percentage of a share). Years, dates, times and days of the month are not checked.
 */
export function checkNumbers(answer: Answer, known: number[]): Answer {
  const check = (text: string): Span[] => {
    const spans: Span[] = [];
    let last = 0;
    for (const m of text.matchAll(NUMBER)) {
      const [whole, int, frac = "", unitRaw = ""] = m;
      const written = Number(int!.replace(/,/g, "") + frac);
      const before = text.slice(Math.max(0, m.index - 12), m.index);
      const after = text.slice(m.index + whole.length, m.index + whole.length + 12);
      const isYear = !frac && !unitRaw && /^(19|20)\d{2}$/.test(int!);
      const isDay = !frac && !unitRaw && written >= 1 && written <= 31 && (DAY_OF_MONTH.test(before) || DAY_OF_MONTH.test(after));
      if (isYear || isDay || matches(written, Math.max(0, frac.length - 1), unitRaw.trim(), known)) continue;
      const end = m.index + int!.length + frac.length;
      if (m.index > last) spans.push({ text: text.slice(last, m.index) });
      spans.push({ text: text.slice(m.index, end), unchecked: true });
      last = end;
    }
    if (last < text.length) spans.push({ text: text.slice(last) });
    return spans;
  };
  return {
    ...answer,
    blocks: answer.blocks.map((b) => (b.type === "text" ? { ...b, spans: b.spans.flatMap((s) => ("text" in s && !s.unchecked ? check(s.text) : [s])) } : b)),
  };
}

const plainNumber = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-GB") : (Math.round(n * 10) / 10).toLocaleString("en-GB"));

function plainValue(v: number, unit: Unit): string {
  if (unit.type === "hours") return `${plainNumber(v)} h`;
  if (unit.type === "percent") return `${Math.round(v * 100)}%`;
  return `${plainNumber(v)} ${v === 1 ? unit.noun.replace(/s$/, "") : unit.noun}`;
}

/** A block visual as lines of text, for a chat message. Inline visuals add nothing: the sentence carries their figures. */
function visualText(v: Visual): string[] {
  switch (v.kind) {
    case "ranked":
      return [v.title, ...v.rows.map((r, i) => `${i + 1}. ${r.item.name}${r.item.kind === "song" || r.item.kind === "album" ? ` by ${r.item.artist}` : ""}: ${plainValue(r.value, v.unit)}`)];
    case "compare":
      return [v.title, ...v.rows.map((r) => `${r.label}: ${plainValue(r.now, v.unit)} (${v.beforeLabel}: ${plainValue(r.before, v.unit)})`)];
    case "series": {
      const top = v.points.reduce((a, b) => (b.y > a.y ? b : a));
      return [`${v.title}: highest ${plainValue(top.y, v.unit)} at ${top.x}`];
    }
    default:
      return [];
  }
}

/** The answer as plain text for a chat message or an older client: prose, block visuals as lines, then "Based on:". */
export function answerText(answer: Answer): string {
  const out: string[] = [];
  for (const b of answer.blocks) {
    if (b.type === "visual") out.push(visualText(answer.visuals[b.id]!).join("\n"));
    else
      out.push(
        b.spans
          .map((s) => ("text" in s ? s.text : ""))
          .join("")
          .replace(/ {2,}/g, " ")
          .replace(/ ([,.;:])/g, "$1")
          .trim(),
      );
  }
  if (answer.basis) out.push(`Based on: ${answer.basis}`);
  return out.filter(Boolean).join("\n\n");
}
