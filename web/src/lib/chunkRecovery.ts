/**
 * A page's code file can fail to load when the browser kept a bad answer for it (a 404 seen during a deploy).
 * Fetch it again past the cache, which replaces the stored answer, then reload once. A second failure in the same
 * tab within a minute is left to the error screen, so a real outage never loops.
 */
const KEY = "encore:chunk-reload";
const WINDOW_MS = 60_000;

function lastReload(): number {
  try {
    return Number(sessionStorage.getItem(KEY) ?? 0);
  } catch {
    return 0;
  }
}

function markReload(at: number) {
  try {
    sessionStorage.setItem(KEY, String(at));
  } catch {
    // Storage is off: still reload once; the next failure shows the error screen.
  }
}

export function chunkUrl(message: string): string | null {
  return /https?:\/\/\S+\.js/.exec(message)?.[0] ?? null;
}

export function recoverFromStaleChunks() {
  window.addEventListener("vite:preloadError", (event) => {
    const now = Date.now();
    if (now - lastReload() < WINDOW_MS) return;
    event.preventDefault();
    markReload(now);
    const url = chunkUrl((event as Event & { payload?: Error }).payload?.message ?? "");
    const refresh = url ? fetch(url, { cache: "reload" }).catch(() => undefined) : Promise.resolve();
    void refresh.then(() => window.location.reload());
  });
}
