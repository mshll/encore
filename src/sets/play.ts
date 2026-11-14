import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { djSessions, setItems, sets, setSessions } from "../db/schema";
import type { DjService } from "../dj/session";
import { EmptySetError } from "./playlist";
import { SetNotFoundError } from "./service";

/** Plays the set through a DJ session and links the session to the set, so its live outcomes count per item. */
export async function playSet(db: Db, dj: DjService, setId: number, deviceId?: string) {
  const set = db.select().from(sets).where(eq(sets.id, setId)).get();
  if (!set) throw new SetNotFoundError();
  const uris = db.select({ uri: setItems.uri }).from(setItems).where(eq(setItems.setId, setId)).orderBy(setItems.position).all().map((r) => r.uri);
  if (uris.length === 0) throw new EmptySetError("The set has no tracks yet");
  const session = await dj.start(uris, deviceId);
  db.insert(setSessions).values({ sessionId: session.id, setId, version: set.version, startedAt: session.startedAt }).onConflictDoNothing().run();
  return session;
}

export type DjOutcome = { finished: number; skipped: number };

/** Finished and skipped counts per track URI across the DJ sessions started from this set (watcher plays, observed time and inferred skip). */
export function setDjOutcomes(db: Db, setId: number): { sessions: number; byUri: Map<string, DjOutcome> } {
  const ids = db.select({ id: setSessions.sessionId }).from(setSessions).where(eq(setSessions.setId, setId)).all().map((r) => r.id);
  const byUri = new Map<string, DjOutcome>();
  if (ids.length === 0) return { sessions: 0, byUri };
  for (const s of db.select({ outcomes: djSessions.outcomes }).from(djSessions).where(inArray(djSessions.id, ids)).all()) {
    for (const o of s.outcomes) {
      const c = byUri.get(o.uri) ?? { finished: 0, skipped: 0 };
      c[o.outcome]++;
      byUri.set(o.uri, c);
    }
  }
  return { sessions: ids.length, byUri };
}
