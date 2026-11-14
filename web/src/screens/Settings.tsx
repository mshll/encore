import { startRegistration } from "@simplewebauthn/browser";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { request } from "../api/client";
import { useSpend, useStatus, useTimezone } from "../api/queries";
import type { ImportResult, JobStatus, LlmFeature, Slot, Status } from "../api/types";
import { resetDay } from "../lib/assistant";
import { WEEKDAYS, fmtAgo, fmtDate, fmtHour, fmtInt, fmtPct, fmtTimestamp } from "../lib/format";
import { useTheme, type ThemePref } from "../lib/theme";
import { Page } from "../ui/Page";
import { Segmented } from "../ui/Segmented";
import { ErrorState, Skeleton } from "../ui/states";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-x-10 gap-y-4 border-t-[0.5px] border-border-strong pt-6 md:grid-cols-[200px_minmax(0,1fr)]">
      <h2 className="text-body-lg font-semibold">{title}</h2>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p>
        <strong className="font-semibold tabular">{fmtInt(value)}</strong>{" "}
        <span className="text-secondary">
          of {fmtInt(max)} {label}
        </span>
      </p>
      <div
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
        className="h-2 w-full max-w-md rounded-full bg-component"
      >
        <div className="h-full rounded-full bg-chart-key" style={{ width: `${max ? Math.max((value / max) * 100, value > 0 ? 1 : 0) : 0}%` }} />
      </div>
    </div>
  );
}

function Spotify({ status }: { status: Status }) {
  const queryClient = useQueryClient();
  const s = status.spotify;
  const connect = useMutation({
    mutationFn: () => request<{ url: string }>("/api/spotify/authorize"),
    onSuccess: ({ url }) => window.location.assign(url),
  });
  const disconnect = useMutation({
    mutationFn: () => request("/api/spotify/disconnect", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["status"] }),
  });
  const [confirming, setConfirming] = useState(false);
  const sync = useMutation({
    mutationFn: () => request<{ received?: number; inserted?: number }>("/api/spotify/poll", { method: "POST" }),
    onSettled: () => queryClient.invalidateQueries(),
  });
  return (
    <Block title="Spotify">
      {s.connected ? (
        <p>
          Connected{s.userId ? ` as ${s.userId}` : ""}.{" "}
          <span className="text-secondary">{status.poll.lastSuccessAt ? `Last synced ${fmtAgo(status.poll.lastSuccessAt)}.` : "Not synced yet."}</span>
        </p>
      ) : (
        <p>Not connected. New plays are not being logged until you connect.</p>
      )}
      {s.paused && (
        <p className="text-warning">
          {s.paused.reason === "quota_exceeded" ? "Spotify’s daily quota is used up." : "Spotify is rate limiting requests."} Sync resumes
          {s.paused.until ? ` ${fmtAgo(s.paused.until)}` : " later"}.
        </p>
      )}
      {s.connected && s.missingScopes.length > 0 && (
        <div className="flex flex-col gap-1">
          <p>Reconnect to grant the permissions encore asks for but does not have:</p>
          <ul className="text-body-sm text-secondary">
            {s.missingScopes.map((scope) => (
              <li key={scope}>{scope}</li>
            ))}
          </ul>
        </div>
      )}
      {status.poll.lastError && <p className="text-danger">Last sync failed: {status.poll.lastError}</p>}
      <div className="flex flex-wrap gap-2">
        {s.connected && (
          <button type="button" className="btn btn-accent" disabled={sync.isPending || Boolean(s.paused)} onClick={() => sync.mutate()}>
            {sync.isPending ? "Syncing" : "Sync now"}
          </button>
        )}
        <button type="button" className={`btn ${s.connected ? "btn-secondary" : "btn-accent"}`} disabled={connect.isPending} onClick={() => connect.mutate()}>
          {s.connected ? "Reconnect" : "Connect Spotify"}
        </button>
        {s.connected && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={disconnect.isPending}
            onClick={() => (confirming ? disconnect.mutate() : setConfirming(true))}
            onBlur={() => setConfirming(false)}
          >
            {confirming ? "Confirm disconnect" : "Disconnect"}
          </button>
        )}
      </div>
      {confirming && <p className="text-secondary">New plays stop being logged until you connect again.</p>}
      {sync.isSuccess && (
        <p role="status" className="text-secondary">
          {sync.data.inserted
            ? `${fmtInt(sync.data.inserted)} new ${sync.data.inserted === 1 ? "play" : "plays"} logged.`
            : "No new plays since the last sync."}
        </p>
      )}
      {(sync.isError || connect.isError || disconnect.isError) && (
        <p role="alert" className="text-danger">
          {errorText(sync.error ?? connect.error ?? disconnect.error)}
        </p>
      )}
    </Block>
  );
}

