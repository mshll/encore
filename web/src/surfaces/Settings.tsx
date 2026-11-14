import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiError, request } from "../api/client";
import { useOnboarding, useSettings, useSpend, useStatus } from "../api/queries";
import type { ClaudeKeyCheck, DiscordRegistration, JobStatus, LlmFeature, Session, Status } from "../api/types";
import { SETTINGS_TABS } from "../app/nav";
import { BudgetBar } from "../charts/BudgetBar";
import { resetDay } from "../lib/assistant";
import { fmtAgo, fmtInt, fmtMonthLong } from "../lib/format";
import { passkeyProblem, registerPasskey } from "../lib/passkey";
import { connectSpotify } from "../lib/spotifyConnect";
import { useTheme, type ThemePref } from "../lib/theme";
import { showToast } from "../lib/toast";
import { AppLink } from "../ui/AppLink";
import { Button, buttonClass } from "../ui/Button";
import { CopyField } from "../ui/CopyField";
import { Confirm } from "../ui/Dialog";
import { Notice } from "../ui/Notice";
import { Page, PageHeader, Section } from "../ui/Page";
import { Segmented } from "../ui/Segmented";
import { SettingRow, SettingRows } from "../ui/SettingRow";
import { Skeleton } from "../ui/Skeleton";
import { describeError, ErrorState } from "../ui/States";
import { TabNav } from "../ui/TabNav";
import { SettingsBlock, useSettingsForm, type SettingsForm } from "./settings/form";

type Tab = "general" | "spotify" | "claude" | "integrations" | "jobs" | "account";

const usd = (n: number) => `$${n.toFixed(2)}`;

const SKIP_REASONS: Record<string, string> = {
  not_due: "not due yet",
  budget_exceeded: "this month’s Claude budget is spent",
  llm_not_configured: "Claude is not set up",
  spotify_not_connected: "Spotify is not connected",
  attempts_exhausted: "it failed too many times",
};

const PAUSED = /^Spotify calls paused \((rate_limited|quota_exceeded)\) until (\S+)$/;

/** A job's stored error as a sentence: the Spotify pause the client raises reads as its reason and when it lifts. */
function jobError(message: string): string {
  const paused = PAUSED.exec(message);
  if (!paused) return message;
  const why = paused[1] === "quota_exceeded" ? "the daily Spotify quota ran out" : "Spotify asked encore to slow down";
  const until = Date.parse(paused[2]!);
  return Number.isNaN(until) || until <= Date.now() ? why : `${why}; calls resume ${fmtAgo(paused[2]!)}`;
}

function jobLine(job: JobStatus | undefined, verb = "Ran"): { text: string; problem: boolean } {
  if (!job) return { text: "", problem: false };
  if (job.lastError) return { text: `Failed ${job.lastRunAt ? fmtAgo(job.lastRunAt) : ""}: ${jobError(job.lastError)}`, problem: true };
  const skipped = job.lastResult?.skipped;
  if (typeof skipped === "string" && job.lastRunAt) return { text: `Skipped ${fmtAgo(job.lastRunAt)}: ${SKIP_REASONS[skipped] ?? skipped.replaceAll("_", " ")}`, problem: false };
  if (!job.lastSuccessAt) return { text: "Not run yet", problem: false };
  return { text: `${verb} ${fmtAgo(job.lastSuccessAt)}`, problem: false };
}

function JobLine({ job, verb }: { job: JobStatus | undefined; verb?: string }) {
  const line = jobLine(job, verb);
  if (!line.text) return null;
  return <span className={line.problem ? "text-danger" : undefined}>{line.text}</span>;
}

/** Shown once per tab when the tab has keys that only SECRETS_KEY lets the server store. */
function SecretsNotice({ keys }: { keys: string[] }) {
  const settings = useSettings();
  if (!settings.data || settings.data.secretStorage.available) return null;
  const editable = settings.data.groups.flatMap((g) => g.fields).some((f) => keys.includes(f.key) && f.secret && !f.locked);
  if (!editable) return null;
  return <Notice tone="warning">Keys and tokens cannot be saved here until {settings.data.secretStorage.envVar} is set on the server. Ones set as environment variables still work.</Notice>;
}

