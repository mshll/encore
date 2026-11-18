import { aiReady } from "../settings/settings";
import { BACKUP_JOB } from "../backup/service";
import type { Db } from "../db/client";
import type { DiscordSource } from "../discord";
import type { Job } from "../jobs/scheduler";
import { getJobState, setJobState } from "../jobs/state";
import { budgetStatus } from "../llm/ledger";
import { redact } from "../settings/redact";
import type { SettingsSource } from "../settings/settings";
import { SPOTIFY_AUTH_STATE } from "../spotify/auth";
import type { SpotifyGate } from "../spotify/client";
import { alertChannels, ChannelError, type Alert, type AlertChannel, type ChannelName } from "./channels";
import { currentIncidents, diffIncidents, type AlertSnapshot, type OpenIncident } from "./incidents";

export const ALERTS_JOB = "alerts";
const CHECK_EVERY_MS = 60_000;

type AlertState = { open: Record<string, OpenIncident> };

export type ChannelResult = { channel: ChannelName; ok: boolean; error?: string };

export type AlertMonitorDeps = {
  db: Db;
  settings: SettingsSource;
  /** Every secret setting's value, kept out of alert text. */
  secrets: () => string[];
  spotifyAuth: { status(): { connected: boolean } };
  spotify: { gates(): SpotifyGate[] };
  discord: DiscordSource;
  /** False when the poll job does not run here (jobs off or `poll` disabled), so a stale poll is no incident. */
  pollEnabled: boolean;
  fetchFn?: typeof fetch;
  now?: () => number;
};

export class NoAlertChannelsError extends Error {
  constructor() {
    super("No alert channel is set up");
  }
}

/** Checks for incidents each minute and sends one alert when each starts and one when it clears. */
export class AlertMonitor {
  private readonly now: () => number;

  constructor(private readonly deps: AlertMonitorDeps) {
    this.now = deps.now ?? Date.now;
  }

  channels(): AlertChannel[] {
    return alertChannels(this.deps.settings.get().alerts, this.deps.discord, this.deps.fetchFn);
  }

  open(): (OpenIncident & { key: string })[] {
    return Object.entries(this.state().open).map(([key, incident]) => ({ key, ...incident }));
  }

  snapshot(): AlertSnapshot {
    const { db, settings, secrets } = this.deps;
    const now = this.now();
    const current = settings.get();
    const clean = (text: string | null | undefined) => (text ? redact(text, secrets()) : null);
    const poll = getJobState(db, "poll");
    const auth = getJobState(db, SPOTIFY_AUTH_STATE);
    const budget = budgetStatus(db, current.timezone, current.llm.monthlyBudgetUsd, now);
    return {
      now,
      timezone: current.timezone,
      spotifyConnected: this.deps.spotifyAuth.status().connected,
      pollLastSuccessAt: this.deps.pollEnabled ? (poll?.lastSuccessAt ?? null) : null,
      pollLastError: clean(poll?.lastError),
      pollStaleMs: current.alerts.pollStaleMs,
      authError: auth?.lastError ? { message: clean(auth.lastError)!, revoked: auth.data?.revoked === true } : null,
      quotaLocks: this.deps.spotify
        .gates()
        .filter((g) => g.reason === "quota_exceeded" && g.route !== "*")
        .map((g) => ({ route: g.route, until: g.blockedUntil })),
      backupError: clean(getJobState(db, BACKUP_JOB)?.lastError),
      claude: { configured: aiReady(current.llm.ai), exhausted: budget.exhausted, month: budget.month, spentUsd: budget.spentUsd, capUsd: budget.capUsd },
    };
  }

  /** One check. A transition is remembered only once some channel took it, so a failed send is tried again next check. */
  async check(): Promise<Record<string, unknown>> {
    const channels = this.channels();
    if (channels.length === 0) return { skipped: "no_channels" };
    const state = this.state();
    const { opened, resolved } = diffIncidents(state.open, currentIncidents(this.snapshot()));
    const sent: string[] = [];
    const errors = new Set<string>();
    const send = async (alert: Alert) => {
      const results = await this.sendAll(channels, alert);
      for (const r of results) if (r.error) errors.add(r.error);
      return results.some((r) => r.ok);
    };
    for (const incident of opened) {
      if (!(await send({ kind: "incident", title: incident.title, body: incident.body }))) continue;
      state.open[incident.key] = { title: incident.title, recovery: incident.recovery, since: this.now() };
      sent.push(incident.key);
    }
    for (const incident of resolved) {
      if (!(await send({ kind: "recovery", title: `Resolved: ${incident.title}`, body: incident.recovery }))) continue;
      delete state.open[incident.key];
      sent.push(`resolved:${incident.key}`);
    }
    setJobState(this.deps.db, `${ALERTS_JOB}_incidents`, { data: state });
    if (errors.size > 0) throw new Error(`Some alerts were not sent: ${[...errors].join("; ")}`);
    return { open: Object.keys(state.open), sent };
  }

  async sendTest(): Promise<ChannelResult[]> {
    const channels = this.channels();
    if (channels.length === 0) throw new NoAlertChannelsError();
    return this.sendAll(channels, { kind: "test", title: "Test alert from encore", body: "Alerts reach this channel." });
  }

  job(): Job {
    return { name: ALERTS_JOB, intervalMs: () => CHECK_EVERY_MS, run: () => this.check() };
  }

  private async sendAll(channels: AlertChannel[], alert: Alert): Promise<ChannelResult[]> {
    return Promise.all(
      channels.map(async (channel): Promise<ChannelResult> => {
        try {
          await channel.send(alert);
          return { channel: channel.name, ok: true };
        } catch (error) {
          if (!(error instanceof ChannelError)) throw error;
          return { channel: channel.name, ok: false, error: error.message };
        }
      }),
    );
  }

  private state(): AlertState {
    const data = getJobState(this.deps.db, `${ALERTS_JOB}_incidents`)?.data as AlertState | null | undefined;
    return { open: { ...(data?.open ?? {}) } };
  }
}