function Import({ status }: { status: Status }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      return request<ImportResult>("/api/import", { method: "POST", body: form });
    },
    onSuccess: () => {
      setFiles([]);
      if (input.current) input.current.value = "";
      queryClient.invalidateQueries();
    },
  });
  const last = status.import;
  return (
    <Block title="Streaming history">
      <p className="text-secondary">
        {last?.lastImportAt ? `Last import ${fmtDate(last.lastImportAt, status.timezone)}. ` : ""}
        Upload the Streaming_History_Audio files from Spotify’s extended streaming history export. Plays already stored are not added twice.
      </p>
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <label className="btn btn-secondary">
          {files.length ? `${files.length} ${files.length === 1 ? "file" : "files"} selected` : "Choose files"}
          <input ref={input} type="file" accept=".json,application/json" multiple className="sr-only" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
        </label>
        <button type="button" className="btn btn-primary" disabled={files.length === 0 || upload.isPending} onClick={() => upload.mutate()}>
          {upload.isPending ? "Importing" : "Import"}
        </button>
      </div>
      {upload.isSuccess && (
        <p role="status">
          {fmtInt(upload.data.inserted)} new plays added, {fmtInt(upload.data.alreadyPresent)} already stored.
          {upload.data.invalidRows > 0 && ` ${fmtInt(upload.data.invalidRows)} rows could not be read.`}
          {upload.data.ignoredFiles.length > 0 && ` Ignored ${upload.data.ignoredFiles.join(", ")}.`}
        </p>
      )}
      {upload.isError && (
        <p role="alert" className="text-danger">
          {errorText(upload.error)}
        </p>
      )}
    </Block>
  );
}

function Library({ status }: { status: Status }) {
  const e = status.enrichment;
  return (
    <Block title="Library">
      <Meter value={e.withArt} max={e.total} label="tracks with album art" />
      <Meter value={e.enriched} max={e.total} label="tracks with full Spotify details" />
      <Meter value={e.artists.withImage} max={e.artists.total} label="artists with a photo" />
      {e.failed > 0 && <p className="text-body-sm text-secondary">{fmtInt(e.failed)} tracks could not be found on Spotify.</p>}
      <Meter value={status.tags.tagged} max={status.tags.songs} label="songs tagged with genre and mood" />
      {status.tags.tagged > 0 && status.tags.coverage !== null && (
        <p className="text-body-sm text-secondary">{fmtPct(status.tags.coverage)} of songs tagged.</p>
      )}
      <p className="text-secondary tabular">
        {fmtInt(status.plays.plays)} plays stored: {fmtInt(status.plays.live)} watched live, {fmtInt(status.plays.api)} from Spotify’s recently played, the rest
        from your export.
      </p>
    </Block>
  );
}

function jobLine(job: JobStatus, verb: string) {
  if (job.lastError) return { text: `Failed ${job.lastRunAt ? fmtAgo(job.lastRunAt) : ""}: ${job.lastError}`, problem: true };
  if (!job.lastSuccessAt) return { text: "Not run yet", problem: false };
  return { text: `${verb} ${fmtAgo(job.lastSuccessAt)}`, problem: false };
}

