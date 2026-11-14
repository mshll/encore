import { AsyncLocalStorage } from "node:async_hooks";

export type Priority = "interactive" | "background";

const priority = new AsyncLocalStorage<Priority>();

/** Spotify calls made inside `fn` (and anything it awaits) queue behind interactive ones. */
export const inBackground = <T>(fn: () => T): T => priority.run("background", fn);

export const currentPriority = (): Priority => priority.getStore() ?? "interactive";

type Waiter = { fn: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void };

/**
 * One Web API call at a time, starts at least `spacingMs` apart, interactive calls first.
 * A call made while another is running waits for it, so a call must not wait on another Spotify call.
 */
export class SpotifyPacer {
  private readonly queues: Record<Priority, Waiter[]> = { interactive: [], background: [] };
  private busy = false;
  private lastStart = Number.NEGATIVE_INFINITY;
  calls = 0;

  constructor(
    readonly spacingMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms),
  ) {}

  run<T>(fn: () => Promise<T>, as: Priority = currentPriority()): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queues[as].push({ fn, resolve: resolve as (v: unknown) => void, reject });
      void this.drain();
    });
  }

  pending(): Record<Priority, number> {
    return { interactive: this.queues.interactive.length, background: this.queues.background.length };
  }

  private async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queues.interactive.length || this.queues.background.length) {
        const wait = this.lastStart + this.spacingMs - this.now();
        if (wait > 0) await this.sleep(wait);
        const next = this.queues.interactive.shift() ?? this.queues.background.shift()!;
        this.lastStart = this.now();
        this.calls++;
        try {
          next.resolve(await next.fn());
        } catch (error) {
          next.reject(error);
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
