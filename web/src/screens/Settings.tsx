import { startRegistration } from "@simplewebauthn/browser";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { request } from "../api/client";
import { useStatus } from "../api/queries";
import type { ImportResult, Status } from "../api/types";
import { fmtAgo, fmtDate, fmtInt, fmtPct } from "../lib/format";
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
        {fmtInt(status.plays.plays)} plays stored, {fmtInt(status.plays.api)} logged live from Spotify.
      </p>
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
          <Account />
        </div>
      )}
    </Page>
  );
}