function libraryLine(job: JobStatus) {
  const cursor = job.lastResult?.cursor as { phase?: string; completedAt?: number } | undefined;
  if (!job.lastError && cursor?.phase && cursor.phase !== "idle") return { text: "Syncing now", problem: false };
  if (!job.lastError && cursor?.completedAt) return { text: `Synced ${fmtAgo(new Date(cursor.completedAt).toISOString())}`, problem: false };
  return jobLine(job, "Checked");
}

function pacingLine(p: Status["spotify"]["pacing"]) {
  const waiting = p.queued.interactive + p.queued.background;
  return `${fmtInt(p.calls)} since start, at most one every ${p.minIntervalMs / 1000} s${waiting ? `, ${waiting} waiting` : ""}`;
}

function scheduledLine(job: JobStatus, enabled: boolean, slot: Slot) {
  const result = job.lastResult as { skipped?: string } | null;
  if (job.lastError) return { text: `Failed ${job.lastRunAt ? fmtAgo(job.lastRunAt) : ""}: ${job.lastError}`, problem: true };
  if (result?.skipped === "budget_exceeded") return { text: "Skipped: this month’s spending cap is reached", problem: true };
  if (!enabled) return { text: "Scheduled runs are off", problem: false };
  return { text: `${WEEKDAYS[slot.weekday - 1]}s at ${fmtHour(slot.hour)}`, problem: false };
}

const FEATURE_LABELS: Record<LlmFeature, string> = { sets: "Sets", picks: "Picks", ask: "Ask", notes: "Notes", digest: "Digests", dj: "Session re-plans" };
const usd = (n: number) => `$${n.toFixed(2)}`;

