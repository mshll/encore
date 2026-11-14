import { createHash } from "node:crypto";
import { makeCover } from "../covers/render";
import type { LivingKind } from "../db/schema";
import { LIVING } from "./kinds";

/** Bump when the drawing changes, so every living cover is drawn and uploaded again. */
const COVER_VERSION = 1;

/** Everything the fixed cover is drawn from, hashed: the same key means the same image. */
export function livingCoverKey(kind: LivingKind): string {
  const { name, cover } = LIVING[kind];
  return createHash("sha256")
    .update(JSON.stringify([COVER_VERSION, name, cover.style, cover.colours]))
    .digest("hex")
    .slice(0, 16);
}

export const livingCoverUrl = (kind: LivingKind) => `/api/living/${kind}/cover?v=${livingCoverKey(kind)}`;

const drawn = new Map<string, Promise<Uint8Array>>();

/** The cover JPEG, drawn once per key and process. It needs no network. */
export function livingCover(kind: LivingKind): Promise<Uint8Array> {
  const key = livingCoverKey(kind);
  let jpeg = drawn.get(key);
  if (!jpeg) {
    const { name, cover } = LIVING[kind];
    jpeg = makeCover({ title: name, covers: [], style: cover.style, colours: cover.colours }).then((c) => c.jpeg);
    jpeg.catch(() => drawn.delete(key));
    drawn.set(key, jpeg);
  }
  return jpeg;
}
