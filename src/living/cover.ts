import { createHash } from "node:crypto";
import { makeCover } from "../covers/render";
import type { LivingSpec } from "./kinds";

/** Bump when the drawing changes, so every living cover is drawn and uploaded again. */
const COVER_VERSION = 1;

type CoverSpec = Pick<LivingSpec, "id" | "name" | "cover">;

/** Everything the fixed cover is drawn from, hashed: the same key means the same image. */
export function livingCoverKey({ name, cover }: CoverSpec): string {
  return createHash("sha256")
    .update(JSON.stringify([COVER_VERSION, name, cover.style, cover.colours]))
    .digest("hex")
    .slice(0, 16);
}

export const livingCoverUrl = (spec: CoverSpec): string => `/api/living/${spec.id}/cover?v=${livingCoverKey(spec)}`;

const drawn = new Map<string, Promise<Uint8Array>>();

/** The cover JPEG, drawn once per key and process. It needs no network. */
export function livingCover(spec: CoverSpec): Promise<Uint8Array> {
  const key = livingCoverKey(spec);
  let jpeg = drawn.get(key);
  if (!jpeg) {
    jpeg = makeCover({ title: spec.name, covers: [], style: spec.cover.style, colours: spec.cover.colours }).then((c) => c.jpeg);
    jpeg.catch(() => drawn.delete(key));
    drawn.set(key, jpeg);
  }
  return jpeg;
}
