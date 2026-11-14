import { eq, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { sessions } from "../db/schema";
import { randomId, sha256 } from "./secrets";

export const SESSION_TTL_MS = 30 * 86_400_000;

const hashId = (id: string) => sha256(id).toString("hex");

export function createSession(db: Db, now = Date.now()): string {
  const id = randomId();
  db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
  db.insert(sessions).values({ idHash: hashId(id), createdAt: now, expiresAt: now + SESSION_TTL_MS }).run();
  return id;
}

export function isValidSession(db: Db, id: string | undefined, now = Date.now()): boolean {
  if (!id) return false;
  const row = db.select().from(sessions).where(eq(sessions.idHash, hashId(id))).get();
  return Boolean(row && row.expiresAt > now);
}

export function deleteSession(db: Db, id: string) {
  db.delete(sessions).where(eq(sessions.idHash, hashId(id))).run();
}
