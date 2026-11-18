import type { Image, SKRSContext2D } from "@napi-rs/canvas";
import { CARD_LAYOUTS, css, drawable, drawFigures, drawText, font, lines, MARK_HEIGHT, MUTED, startCard, type CardFormat, type CardLayout, type Rect } from "../covers/card";
import { PAPER, type Rgb } from "../covers/field";
import { cleanTitle, isRtl, layoutTitle, type Measure } from "../covers/title";
import { plainValue, type Answer } from "./answer";
import type { Unit, Visual } from "./visuals";

/** A ranked row's subject as a stranger may see it: no song key. */
export type PublicItem =
  | { kind: "song"; name: string; artist: string; uri: string | null; art: string | null }
  | { kind: "artist"; name: string; art: string | null }
  | { kind: "album"; name: string; artist: string; art: string | null }
  | { kind: "label"; name: string };

export type PublicVisual = Exclude<Visual, { kind: "ranked" }> | { kind: "ranked"; title: string; unit: Unit; rows: { item: PublicItem; value: number }[] };

/** What an answer's card shows: the question, the answer's first sentence, and the one visual that leads it. */
export type AnswerCardInput = { question: string; lead: string; visual: PublicVisual | null; art: string[] };

function publicItem(item: Extract<Visual, { kind: "ranked" }>["rows"][number]["item"]): PublicItem {
  switch (item.kind) {
    case "song":
      return { kind: "song", name: item.name, artist: item.artist, uri: item.uri, art: item.art };
    case "artist":
      return { kind: "artist", name: item.name, art: item.art };
    case "album":
      return { kind: "album", name: item.name, artist: item.artist, art: item.art };
    case "label":
      return { kind: "label", name: item.name };
  }
}

/** A visual copied field by field, so nothing a stranger should not see can ride along. */
export function publicVisual(v: Visual): PublicVisual {
  switch (v.kind) {
    case "pair":
      return { kind: "pair", label: v.label, unit: v.unit, now: v.now, before: v.before };
    case "share":
      return { kind: "share", label: v.label, share: v.share, before: v.before };
    case "series":
      return { kind: "series", title: v.title, unit: v.unit, axis: v.axis, points: v.points.map((p) => ({ x: p.x, y: p.y })) };
    case "ranked":
      return { kind: "ranked", title: v.title, unit: v.unit, rows: v.rows.map((r) => ({ item: publicItem(r.item), value: r.value })) };
    case "compare":
      return { kind: "compare", title: v.title, unit: v.unit, nowLabel: v.nowLabel, beforeLabel: v.beforeLabel, rows: v.rows.map((r) => ({ label: r.label, now: r.now, before: r.before })) };
  }
}

const sentences = new Intl.Segmenter("en", { granularity: "sentence" });

/** The prose of a text block as one line: inline visuals left out (the sentence states their figures). */
export const proseOf = (spans: Answer["blocks"][number] & { type: "text" }): string =>
  spans.spans
    .map((s) => ("text" in s ? s.text : ""))
    .join("")
    .replace(/\s+/g, " ")
    .replace(/ ([,.;:])/g, "$1")
    .trim();

/** The answer's first sentence. */
export function answerLead(answer: Answer): string {
  const first = answer.blocks.find((b) => b.type === "text");
  if (!first) return "";
  const text = proseOf(first);
  return [...sentences.segment(text)][0]?.segment.trim() ?? text;
}

const PRIORITY: Record<Visual["kind"], number> = { ranked: 0, compare: 0, series: 1, pair: 2, share: 3 };

/** The visual that leads the card: the first block visual, else the first chart, pair or share in the prose. */
export function leadVisual(answer: Answer): Visual | null {
  const order = answer.blocks.flatMap((b) => (b.type === "visual" ? [{ id: b.id, block: true }] : b.spans.flatMap((s) => ("visual" in s ? [{ id: s.visual, block: false }] : []))));
  const found = order.flatMap(({ id, block }) => (answer.visuals[id] ? [{ v: answer.visuals[id]!, rank: block ? -1 : PRIORITY[answer.visuals[id]!.kind] }] : []));
  return found.sort((a, b) => a.rank - b.rank)[0]?.v ?? null;
}

const artOf = (v: PublicVisual | null): string[] =>
  v?.kind === "ranked" ? [...new Set(v.rows.flatMap((r) => ("art" in r.item && r.item.art ? [r.item.art] : [])))] : [];

