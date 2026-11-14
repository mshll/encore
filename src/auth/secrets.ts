import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256 = (value: string) => createHash("sha256").update(value).digest();

export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  return timingSafeEqual(sha256(a), sha256(b));
}

export const randomId = (bytes = 32) => randomBytes(bytes).toString("base64url");