function General() {
  const form = useSettingsForm(["timezone", "homeCountry", "weekendDays"]);
  const [theme, setTheme] = useTheme();
  const zoneChanging = "timezone" in form.draft;
  return (
    <>
      <SettingsBlock
        title="Time and place"
        keys={["timezone", "homeCountry", "weekendDays"]}
        form={form}
        hints={zoneChanging ? { timezone: "Plays already stored keep the old zone." } : undefined}
      />
      <Section title="Appearance">
        <SettingRows>
          <SettingRow label="Theme">
            {() => (
              <Segmented<ThemePref>
                label="Theme"
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "system", label: "System" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
              />
            )}
          </SettingRow>
        </SettingRows>
      </Section>
    </>
  );
}

function SpotifyConnection({ status }: { status: Status }) {
  const queryClient = useQueryClient();
  const s = status.spotify;
  const [confirm, setConfirm] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const connect = useMutation({ mutationFn: () => connectSpotify("settings"), onError: (e) => setProblem(describeError(e)) });
  const disconnect = useMutation({
    mutationFn: () => request("/api/spotify/disconnect", { method: "POST" }),
    onSuccess: async () => {
      setConfirm(false);
      await queryClient.invalidateQueries();
    },
    onError: (e) => setProblem(describeError(e)),
  });
  const poll = useMutation({
    mutationFn: () => request<{ inserted?: number }>("/api/spotify/poll", { method: "POST" }),
    onSuccess: async (r) => {
      showToast(r.inserted ? `${fmtInt(r.inserted)} new ${r.inserted === 1 ? "play" : "plays"} logged` : "No new plays since the last check");
      await queryClient.invalidateQueries();
    },
    onError: (e) => setProblem(e instanceof ApiError && e.code === "spotify_not_connected" ? "Spotify is not connected." : describeError(e)),
  });
  return (
    <Section title="Connection">
      <div className="flex flex-col gap-1">
        <p className="text-body">{s.connected ? `Connected as ${s.userId ?? "your account"}` : "Not connected. New plays are not logged until you connect."}</p>
        {s.connected && (
          <p className="text-secondary">
            Recently played: <JobLine job={status.poll} verb="checked" />
          </p>
        )}
      </div>
      {s.paused && (
        <Notice tone="warning">
          {s.paused.reason === "quota_exceeded" ? "Spotify’s daily quota is used up." : "Spotify is limiting requests."} Calls resume {s.paused.until ? fmtAgo(s.paused.until) : "later"}.
        </Notice>
      )}
      {s.connected && s.missingScopes.length > 0 && <Notice tone="warning">Spotify has not granted {s.missingScopes.join(", ")}. Connect again to grant them.</Notice>}
      {problem && <Notice tone="danger">{problem}</Notice>}
      <div className="flex flex-col gap-2 md:flex-row">
        {s.connected ? (
          <>
            <Button busy={poll.isPending} busyLabel="Checking" disabled={Boolean(s.paused)} onClick={() => poll.mutate()}>
              Check for new plays
            </Button>
            <Button busy={connect.isPending} busyLabel="Opening Spotify" onClick={() => connect.mutate()}>
              Connect again
            </Button>
            <Button variant="danger" onClick={() => setConfirm(true)}>
              Disconnect
            </Button>
          </>
        ) : (
          <Button variant="accent" busy={connect.isPending} busyLabel="Opening Spotify" onClick={() => connect.mutate()}>
            Connect Spotify
          </Button>
        )}
      </div>
      <Confirm open={confirm} onOpenChange={setConfirm} title="Disconnect Spotify?" action="Disconnect" danger busy={disconnect.isPending} onConfirm={() => disconnect.mutate()}>
        encore stops logging new plays, and the player, picks and cleanup stop working until you connect again. Your history stays.
      </Confirm>
    </Section>
  );
}

function SpotifyTab({ status }: { status: Status }) {
  const form = useSettingsForm(["spotifyClientId"]);
  const onboarding = useOnboarding();
  const connect = useMutation({ mutationFn: () => connectSpotify("settings") });
  const changing = "spotifyClientId" in form.draft && status.spotify.connected;
  return (
    <>
      <SpotifyConnection status={status} />
      <SettingsBlock
        title="Spotify app"
        keys={["spotifyClientId"]}
        form={form}
        hints={changing ? { spotifyClientId: "Saving a new ID disconnects Spotify until you connect again." } : undefined}
        effectAction={
          <Button size="sm" busy={connect.isPending} busyLabel="Opening Spotify" onClick={() => connect.mutate()}>
            Connect Spotify
          </Button>
        }
      >
        {onboarding.data && (
          <SettingRow label="Redirect URI" hint="Add it to the app in the Spotify developer dashboard.">
            {() => <CopyField value={onboarding.data.steps.spotifyApp.redirectUri} label="Redirect URI" />}
          </SettingRow>
        )}
      </SettingsBlock>
    </>
  );
}

