import type { Db } from "../db/client";
import { SpotifyBlockedError } from "../spotify/errors";
import { inBackground } from "../spotify/pacer";
import { getJobState, setJobState } from "./state";

/** `intervalMs` and `nextDelayMs` are read each time the job is scheduled, so settings changes apply without a restart. */
export type Job = { name: string; intervalMs: () => number; run: () => Promise<Record<string, unknown> | void>; nextDelayMs?: () => number };

export type Scheduler = {
  stop: () => void;
  /** Re-times every job that is waiting, from its last run and its current interval. A running job picks up the change when it finishes. */
  reschedule: () => void;
};

export async function runJob(db: Db, job: Job, now = Date.now) {
  const startedAt = now();
  setJobState(db, job.name, { lastRunAt: startedAt });
  try {
    const data = await inBackground(() => job.run());
    setJobState(db, job.name, { lastSuccessAt: now(), lastError: null, ...(data ? { data } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setJobState(db, job.name, { lastError: message });
    if (!(error instanceof SpotifyBlockedError)) console.error(`[job ${job.name}] ${message}`);
  }
}

export function startScheduler(db: Db, jobs: Job[], now: () => number = Date.now): Scheduler {
  const waiting = new Map<string, Timer>();
  let stopped = false;
  const schedule = (job: Job, delayMs: number) => {
    const timer = setTimeout(async () => {
      waiting.delete(job.name);
      await runJob(db, job);
      if (!stopped) schedule(job, job.nextDelayMs?.() ?? job.intervalMs());
    }, delayMs);
    waiting.set(job.name, timer);
  };
  const fromLastRun = (job: Job) => {
    const lastRunAt = getJobState(db, job.name)?.lastRunAt ?? 0;
    return Math.max(1000, lastRunAt + job.intervalMs() - now());
  };
  for (const job of jobs) schedule(job, fromLastRun(job));
  return {
    stop: () => {
      stopped = true;
      for (const timer of waiting.values()) clearTimeout(timer);
      waiting.clear();
    },
    reschedule: () => {
      if (stopped) return;
      for (const job of jobs) {
        const timer = waiting.get(job.name);
        if (timer === undefined) continue;
        clearTimeout(timer);
        schedule(job, fromLastRun(job));
      }
    },
  };
}
