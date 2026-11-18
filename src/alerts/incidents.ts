/** Something wrong that the owner should hear about once, and again when it clears. `key` identifies it across checks. */
export type Incident = { key: string; title: string; body: string; recovery: string };

export type OpenIncident = { title: string; recovery: string; since: number };

/** What the monitor reads on each check, gathered from job state, the Spotify client and the Claude ledger. */
export type AlertSnapshot = {
  now: number;
  timezone: string;
  spotifyConnected: boolean;
  /** Null when the poll job is off or has never run, so staleness cannot be judged. */
  pollLastSuccessAt: number | null;
  pollLastError: string | null;
  pollStaleMs: number;
  /** The last Spotify token refresh failure, cleared by the next successful sign-in or refresh. */
  authError: { message: string; revoked: boolean } | null;
  quotaLocks: { route: string; until: number }[];
  backupError: string | null;
  claude: { configured: boolean; exhausted: boolean; month: string; spentUsd: number; capUsd: number };
};

const HOUR_MS = 3_600_000;

const when = (ms: number, timezone: string) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(ms);

const hoursText = (ms: number) => {
  const h = Math.round((ms / HOUR_MS) * 10) / 10;
  return `${h} ${h === 1 ? "hour" : "hours"}`;
};

export function currentIncidents(s: AlertSnapshot): Incident[] {
  const incidents: Incident[] = [];
  if (s.spotifyConnected && s.pollLastSuccessAt !== null && s.now - s.pollLastSuccessAt > s.pollStaleMs)
    incidents.push({
      key: "poll_stale",
      title: "encore is not logging plays",
      body: `Checking recently played has not worked for ${hoursText(s.now - s.pollLastSuccessAt)}, since ${when(s.pollLastSuccessAt, s.timezone)}.${s.pollLastError ? ` Last error: ${s.pollLastError}` : ""}`,
      recovery: "Checking recently played works again.",
    });
  if (s.authError)
    incidents.push({
      key: "spotify_auth",
      title: s.authError.revoked ? "Spotify access was revoked" : "Spotify sign-in failed",
      body: s.authError.revoked ? "Spotify no longer accepts encore's sign-in. Connect Spotify again in Settings." : `Refreshing the Spotify sign-in failed: ${s.authError.message}`,
      recovery: "Spotify is signed in again.",
    });
  for (const lock of s.quotaLocks)
    incidents.push({
      key: `quota:${lock.route}`,
      title: `Spotify quota reached for ${lock.route}`,
      body: `Calls to ${lock.route} are paused until ${when(lock.until, s.timezone)}.`,
      recovery: `Calls to ${lock.route} run again.`,
    });
  if (s.backupError) incidents.push({ key: "backup", title: "Backup failed", body: s.backupError, recovery: "Backups work again." });
  if (s.claude.configured && s.claude.exhausted)
    incidents.push({
      key: "claude_cap",
      title: "Monthly AI budget spent",
      body: `$${s.claude.spentUsd.toFixed(2)} of $${s.claude.capUsd.toFixed(2)} spent in ${s.claude.month}. AI features pause until next month or a higher budget.`,
      recovery: "AI features run again.",
    });
  return incidents;
}

/** Incidents that started since the last check, and open ones that have cleared. */
export function diffIncidents(open: Record<string, OpenIncident>, current: Incident[]): { opened: Incident[]; resolved: (OpenIncident & { key: string })[] } {
  const keys = new Set(current.map((i) => i.key));
  return {
    opened: current.filter((i) => !(i.key in open)),
    resolved: Object.entries(open)
      .filter(([key]) => !keys.has(key))
      .map(([key, incident]) => ({ key, ...incident })),
  };
}
