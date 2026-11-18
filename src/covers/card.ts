import { createCanvas, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { GRID, INK, PAPER, coverField, ditherIndices, type Field, type Rgb } from "./field";
import { coverFonts, TITLE_FONT_STACK } from "./fonts";
import { MARK_RUNS } from "./mark";
import { ABSTRACT_FIELDS, decode, luminance, pixels } from "./render";
import { colourStops, DEFAULT_HUE, dominantHue } from "./tint";
import { cleanTitle, isRtl, layoutTitle, titleCovered } from "./title";

/** `wide` is the 1200 x 630 link preview size; `square` fits a chat or a feed. */
export const CARD_FORMATS = ["wide", "square"] as const;
export type CardFormat = (typeof CARD_FORMATS)[number];

export type CardInput = {
  /** The period's name, small above the headline: "October 2026". */
  label: string;
  headline: string;
  /** Two or three figures: a value ("36 h") over what it counts ("of music"). */
  figures: { value: string; label: string }[];
  /** Album or artist art on Spotify's CDN, most important first; with fewer than 2 that load the field is drawn as rings. */
  art: string[];
  fetchFn?: typeof fetch;
};

export type Rect = { x: number; y: number; w: number; h: number };
export type CardLayout = { width: number; height: number; field: Rect; text: Rect };

export const CARD_LAYOUTS: Record<CardFormat, CardLayout> = {
  wide: { width: 1200, height: 630, field: { x: 690, y: 0, w: 510, h: 630 }, text: { x: 64, y: 56, w: 570, h: 518 } },
  square: { width: 1080, height: 1080, field: { x: 0, y: 0, w: 1080, h: 400 }, text: { x: 72, y: 456, w: 936, h: 560 } },
};

const MAX_ART = 8;
const MARK_CELL = 4;
export const MARK_HEIGHT = 16 * MARK_CELL;
const FIGURE_LABEL_PX = 24;
const FIGURE_GAP = 48;
const HEADLINE_GAP = 40;
export const MUTED: Rgb = [170, 166, 158];
export const css = ([r, g, b]: Rgb): string => `rgb(${r}, ${g}, ${b})`;
export const font = (px: number): string => `600 ${px}px ${TITLE_FONT_STACK}`;

/** The field spread over a rectangle, cropped to fill it, with square cells. */
function paintField(ctx: SKRSContext2D, indices: Uint8Array, stops: Rgb[], r: Rect) {
  const cell = Math.max(r.w, r.h) / GRID;
  const offX = (GRID * cell - r.w) / 2;
  const offY = (GRID * cell - r.h) / 2;
  const image = ctx.createImageData(r.w, r.h);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const gx = Math.min(GRID - 1, Math.floor((x + offX) / cell));
      const gy = Math.min(GRID - 1, Math.floor((y + offY) / cell));
      const [red, g, b] = stops[indices[gy * GRID + gx]!]!;
      const at = (y * r.w + x) * 4;
      image.data[at] = red;
      image.data[at + 1] = g;
      image.data[at + 2] = b;
      image.data[at + 3] = 255;
    }
  }
  ctx.putImageData(image, r.x, r.y);
}

function paintMark(ctx: SKRSContext2D, x: number, y: number) {
  ctx.fillStyle = css(PAPER);
  for (const run of MARK_RUNS) ctx.fillRect(x + run.x * MARK_CELL, y + run.y * MARK_CELL, run.w * MARK_CELL, MARK_CELL);
}

export function lines(ctx: SKRSContext2D, text: string, fit: { maxWidth: number; maxPx: number; minPx: number; maxLines: number }) {
  const measure = (s: string, px: number) => {
    ctx.font = font(px);
    return ctx.measureText(s).width;
  };
  return layoutTitle(text, measure, fit);
}

export function drawText(ctx: SKRSContext2D, text: string, x: number, y: number, px: number, colour: Rgb, width: number) {
  const rtl = isRtl(text);
  ctx.font = font(px);
  ctx.fillStyle = css(colour);
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = rtl ? "right" : "left";
  ctx.fillText(text, rtl ? x + width : x, y);
}

/** Only text every glyph of which a bundled font can draw; the rest would come out as boxes or differ by host. */
export const drawable = (text: string): boolean => titleCovered(cleanTitle(text), (cp) => coverFonts().has(cp));

