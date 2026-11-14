import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { jobState } from "../db/schema";

export type JobState = typeof jobState.$inferSelect;

export function getJobState(db: Db, name: string): JobState | undefined {
  return db.select().from(jobState).where(eq(jobState.name, name)).get();
}

export function setJobState(db: Db, name: string, patch: Partial<Omit<JobState, "name">>) {
  db.insert(jobState)
    .values({ name, ...patch })
    .onConflictDoUpdate({ target: jobState.name, set: patch })
    .run();
}