export function answerCardInput(question: string, answer: Answer): AnswerCardInput {
  const lead = leadVisual(answer);
  const visual = lead ? publicVisual(lead) : null;
  return { question, lead: answerLead(answer), visual, art: artOf(visual) };
}

type Sizes = { question: number; leadMax: number; leadMin: number; row: number; text: number; small: number; value: number };
const SIZES: Record<CardFormat, Sizes> = {
  wide: { question: 26, leadMax: 44, leadMin: 28, row: 44, text: 24, small: 20, value: 48 },
  square: { question: 32, leadMax: 60, leadMin: 36, row: 64, text: 32, small: 26, value: 64 },
};

/** Square cards with a chart give the field less height so the chart has room. */
const CHART_LAYOUTS: Record<CardFormat, CardLayout> = {
  wide: CARD_LAYOUTS.wide,
  square: { width: 1080, height: 1080, field: { x: 0, y: 0, w: 1080, h: 240 }, text: { x: 72, y: 296, w: 936, h: 720 } },
};

const SURFACE: Rgb = [38, 38, 36];
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function widthOf(ctx: SKRSContext2D, text: string, px: number): number {
  ctx.font = font(px);
  return ctx.measureText(text).width;
}

/** The text cut to fit `maxWidth`, ending in an ellipsis when cut. */
export function fitLine(text: string, measure: Measure, px: number, maxWidth: number): string {
  if (measure(text, px) <= maxWidth) return text;
  const parts = [...graphemes.segment(text)].map((g) => g.segment);
  while (parts.length && measure(`${parts.join("").trimEnd()}…`, px) > maxWidth) parts.pop();
  const cut = parts.join("");
  const word = cut.lastIndexOf(" ");
  const kept = word > cut.length / 2 ? cut.slice(0, word) : cut;
  return kept.trim() ? `${kept.trimEnd().replace(/[,;:]$/, "")}…` : "";
}

/** Wrapped at `px` to at most `maxLines`, the last line cut with an ellipsis when there is more. */
export function clampLines(text: string, measure: Measure, px: number, maxWidth: number, maxLines: number): string[] {
  const all = layoutTitle(text, measure, { maxWidth, maxPx: px, minPx: px, maxLines }).lines;
  if (all.length <= maxLines) return all;
  return [...all.slice(0, maxLines - 1), clampLast(all.slice(maxLines - 1).join(" "), measure, px, maxWidth)];
}

const clampLast = (text: string, measure: Measure, px: number, maxWidth: number) => {
  const cut = fitLine(text, measure, px, maxWidth);
  return cut.endsWith("…") ? cut : fitLine(`${text}…`, measure, px, maxWidth);
};

const measureWith = (ctx: SKRSContext2D): Measure => (text, px) => widthOf(ctx, text, px);
const fit = (ctx: SKRSContext2D, text: string, px: number, maxWidth: number) => fitLine(text, measureWith(ctx), px, maxWidth);

/** Text the bundled fonts can draw, cleaned; anything else is left out rather than drawn as boxes. */
const safe = (text: string) => (drawable(text) ? cleanTitle(text) : "");