const FEATURE_LABELS: Record<LlmFeature, string> = { sets: "Sets", picks: "Picks", ask: "Ask", notes: "Liner notes", digest: "Recaps", dj: "Session re-plans" };

function Spend() {
  const q = useSpend();
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load spend" size="inline" />;
  if (!q.data) return <Skeleton className="h-24 w-full" />;
  const b = q.data.budget;
  const features = [...q.data.byFeature].filter((f) => f.calls > 0).sort((a, c) => c.usd - a.usd);
  return (
    <Section title={`Spend in ${fmtMonthLong(b.month)}`}>
      <div className="flex flex-col gap-3">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-serif text-figure text-primary tabular">{usd(b.spentUsd)}</span>
          <span className="text-secondary">
            of {usd(b.capUsd)}. Resets on {resetDay(b.month)}.
          </span>
        </p>
        <BudgetBar spent={b.spentUsd} cap={b.capUsd} label={`Spent this month, of the ${usd(b.capUsd)} cap`} />
        {b.exhausted && <Notice tone="danger">The cap is reached. Sets, picks, Ask, liner notes and recaps are paused until {resetDay(b.month)}, or raise the cap below.</Notice>}
      </div>
      {features.length > 0 && (
        <table className="w-full tabular">
          <caption className="sr-only">Spend by feature this month</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Feature</th>
              <th scope="col">Calls</th>
              <th scope="col">Spent</th>
            </tr>
          </thead>
          <tbody>
            {features.map((f) => (
              <tr key={f.feature}>
                <th scope="row" className="py-1.5 text-left font-normal">
                  {FEATURE_LABELS[f.feature] ?? f.feature}
                </th>
                <td className="py-1.5 text-right text-secondary">
                  {fmtInt(f.calls)} {f.calls === 1 ? "call" : "calls"}
                </td>
                <td className="w-24 py-1.5 text-right">{usd(f.usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function VerifyClaude({ form }: { form: SettingsForm }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const typed = form.draft.claudeApiKey;
  const field = form.fields.get("claudeApiKey");
  if (!field || (!field.set && !(typeof typed === "string" && typed))) return null;
  const verify = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await request<ClaudeKeyCheck>("/api/settings/claude/verify", { json: typeof typed === "string" && typed ? { apiKey: typed } : {} });
      setResult(r.valid ? { ok: true, text: `The key works with ${r.model}.` } : { ok: false, text: r.message });
    } catch (error) {
      setResult({ ok: false, text: describeError(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingRow label="Check the key" hint={result?.ok ? result.text : undefined} error={result && !result.ok ? result.text : null}>
      {() => (
        <div className="flex md:justify-end">
          <Button size="sm" busy={busy} busyLabel="Checking" onClick={() => void verify()}>
            {typeof typed === "string" && typed ? "Check new key" : "Check key"}
          </Button>
        </div>
      )}
    </SettingRow>
  );
}

function ClaudeTab({ status }: { status: Status }) {
  const claude = useSettingsForm(["claudeApiKey", "claudeModel", "monthlyBudgetUsd"]);
  const picks = useSettingsForm(["picksPerWeek", "picksFarOut", "picksWeekday", "picksHour", "picksPlaylist"]);
  const digest = useSettingsForm(["digestWeekday", "digestHour"]);
  const dj = useSettingsForm(["djReplanner", "djReplanTimeoutSeconds", "djSkipTrigger"]);
  const storage = claude.settings.data?.secretStorage.available ?? true;
  const scheduleOff = !status.llm.schedule.enabled;
  return (
    <>
      <SecretsNotice keys={["claudeApiKey"]} />
      {status.llm.configured || status.llm.spentUsd > 0 ? <Spend /> : null}
      <SettingsBlock title="Claude" keys={["claudeApiKey", "claudeModel", "monthlyBudgetUsd"]} form={claude} storage={storage}>
        <VerifyClaude form={claude} />
      </SettingsBlock>
      <SettingsBlock
        title="Weekly picks"
        description={
          <>
            {scheduleOff ? "Scheduled runs are off on this server." : <JobLine job={status.llm.jobs.picks} />}
          </>
        }
        keys={["picksPerWeek", "picksFarOut", "picksWeekday", "picksHour", "picksPlaylist"]}
        form={picks}
      />
      <SettingsBlock
        title="Weekly recap"
        description={scheduleOff ? "Scheduled runs are off on this server." : <JobLine job={status.llm.jobs.digest} />}
        keys={["digestWeekday", "digestHour"]}
        form={digest}
        hints={{ digestHour: "The monthly recap runs on the 1st at this time." }}
      />
      <SettingsBlock title="Sessions" keys={["djReplanner", "djReplanTimeoutSeconds", "djSkipTrigger"]} form={dj} />
    </>
  );
}

function discordProblem(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "discord_not_configured") return "Add the application ID, public key and your user ID first.";
    if (error.code === "discord_registration_unavailable") return "Add the bot token and server ID first.";
  }
  return describeError(error);
}

const DISCORD_KEYS = ["discordApplicationId", "discordPublicKey", "discordOwnerId", "discordBotToken", "discordGuildId", "discordChannelId"];

function IntegrationsTab({ status }: { status: Status }) {
  const discord = useSettingsForm(DISCORD_KEYS);
  const mcp = useSettingsForm(["mcpToken"]);
  const onboarding = useOnboarding();
  const storage = discord.settings.data?.secretStorage.available ?? true;
  const [problem, setProblem] = useState<string | null>(null);
  const register = useMutation({
    mutationFn: () => request<DiscordRegistration>("/api/settings/discord/register", { json: {} }),
    onSuccess: (r) => {
      setProblem(null);
      showToast(`Registered ${fmtInt(r.registered)} Discord commands`);
    },
    onError: (e) => setProblem(discordProblem(e)),
  });
  const o = onboarding.data?.steps;
  return (
    <>
      <SecretsNotice keys={["discordBotToken", "mcpToken"]} />
      <SettingsBlock
        title="Discord"
        description={status.integrations.discord ? "Commands answer in Discord." : "Not set up."}
        keys={DISCORD_KEYS}
        form={discord}
        storage={storage}
        footer={
          <div className="flex flex-col gap-3">
            {problem && <Notice tone="danger">{problem}</Notice>}
            {status.integrations.discord && !discord.dirty && (
              <Button className="self-start" busy={register.isPending} busyLabel="Registering" onClick={() => register.mutate()}>
                Register commands again
              </Button>
            )}
          </div>
        }
      >
        {o && (
          <SettingRow label="Interactions endpoint" hint="Set it in the Discord developer portal.">
            {() => <CopyField value={o.discord.interactionsUrl} label="Interactions endpoint" />}
          </SettingRow>
        )}
      </SettingsBlock>
      <SettingsBlock title="MCP" description={status.integrations.mcp ? "MCP clients can read your listening." : "Off until a token is set."} keys={["mcpToken"]} form={mcp} storage={storage}>
        {o && (
          <SettingRow label="Address">
            {() => <CopyField value={o.mcp.url} label="MCP address" />}
          </SettingRow>
        )}
      </SettingsBlock>
    </>
  );
}

const JOB_BLOCKS: { title: string; keys: string[]; job: (s: Status) => JobStatus | undefined; verb?: string; line?: (s: Status) => string }[] = [
  { title: "Recently played", keys: ["pollIntervalSeconds"], job: (s) => s.poll, verb: "Checked" },
  { title: "Playback watcher", keys: ["watcherActiveSeconds", "watcherIdleSeconds", "watcherBackoffMaxSeconds"], job: (s) => s.live.watch, verb: "Checked" },
  {
    title: "Song details and art",
    keys: ["enrichIntervalSeconds", "enrichBatchSize", "artIntervalSeconds"],
    job: (s) => s.enrichment,
    line: (s) => `${fmtInt(s.enrichment.enriched)} of ${fmtInt(s.enrichment.total)} songs have full details, ${fmtInt(s.enrichment.withArt)} have album art.`,
  },
  { title: "Release radar", keys: ["radarMinListens", "radarIntervalMinutes", "radarArtistsPerRun", "radarRecheckDays", "radarBaselineDays"], job: (s) => s.live.radar, verb: "Checked" },
  { title: "Library sync", keys: ["librarySyncHours", "libraryPageSeconds"], job: (s) => s.live.library, verb: "Synced" },
  {
    title: "Spotify calls",
    keys: ["spotifyMinIntervalMs", "quotaBackoffHours"],
    job: () => undefined,
    line: (s) => {
      const waiting = s.spotify.pacing.queued.interactive + s.spotify.pacing.queued.background;
      return `${fmtInt(s.spotify.pacing.calls)} calls since the server started${waiting ? `, ${fmtInt(waiting)} waiting` : ""}.`;
    },
  },
];

function JobBlock({ block, status }: { block: (typeof JOB_BLOCKS)[number]; status: Status }) {
  const form = useSettingsForm(block.keys);
  const job = block.job(status);
  return (
    <SettingsBlock
      title={block.title}
      description={
        <>
          {block.line && `${block.line(status)} `}
          <JobLine job={job} verb={block.verb} />
        </>
      }
      keys={block.keys}
      form={form}
    />
  );
}

function JobsTab({ status }: { status: Status }) {
  return (
    <>
      {JOB_BLOCKS.map((b) => (
        <JobBlock key={b.title} block={b} status={status} />
      ))}
    </>
  );
}

function AccountTab() {
  const queryClient = useQueryClient();
  const access = useSettingsForm(["adminToken"]);
  const onboarding = useOnboarding();
  const storage = access.settings.data?.secretStorage.available ?? true;
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const add = useMutation({
    mutationFn: () => registerPasskey(),
    onSuccess: async () => {
      setMessage({ ok: true, text: "Passkey added." });
      await queryClient.invalidateQueries({ queryKey: ["onboarding"] });
    },
    onError: (e) => setMessage({ ok: false, text: passkeyProblem(e) }),
  });
  const signOut = useMutation({
    mutationFn: () => request("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.setQueryData<Session>(["session"], (s) => ({ authenticated: false, setupRequired: false, setupTokenConfigured: s?.setupTokenConfigured ?? true }));
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
    },
    onError: (e) => setMessage({ ok: false, text: describeError(e) }),
  });
  const n = onboarding.data?.steps.passkey.passkeys;
  return (
    <>
      <SecretsNotice keys={["adminToken"]} />
      <Section title="Passkeys">
        <SettingRows>
          <SettingRow label={n === undefined ? "Passkeys" : `${fmtInt(n)} ${n === 1 ? "passkey" : "passkeys"}`} hint={message?.ok ? message.text : "Add one on each device you sign in from."} error={message && !message.ok ? message.text : null}>
            {() => (
              <div className="flex md:justify-end">
                <Button busy={add.isPending} busyLabel="Waiting for passkey" onClick={() => add.mutate()}>
                  Add a passkey
                </Button>
              </div>
            )}
          </SettingRow>
        </SettingRows>
      </Section>
      <SettingsBlock title="Access" keys={["adminToken"]} form={access} storage={storage} />
      <Section title="Session">
        <SettingRows>
          <SettingRow label="Sign out of this browser">
            {() => (
              <div className="flex md:justify-end">
                <Button busy={signOut.isPending} busyLabel="Signing out" onClick={() => signOut.mutate()}>
                  Sign out
                </Button>
              </div>
            )}
          </SettingRow>
        </SettingRows>
      </Section>
    </>
  );
}

function TabBody({ tab }: { tab: Tab }) {
  const settings = useSettings();
  const status = useStatus();
  const error = settings.error ?? status.error;
  if (error) return <ErrorState error={error} onRetry={() => void Promise.all([settings.refetch(), status.refetch()])} />;
  if (!settings.data || !status.data)
    return (
      <div aria-busy className="flex flex-col gap-6">
        <Skeleton className="h-5 w-40" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_320px]">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    );
  const s = status.data;
  const tabs: Record<Tab, ReactNode> = {
    general: <General />,
    spotify: <SpotifyTab status={s} />,
    claude: <ClaudeTab status={s} />,
    integrations: <IntegrationsTab status={s} />,
    jobs: <JobsTab status={s} />,
    account: <AccountTab />,
  };
  return <>{tabs[tab]}</>;
}

export function Settings({ section }: { section: string }) {
  const tab = (SETTINGS_TABS.some((t) => t.path === `/settings/${section}`) ? section : "general") as Tab;
  return (
    <Page width="read">
      <PageHeader
        title="Settings"
        actions={
          <AppLink to="/setup" className={buttonClass()}>
            Open setup
          </AppLink>
        }
      >
        <TabNav items={SETTINGS_TABS} label="Settings" />
      </PageHeader>
      <TabBody key={tab} tab={tab} />
    </Page>
  );
}
