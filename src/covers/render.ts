import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { fetchArt } from "./art";
import { CELL, COVER_SIZE, GRID, PAPER, INK, coverField, ditherIndices, floorFade, orbField, raysField, ringsField, tilesField, wavesField, type Field, type Rgb } from "./field";
import { coverFonts, TITLE_FONT_STACK } from "./fonts";
import { MARK_RUNS } from "./mark";
import type { AbstractStyle, CoverStyle } from "./style";
import { DEFAULT_HUE, colourStops, dominantHue, type Hue } from "./tint";
import { cleanTitle, isRtl, layoutTitle, titleCovered } from "./title";

export type CoverInput = {
  title: string;
  /** Album art in order of importance: image URLs on Spotify's CDN, or image bytes. The first 8 are used. */
  covers: (string | Uint8Array)[];
  /** `field` needs 2 covers that load; with fewer the cover is drawn as `rings`. The other styles use no art. */
  style: CoverStyle;
  /** Fixed tones instead of tones taken from the covers: `lead` for the mid tone, `second` for the dark tone. */
  colours?: { lead: Hue; second: Hue };
  fetchFn?: typeof fetch;
};

const ABSTRACT_FIELDS: Record<AbstractStyle, () => Field> = { rings: ringsField, orb: orbField, waves: wavesField, rays: raysField, tiles: tilesField };

export type Cover = {
  jpeg: Uint8Array;
  /** The style actually drawn. */
  style: CoverStyle;
  coversUsed: number;
  /** Fewer covers loaded than were asked for (a fetch failed or timed out). */
  partial: boolean;
  /** False when the title has characters no bundled font can draw: the cover is drawn without it rather than with empty boxes. */
  titleDrawn: boolean;
  quality: number;
};

const MAX_COVERS = 8;
const MARGIN = 40;
const TITLE_BOTTOM = 600;
const MARK_CELL = 3;
/** Spotify's limit on the base64 body of a playlist cover upload. */
export const UPLOAD_LIMIT = 256 * 1024;
const QUALITIES = [92, 88, 84, 80, 76, 72, 68, 64, 60];

export const base64Length = (bytes: number) => 4 * Math.ceil(bytes / 3);

/** The highest JPEG quality whose base64 fits the upload limit. */
export async function encodeToFit(encode: (quality: number) => Promise<Uint8Array>, limit = UPLOAD_LIMIT): Promise<{ jpeg: Uint8Array; quality: number }> {
  for (const quality of QUALITIES) {
    const jpeg = await encode(quality);
    if (base64Length(jpeg.byteLength) <= limit) return { jpeg, quality };
  }
  throw new Error(`Cover does not fit ${limit} bytes of base64 at quality ${QUALITIES.at(-1)}`);
}

async function decode(source: string | Uint8Array, fetchFn: typeof fetch): Promise<Image | null> {
  const bytes = typeof source === "string" ? await fetchArt(source, fetchFn) : source;
  if (!bytes) return null;
  try {
    return await loadImage(Buffer.from(bytes));
  } catch (error) {
    console.warn(`Cover art could not be decoded: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function sample(image: Image, size: number): Uint8ClampedArray {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

function luminance(image: Image): Float32Array {
  const px = sample(image, GRID);
  return Float32Array.from({ length: GRID * GRID }, (_, i) => px[i * 4]! * 0.299 + px[i * 4 + 1]! * 0.587 + px[i * 4 + 2]! * 0.114);
}

function pixels(image: Image): Rgb[] {
  const px = sample(image, 64);
  return Array.from({ length: 64 * 64 }, (_, i) => [px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!] as const);
}

function paintCells(ctx: SKRSContext2D, indices: Uint8Array, stops: Rgb[]) {
  const image = ctx.createImageData(COVER_SIZE, COVER_SIZE);
  for (let y = 0; y < COVER_SIZE; y++) {
    for (let x = 0; x < COVER_SIZE; x++) {
      const [r, g, b] = stops[indices[Math.floor(y / CELL) * GRID + Math.floor(x / CELL)]!]!;
      const at = (y * COVER_SIZE + x) * 4;
      image.data[at] = r;
      image.data[at + 1] = g;
      image.data[at + 2] = b;
      image.data[at + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

const css = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`;

/** Ink on a light patch, paper on a dark one. */
function paintMark(ctx: SKRSContext2D) {
  const size = 16 * MARK_CELL;
  const px = ctx.getImageData(MARGIN, MARGIN, size, size).data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += px[i]! * 0.299 + px[i + 1]! * 0.587 + px[i + 2]! * 0.114;
  ctx.fillStyle = css(sum / (size * size) > 140 ? INK : PAPER);
  for (const run of MARK_RUNS) ctx.fillRect(MARGIN + run.x * MARK_CELL, MARGIN + run.y * MARK_CELL, run.w * MARK_CELL, MARK_CELL);
}

function paintTitle(ctx: SKRSContext2D, text: string) {
  const font = (px: number) => `600 ${px}px ${TITLE_FONT_STACK}`;
  const measure = (s: string, px: number) => {
    ctx.font = font(px);
    return ctx.measureText(s).width;
  };
  const rtl = isRtl(text);
  const { px, lines } = layoutTitle(text, measure, { maxWidth: COVER_SIZE - 2 * MARGIN, maxPx: 78, minPx: 32, maxLines: 3 });
  ctx.font = font(px);
  ctx.fillStyle = css(PAPER);
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = rtl ? "right" : "left";
  ctx.textBaseline = "alphabetic";
  const ascent = ctx.measureText("H").fontBoundingBoxAscent;
  const step = Math.floor(px * (rtl ? 1.3 : 1.04));
  lines.forEach((line, i) => ctx.fillText(line, rtl ? COVER_SIZE - MARGIN : MARGIN, TITLE_BOTTOM - step * (lines.length - i) + ascent));
}

/** Draws a 640 x 640 playlist cover and encodes it as a JPEG small enough for Spotify's upload. Needs no network for the abstract styles or for covers passed as bytes. */
export async function makeCover(input: CoverInput): Promise<Cover> {
  const sources = input.covers.slice(0, MAX_COVERS);
  const images = (await Promise.all(sources.map((s) => decode(s, input.fetchFn ?? fetch)))).filter((i): i is Image => i !== null);
  const style: CoverStyle = input.style !== "field" ? input.style : images.length >= 2 ? "field" : "rings";
  const hues = images.map((i) => dominantHue(pixels(i)));
  const [lead, second] = input.colours ? [input.colours.lead, input.colours.second] : hues.length ? [hues[0]!, hues[Math.floor(hues.length / 2)]!] : [DEFAULT_HUE, DEFAULT_HUE];
  const field = style === "field" ? coverField(images.map(luminance)) : ABSTRACT_FIELDS[style]();
  const stops = colourStops(lead, second);
  const title = cleanTitle(input.title);
  const titleDrawn = titleCovered(title, (cp) => coverFonts().has(cp));
  if (!titleDrawn) console.warn("Cover title has characters no bundled font can draw; drawing the cover without it");

  const canvas = createCanvas(COVER_SIZE, COVER_SIZE);
  const ctx = canvas.getContext("2d");
  paintCells(ctx, ditherIndices(titleDrawn ? floorFade(field) : field, stops.length), stops);
  paintMark(ctx);
  if (titleDrawn) paintTitle(ctx, title);
  const { jpeg, quality } = await encodeToFit((q) => canvas.encode("jpeg", q));
  return { jpeg, quality, style, coversUsed: images.length, partial: images.length < sources.length, titleDrawn };
}
