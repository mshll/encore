import { BAYER4 } from "../components/dither-kit/pixel";
import { PALETTE, type DitherColor } from "../components/dither-kit/palette";

/** Css px per dither cell, the same pitch as the dither-kit canvases. */
export const DITHER_CELL = 2;
export const DITHER_LEVELS = 16;

const cache = new Map<string, string>();

/**
 * A 4x4 ordered-dither tile at one of 17 density levels (0 to 16), as an image URL for `background-image`.
 * Tiled with `background-size: 8px 8px` and `image-rendering: pixelated`, it paints the same halftone
 * texture as the dither-kit charts without a canvas per element.
 */
export function ditherTile(level: number, color: DitherColor = "green", alpha = 1): string {
  const lvl = Math.max(0, Math.min(DITHER_LEVELS, Math.round(level)));
  const key = `${lvl}:${color}:${alpha}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 4;
  const ctx = canvas.getContext("2d")!;
  const [r, g, b] = PALETTE[color].fill;
  ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (lvl / DITHER_LEVELS > BAYER4[y]![x]!) ctx.fillRect(x, y, 1, 1);
  const url = `url(${canvas.toDataURL()})`;
  cache.set(key, url);
  return url;
}

/** Maps a share (0 to 1) to a density level. Any value above zero shows at least one lit cell in four. */
export function levelFor(share: number): number {
  if (share <= 0) return 0;
  return Math.max(4, Math.round(Math.pow(Math.min(1, share), 0.8) * DITHER_LEVELS));
}

export const TILE_STYLE = { backgroundSize: `${DITHER_CELL * 4}px ${DITHER_CELL * 4}px`, imageRendering: "pixelated" } as const;
