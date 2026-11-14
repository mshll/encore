export type RunEvent = { event: "text" | "tool" | "visual" | "done" | "error"; data: unknown };

const RETAIN_FINISHED_MS = 10 * 60_000;

/** One assistant request that keeps working after the page that started it has gone. */
export class Run {
  readonly events: RunEvent[] = [];
  finishedAt: number | null = null;
  private readonly listeners = new Set<(event: RunEvent) => void>();
  private readonly abort = new AbortController();

  constructor(
    readonly id: string,
    readonly key: string,
    readonly startedAt: number,
  ) {}

  get signal() {
    return this.abort.signal;
  }

  emit(event: RunEvent, now: number) {
    if (this.finishedAt !== null) return;
    this.events.push(event);
    if (event.event === "done" || event.event === "error") this.finishedAt = now;
    for (const listener of this.listeners) listener(event);
  }

  /** Replays what already happened, then follows the run. Returns the unsubscribe function. */
  follow(listener: (event: RunEvent) => void): () => void {
    for (const event of this.events) listener(event);
    if (this.finishedAt !== null) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  cancel(now: number) {
    this.abort.abort();
    this.emit({ event: "error", data: { error: { code: "cancelled", message: "Cancelled" } } }, now);
  }
}

export class Runs {
  private readonly runs = new Map<string, Run>();

  start(key: string, now: number): Run {
    for (const [id, run] of this.runs) if (run.finishedAt !== null && now - run.finishedAt > RETAIN_FINISHED_MS) this.runs.delete(id);
    const run = new Run(crypto.randomUUID(), key, now);
    this.runs.set(run.id, run);
    return run;
  }

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  active(key: string): Run | undefined {
    return [...this.runs.values()].find((run) => run.key === key && run.finishedAt === null);
  }
}

export const runs = new Runs();