function SpendBlock({ status }: { status: Status }) {
  const llm = status.llm;
  const spend = useSpend();
  const timezone = useTimezone();
  if (!llm.configured)
    return (
      <Block title="Spend">
        <p>No Anthropic API key is set. Sets, picks, Ask, notes and digests need ANTHROPIC_API_KEY on the server.</p>
      </Block>
    );
  const share = llm.capUsd > 0 ? Math.min(1, llm.spentUsd / llm.capUsd) : 1;
  return (
    <Block title="Spend">
      {llm.exhausted ? (
        <p className="font-medium text-danger">
          Spending cap reached: {usd(llm.spentUsd)} of {usd(llm.capUsd)} this month. Sets, picks, Ask, notes and digests are paused until {resetDay(llm.month)}.
        </p>
      ) : (
        <p>
          <strong className="font-semibold tabular">{usd(llm.spentUsd)}</strong>{" "}
          <span className="text-secondary">
            of {usd(llm.capUsd)} this month. Resets on {resetDay(llm.month)}.
          </span>
        </p>
      )}
      <div
        role="meter"
        aria-valuenow={llm.spentUsd}
        aria-valuemin={0}
        aria-valuemax={llm.capUsd}
        aria-label="Spend this month"
        className="h-2 w-full max-w-md rounded-full bg-component"
      >
        <div
          className={`h-full rounded-full ${llm.exhausted ? "bg-danger" : "bg-chart-key"}`}
          style={{ width: `${Math.max(share * 100, llm.spentUsd > 0 ? 1 : 0)}%` }}
        />
      </div>
      {llm.byFeature.length > 0 && (
        <table className="w-full max-w-md text-body-sm tabular">
          <caption className="sr-only">Spend by feature this month</caption>
          <tbody>
            {[...llm.byFeature]
              .sort((a, b) => b.usd - a.usd)
              .map((f) => (
                <tr key={f.feature} className="border-t-[0.5px] border-border-default first:border-t-0">
                  <th scope="row" className="py-1.5 text-left font-normal">
                    {FEATURE_LABELS[f.feature] ?? f.feature}
                  </th>
                  <td className="py-1.5 text-right text-secondary">
                    {f.calls} {f.calls === 1 ? "call" : "calls"}
                  </td>
                  <td className="w-20 py-1.5 text-right">{usd(f.usd)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
      {spend.data && spend.data.recent.length > 0 && (
        <details className="max-w-md">
          <summary className="cursor-default text-body-sm text-secondary hover-fine:text-primary">Recent calls</summary>
          <table className="mt-2 w-full text-body-sm tabular">
            <caption className="sr-only">Recent calls</caption>
            <tbody>
              {spend.data.recent.map((c) => (
                <tr key={c.id} className="border-t-[0.5px] border-border-default">
                  <td className="py-1.5">{FEATURE_LABELS[c.feature] ?? c.feature}</td>
                  <td className="py-1.5 text-secondary">{fmtTimestamp(c.ts, timezone, false)}</td>
                  <td className="py-1.5 text-right text-secondary">{Math.round(c.durationMs / 1000)} s</td>
                  <td className="w-20 py-1.5 text-right">{usd(c.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </Block>
  );
}

function Jobs({ status }: { status: Status }) {
  const playing = status.live.watch.lastResult?.playing === true;
  const rows = [
    { name: "Playback watcher", ...jobLine(status.live.watch, playing ? "Playing, checked" : "Checked") },
    { name: "Release radar", ...jobLine(status.live.radar, "Checked") },
    { name: "Library sync", ...libraryLine(status.live.library) },
    { name: "Spotify calls", text: pacingLine(status.spotify.pacing), problem: false },
    { name: "Weekly picks", ...scheduledLine(status.llm.jobs.picks, status.llm.schedule.enabled, status.llm.schedule.picks) },
    { name: "Weekly digest", ...scheduledLine(status.llm.jobs.digest, status.llm.schedule.enabled, status.llm.schedule.digest) },
    { name: "Discord", text: status.integrations.discord ? "Connected" : "Not set up", problem: false },
    { name: "MCP", text: status.integrations.mcp ? "Enabled" : "Off", problem: false },
  ];
  return (
    <Block title="Background">
      <dl className="grid max-w-xl grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-6 gap-y-2">
        {rows.map((r) => (
          <div key={r.name} className="contents">
            <dt className="text-secondary">{r.name}</dt>
            <dd className={r.problem ? "text-danger" : ""}>{r.text}</dd>
          </div>
        ))}
      </dl>
    </Block>
  );
}

function Account() {
  const queryClient = useQueryClient();
  const [theme, setTheme] = useTheme();
  const addPasskey = useMutation({
    mutationFn: async () => {
      const optionsJSON = await request<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/api/auth/register/options", { json: {} });
      const response = await startRegistration({ optionsJSON });
      await request("/api/auth/register/verify", { json: { response } });
    },
  });
  const signOut = useMutation({
    mutationFn: () => request("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(["session"], { authenticated: false, setupRequired: false });
    },
  });
  return (
    <>
      <Block title="Appearance">
        <Segmented<ThemePref>
          label="Theme"
          value={theme}
          onChange={setTheme}
          className="md:self-start"
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Block>
      <Block title="Account">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" disabled={addPasskey.isPending} onClick={() => addPasskey.mutate()}>
            {addPasskey.isPending ? "Waiting for passkey" : "Add a passkey"}
          </button>
          <button type="button" className="btn btn-danger" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
            Sign out
          </button>
        </div>
        {addPasskey.isSuccess && <p role="status">Passkey added.</p>}
        {(addPasskey.isError || signOut.isError) && (
          <p role="alert" className="text-danger">
            {errorText(addPasskey.error ?? signOut.error)}
          </p>
        )}
      </Block>
    </>
  );
}

export default function Settings() {
  const q = useStatus();
  return (
    <Page title="Settings">
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="flex flex-col gap-10">
          <Spotify status={q.data} />
          <Import status={q.data} />
          <Library status={q.data} />
          <Jobs status={q.data} />
          <SpendBlock status={q.data} />
          <Account />
        </div>
      )}
    </Page>
  );
}