function drawArt(ctx: SKRSContext2D, image: Image | null, x: number, y: number, size: number, round: boolean) {
  ctx.save();
  ctx.beginPath();
  if (round) ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  else ctx.roundRect(x, y, size, size, 4);
  ctx.clip();
  if (image) ctx.drawImage(image, x, y, size, size);
  else {
    ctx.fillStyle = css(SURFACE);
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}

/** A title line over a visual; returns where the visual starts. */
function drawTitle(ctx: SKRSContext2D, title: string, r: Rect, s: Sizes): number {
  const text = safe(title);
  if (!text) return r.y;
  drawText(ctx, fit(ctx, text, s.small, r.w), r.x, r.y + s.small, s.small, MUTED, r.w);
  return r.y + s.small + 20;
}

function drawRanked(ctx: SKRSContext2D, v: Extract<PublicVisual, { kind: "ranked" }>, r: Rect, s: Sizes, art: Map<string, Image>) {
  const top = drawTitle(ctx, v.title, r, s);
  const count = Math.min(v.rows.length, Math.floor((r.y + r.h - top) / s.row));
  const rankW = Math.ceil(widthOf(ctx, String(count), s.small)) + 16;
  const artSize = s.row - 10;
  v.rows.slice(0, count).forEach(({ item, value }, i) => {
    const y = top + i * s.row;
    const base = y + s.row / 2 + s.text * 0.35;
    drawText(ctx, String(i + 1), r.x, base, s.small, MUTED, rankW - 16);
    let x = r.x + rankW;
    if (item.kind !== "label") {
      drawArt(ctx, item.art ? (art.get(item.art) ?? null) : null, x, y + 5, artSize, item.kind === "artist");
      x += artSize + 16;
    }
    const valueText = plainValue(value, v.unit);
    const valueW = widthOf(ctx, valueText, s.small);
    drawText(ctx, valueText, r.x + r.w - valueW, base, s.small, MUTED, valueW);
    const room = r.x + r.w - valueW - 24 - x;
    const name = fit(ctx, safe(item.name), s.text, room);
    const nameW = widthOf(ctx, name, s.text);
    if (name) drawText(ctx, name, x, base, s.text, PAPER, nameW);
    const by = item.kind === "song" || item.kind === "album" ? fit(ctx, safe(item.artist), s.small, room - nameW - 12) : "";
    if (by) drawText(ctx, by, x + nameW + 12, base, s.small, MUTED, widthOf(ctx, by, s.small));
  });
}

function drawCompare(ctx: SKRSContext2D, v: Extract<PublicVisual, { kind: "compare" }>, r: Rect, s: Sizes, accent: Rgb) {
  const top = drawTitle(ctx, v.title, r, s);
  const rowH = s.row + 16;
  const count = Math.min(v.rows.length, Math.floor((r.y + r.h - top) / rowH));
  const max = Math.max(...v.rows.flatMap((row) => [row.now, row.before]), 0) || 1;
  v.rows.slice(0, count).forEach((row, i) => {
    const y = top + i * rowH;
    const base = y + s.text;
    const before = safe(`${v.beforeLabel} ${plainValue(row.before, v.unit)}`);
    const now = plainValue(row.now, v.unit);
    const beforeW = widthOf(ctx, before, s.small);
    const nowW = widthOf(ctx, now, s.text);
    drawText(ctx, before, r.x + r.w - beforeW, base, s.small, MUTED, beforeW);
    drawText(ctx, now, r.x + r.w - beforeW - 16 - nowW, base, s.text, PAPER, nowW);
    const label = fit(ctx, safe(row.label), s.text, r.w - beforeW - nowW - 40);
    if (label) drawText(ctx, label, r.x, base, s.text, PAPER, widthOf(ctx, label, s.text));
    ctx.fillStyle = css(accent);
    ctx.fillRect(r.x, base + 12, Math.max(2, (row.now / max) * r.w), 8);
    ctx.fillStyle = css(MUTED);
    ctx.fillRect(r.x, base + 24, Math.max(2, (row.before / max) * r.w), 4);
  });
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function axisLabel(x: string, axis: Extract<Visual, { kind: "series" }>["axis"]): string {
  if (axis === "hour") return `${x.padStart(2, "0")}:00`;
  if (axis === "weekday") return WEEKDAYS[Number(x) - 1] ?? x;
  if (axis === "month") return `${MONTHS[Number(x.slice(5, 7)) - 1] ?? ""} ${x.slice(0, 4)}`;
  if (axis === "day") return `${Number(x.slice(8, 10))} ${MONTHS[Number(x.slice(5, 7)) - 1] ?? ""}`;
  return x;
}

function drawSeries(ctx: SKRSContext2D, v: Extract<PublicVisual, { kind: "series" }>, r: Rect, s: Sizes, accent: Rgb) {
  const top = drawTitle(ctx, v.title, r, s);
  const labelH = s.small + 12;
  const chart = { x: r.x, y: top + s.small + 12, w: r.w, h: r.y + r.h - labelH - (top + s.small + 12) };
  const n = v.points.length;
  const gap = n > 60 ? 1 : n > 24 ? 2 : 4;
  const colW = (chart.w - gap * (n - 1)) / n;
  const max = Math.max(...v.points.map((p) => p.y), 0) || 1;
  const peak = v.points.findIndex((p) => p.y === max);
  v.points.forEach((p, i) => {
    const h = p.y > 0 ? Math.max(3, (p.y / max) * chart.h) : 2;
    ctx.fillStyle = css(p.y <= 0 ? SURFACE : i === peak ? PAPER : accent);
    ctx.fillRect(chart.x + i * (colW + gap), chart.y + chart.h - h, Math.max(1, colW), h);
  });
  const peakText = safe(`${plainValue(max, v.unit)}, ${axisLabel(v.points[peak]!.x, v.axis)}`);
  const peakW = widthOf(ctx, peakText, s.small);
  const peakX = Math.min(chart.x + chart.w - peakW, Math.max(chart.x, chart.x + peak * (colW + gap) + colW / 2 - peakW / 2));
  drawText(ctx, peakText, peakX, chart.y - 10, s.small, PAPER, peakW);
  const first = safe(axisLabel(v.points[0]!.x, v.axis));
  const last = safe(axisLabel(v.points.at(-1)!.x, v.axis));
  const lastW = widthOf(ctx, last, s.small);
  drawText(ctx, first, r.x, r.y + r.h, s.small, MUTED, widthOf(ctx, first, s.small));
  drawText(ctx, last, r.x + r.w - lastW, r.y + r.h, s.small, MUTED, lastW);
}

const asCompare = (v: Extract<PublicVisual, { kind: "pair" }>): Extract<PublicVisual, { kind: "compare" }> => ({
  kind: "compare",
  title: v.label,
  unit: v.unit,
  nowLabel: "",
  beforeLabel: "before",
  rows: [{ label: "", now: v.now, before: v.before }],
});

const pct = (share: number) => `${Math.round(share * 100)}%`;

/**
 * Draws an answer's share card: the encore mark, the question, the answer's first sentence and its leading visual (a
 * ranked list, a comparison or a chart; a share as figures) on ink, beside (wide) or under (square) a dithered field
 * made from the visual's art. Text no bundled font can draw is left out; a lead that cannot be drawn falls back to
 * the visual's title, then the question.
 */
export async function makeAnswerCard(input: AnswerCardInput & { format: CardFormat; fetchFn?: typeof fetch }): Promise<Uint8Array> {
  const visual = input.visual?.kind === "pair" ? asCompare(input.visual) : input.visual;
  const chart = visual !== null && visual.kind !== "share";
  const layout = chart ? CHART_LAYOUTS[input.format] : CARD_LAYOUTS[input.format];
  const { canvas, ctx, images, stops } = await startCard(layout, input.art, input.fetchFn);
  const art = new Map(input.art.flatMap((url, i) => (images[i] ? [[url, images[i]!] as const] : [])));
  const s = SIZES[input.format];
  const t = layout.text;
  const bottom = t.y + t.h;

  let y = t.y + MARK_HEIGHT + 56;
  const question = safe(input.question);
  if (question) {
    const qLines = clampLines(question, measureWith(ctx), s.question, t.w, 2);
    qLines.forEach((line, i) => drawText(ctx, line, t.x, y + i * Math.round(s.question * 1.3), s.question, MUTED, t.w));
    y += (qLines.length - 1) * Math.round(s.question * 1.3) + 24;
  }

  const visualTitle = visual && "title" in visual ? visual.title : "";
  const lead = safe(input.lead) || safe(visualTitle) || question || "An answer about my listening";
  const reserve = chart ? (input.format === "wide" ? 200 : 300) : visual?.kind === "share" ? 36 + s.value + 40 : 0;
  const head = lines(ctx, lead, { maxWidth: t.w, maxPx: chart ? s.leadMax : s.leadMax + 12, minPx: s.leadMin, maxLines: chart ? 3 : 5 });
  const step = Math.round(head.px * (isRtl(lead) ? 1.3 : 1.12));
  const room = Math.max(1, Math.floor((bottom - reserve - y) / step));
  const shown = head.lines.length > room ? [...head.lines.slice(0, room - 1), clampLast(head.lines.slice(room - 1).join(" "), measureWith(ctx), head.px, t.w)] : head.lines;
  for (const line of shown) {
    y += step;
    drawText(ctx, line, t.x, y, head.px, PAPER, t.w);
  }

  const area = { x: t.x, y: y + 40, w: t.w, h: bottom - y - 40 };
  const accent = stops[2]!;
  if (visual?.kind === "ranked") drawRanked(ctx, visual, area, s, art);
  else if (visual?.kind === "compare") drawCompare(ctx, visual, area, s, accent);
  else if (visual?.kind === "series") drawSeries(ctx, visual, area, s, accent);
  else if (visual?.kind === "share")
    drawFigures(ctx, [{ value: pct(visual.share), label: fit(ctx, safe(visual.label), 24, t.w * 0.6) }, ...(visual.before === null ? [] : [{ value: pct(visual.before), label: "before" }])], t, s.value);
  return canvas.encode("png");
}
