import type { Db } from "../db/client";
import { inBackground } from "../spotify/pacer";
import { getJobState, setJobState } from "./state";

export type Job = { name: string; intervalMs: number; run: () => Promise<Record<string, unknown> | void>; nextDelayMs?: () => number };

export async function runJob(db: Db, job: Job, now = Date.now) {
  const startedAt = now();
  setJobState(db, job.name, { lastRunAt: startedAt });
  try {
    const data = await inBackground(() => job.run());
    setJobState(db, job.name, { lastSuccessAt: now(), lastError: null, ...(data ? { data } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setJobState(db, job.name, { lastError: message });
    console.error(`[job ${job.name}] ${message}`);
  }
}

export function startScheduler(db: Db, jobs: Job[]): () => void {
  const timers = new Set<Timer>();
  let stopped = false;
  const schedule = (job: Job, delayMs: number) => {
    const timer = setTimeout(async () => {
      timers.delete(timer);
      await runJob(db, job);
      if (!stopped) schedule(job, job.nextDelayMs?.() ?? job.intervalMs);
    }, delayMs);
    timers.add(timer);
  };
  for (const job of jobs) {
    const lastRunAt = getJobState(db, job.name)?.lastRunAt ?? 0;
    schedule(job, Math.max(1000, lastRunAt + job.intervalMs - Date.now()));
  }
  return () => {
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
  };
}