/** Up to three figures along the bottom of `t`, each a value over its label; figures that do not fit are left out. */
export function drawFigures(ctx: SKRSContext2D, figures: CardInput["figures"], t: Rect, valuePx: number) {
  const width = (text: string, px: number) => {
    ctx.font = font(px);
    return ctx.measureText(text).width;
  };
  const placed: { f: CardInput["figures"][number]; x: number; w: number }[] = [];
  let x = t.x;
  for (const f of figures.filter((f) => drawable(f.value) && drawable(f.label)).slice(0, 3)) {
    const w = Math.ceil(Math.max(width(f.value, valuePx), width(f.label, FIGURE_LABEL_PX)));
    if (x + w > t.x + t.w) break;
    placed.push({ f, x, w });
    x += w + FIGURE_GAP;
  }
  const bottom = t.y + t.h;
  for (const { f, x: at, w } of placed) {
    drawText(ctx, f.value, at, bottom - 36, valuePx, PAPER, w);
    drawText(ctx, f.label, at, bottom, FIGURE_LABEL_PX, MUTED, w);
  }
}

export type StartedCard = { canvas: Canvas; ctx: SKRSContext2D; images: (Image | null)[]; stops: Rgb[] };

/**
 * Ink with a dithered field made from the art (rings with fewer than 2 that load) in `layout.field` and the encore mark
 * at the top of `layout.text`. `images` keeps the order of `art`, with null where one did not load.
 */
export async function startCard(layout: CardLayout, art: string[], fetchFn: typeof fetch = fetch): Promise<StartedCard> {
  const images = await Promise.all(art.slice(0, MAX_ART).map((s) => decode(s, fetchFn)));
  const loaded = images.filter((i): i is Image => i !== null);
  const hues = loaded.map((i) => dominantHue(pixels(i)));
  const lead = hues[0] ?? DEFAULT_HUE;
  const second = hues[Math.floor(hues.length / 2)] ?? lead;
  const field: Field = loaded.length >= 2 ? coverField(loaded.map(luminance)) : ABSTRACT_FIELDS.rings();
  const stops = colourStops(lead, second);

  const canvas = createCanvas(layout.width, layout.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = css(INK);
  ctx.fillRect(0, 0, layout.width, layout.height);
  paintField(ctx, ditherIndices(field, stops.length), stops, layout.field);
  ctx.textBaseline = "alphabetic";
  paintMark(ctx, layout.text.x, layout.text.y);
  return { canvas, ctx, images, stops };
}

/**
 * Draws a share card: the encore mark, the period, the headline and two or three figures on ink, beside (wide) or
 * under (square) a dithered field made from the period's art. PNG, so the dither keeps its hard edges. A headline a
 * bundled font cannot draw is replaced by `fallbackHeadline`.
 */
export async function makeCard(input: CardInput & { format: CardFormat; fallbackHeadline: string }): Promise<Uint8Array> {
  const { canvas, ctx } = await startCard(CARD_LAYOUTS[input.format], input.art, input.fetchFn);
  const t = CARD_LAYOUTS[input.format].text;
  let y = t.y + MARK_HEIGHT + 56;
  const label = drawable(input.label) ? cleanTitle(input.label) : "";
  if (label) {
    drawText(ctx, label, t.x, y, 28, MUTED, t.w);
    y += 24;
  }
  const headline = drawable(input.headline) ? cleanTitle(input.headline) : input.fallbackHeadline;
  const square = input.format === "square";
  const valuePx = square ? 64 : 48;
  const head = lines(ctx, headline, { maxWidth: t.w, maxPx: square ? 72 : 56, minPx: 32, maxLines: 4 });
  const step = Math.round(head.px * 1.08);
  const room = Math.max(1, Math.floor((t.y + t.h - 36 - valuePx - HEADLINE_GAP - y) / step));
  const shown = head.lines.length > room ? [...head.lines.slice(0, room - 1), `${head.lines[room - 1]!.replace(/\s*\S*$/, "")}…`] : head.lines;
  for (const line of shown) {
    y += step;
    drawText(ctx, line, t.x, y, head.px, PAPER, t.w);
  }

  drawFigures(ctx, input.figures, t, valuePx);
  return canvas.encode("png");
}
