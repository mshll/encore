import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { ApiError, request } from "../api/client";
import { useOnboarding, useTimezone } from "../api/queries";
import type { ClaudeKeyCheck, Onboarding, OnboardingStepId } from "../api/types";
import { fmtInt } from "../lib/format";
import { passkeyProblem, registerPasskey } from "../lib/passkey";
import { connectSpotify } from "../lib/spotifyConnect";
import { AppLink } from "../ui/AppLink";
import { Button, buttonClass } from "../ui/Button";
import { CopyField } from "../ui/CopyField";
import { cx } from "../ui/cx";
import { Icon } from "../ui/Icon";
import { CaretDownIcon, CheckIcon } from "../ui/icons";
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from "../ui/Menu";
import { Notice } from "../ui/Notice";
import { Page, PageHeader } from "../ui/Page";
import { SettingRows } from "../ui/SettingRow";
import { Skeleton } from "../ui/Skeleton";
import { describeError, ErrorState } from "../ui/States";
import { SettingFieldRow, useSettingsForm, type SettingsForm } from "./settings/form";
import { ImportStep } from "./setup/ImportStep";

const TITLES: Record<OnboardingStepId, string> = {
  passkey: "Passkey",
  spotifyApp: "Spotify app",
  spotifyConnect: "Connect Spotify",
  locale: "Time zone and weekend",
  import: "Import your history",
  claude: "Claude",
  discord: "Discord",
  mcp: "MCP",
};

const STEP_KEYS: Partial<Record<OnboardingStepId, string[]>> = {
  spotifyApp: ["spotifyClientId"],
  locale: ["timezone", "homeCountry", "weekendDays"],
  claude: ["claudeApiKey"],
  discord: ["discordApplicationId", "discordPublicKey", "discordOwnerId"],
  mcp: ["mcpToken"],
};

type Steps = Onboarding["steps"];

function summary(id: OnboardingStepId, steps: Steps): string | null {
  const s = steps[id];
  if (!s.done) return s.required ? null : "Optional";
  switch (id) {
    case "passkey":
      return `${fmtInt(steps.passkey.passkeys)} ${steps.passkey.passkeys === 1 ? "passkey" : "passkeys"}`;
    case "spotifyConnect":
      return steps.spotifyConnect.userId ? `Connected as ${steps.spotifyConnect.userId}` : "Connected";
    case "locale":
      return steps.locale.timezone.replaceAll("_", " ");
    case "import":
      return `${fmtInt(steps.import.exportPlays)} plays`;
    default:
      return "Done";
  }
}

function firstOpen(o: Onboarding, skipped: Set<OnboardingStepId>): OnboardingStepId {
  return (
    o.order.find((id) => o.steps[id].required && !o.steps[id].done) ??
    o.order.find((id) => !o.steps[id].done && !skipped.has(id)) ??
    o.order[0]!
  );
}

function StepMarker({ index, done, current }: { index: number; done: boolean; current: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "grid size-6 shrink-0 place-items-center rounded-full text-caption font-medium tabular",
        done ? "bg-fill-inverted text-inverted" : current ? "bg-fill-active text-primary" : "bg-fill text-secondary",
      )}
    >
      {done ? <Icon icon={CheckIcon} /> : index + 1}
    </span>
  );
}

function StepList({ o, current, onPick }: { o: Onboarding; current: OnboardingStepId; onPick: (id: OnboardingStepId) => void }) {
  return (
    <ol aria-label="Setup steps" className="flex flex-col gap-0.5">
      {o.order.map((id, i) => {
        const s = o.steps[id];
        const note = summary(id, o.steps);
        return (
          <li key={id}>
            <button
              type="button"
              aria-current={id === current ? "step" : undefined}
              onClick={() => onPick(id)}
              className={cx(
                "flex min-h-(--row-h) w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors duration-150",
                id === current ? "bg-fill" : "hover:bg-fill",
              )}
            >
              <StepMarker index={i} done={s.done} current={id === current} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cx("truncate", id === current ? "font-medium text-primary" : "text-primary")}>{TITLES[id]}</span>
                {note && <span className="truncate text-caption text-secondary">{note}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function PhoneStepMenu({ o, current, onPick }: { o: Onboarding; current: OnboardingStepId; onPick: (id: OnboardingStepId) => void }) {
  const index = o.order.indexOf(current);
  return (
    <MenuRoot>
      <MenuTrigger className={buttonClass({ variant: "secondary", className: "w-full justify-between" })}>
        <span className="min-w-0 flex-1 truncate text-left">
          Step {index + 1} of {o.order.length}
        </span>
        <Icon icon={CaretDownIcon} className="text-tertiary" />
      </MenuTrigger>
      <MenuPopup align="start" className="w-(--anchor-width)">
        {o.order.map((id, i) => (
          <MenuItem key={id} onClick={() => onPick(id)} icon={o.steps[id].done ? CheckIcon : undefined} hint={o.steps[id].required ? undefined : "Optional"}>
            {o.steps[id].done ? "" : `${i + 1}. `}
            {TITLES[id]}
          </MenuItem>
        ))}
      </MenuPopup>
    </MenuRoot>
  );
}

/** The fixed-height frame every step renders in: title, body, and one row of actions at the bottom. */
function Frame({ index, total, id, optional, children, actions }: { index: number; total: number; id: OnboardingStepId; optional: boolean; children: ReactNode; actions: ReactNode }) {
  return (
    <section aria-labelledby={`step-${id}`} className="flex min-h-[480px] min-w-0 flex-col gap-6 phone:min-h-0">
      <div className="flex flex-col">
        <p className="text-caption text-secondary phone:hidden">
          Step {index + 1} of {total}
          {optional && ", optional"}
        </p>
        <h2 id={`step-${id}`} className="font-serif text-figure text-primary">
          {TITLES[id]}
        </h2>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">{children}</div>
      <div className="flex flex-col-reverse gap-2 empty:hidden md:flex-row md:justify-end">{actions}</div>
    </section>
  );
}

function FormActions({ form, done, optional, onNext }: { form: SettingsForm; done: boolean; optional: boolean; onNext: () => void }) {
  if (form.dirty)
    return (
      <>
        <Button variant="ghost" onClick={() => form.revert()} disabled={form.saving}>
          Cancel
        </Button>
        <Button variant="primary" busy={form.saving} busyLabel="Saving" onClick={() => void form.save().then((ok) => ok && onNext())}>
          Save and continue
        </Button>
      </>
    );
  if (done) return <Button variant="primary" onClick={onNext}>Continue</Button>;
  if (optional) return <Button onClick={onNext}>Skip</Button>;
  return null;
}

function FormFields({ form, keys, storage, hints }: { form: SettingsForm; keys: string[]; storage: boolean; hints?: Record<string, ReactNode> }) {
  return (
    <SettingRows>
      {keys.map((k) => {
        const f = form.fields.get(k);
        return f ? <SettingFieldRow key={k} field={f} form={form} storage={storage} hint={hints?.[k]} /> : null;
      })}
    </SettingRows>
  );
}

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-2">
      {children}
    </a>
  );
}

function SettingsStep({ o, id, frame, onNext, intro, hints, extra }: StepProps & { intro?: ReactNode; hints?: Record<string, ReactNode>; extra?: (form: SettingsForm) => ReactNode }) {
  const keys = STEP_KEYS[id] ?? [];
  const form = useSettingsForm(keys);
  const s = o.steps[id];
  return frame(
    <>
      {intro}
      {form.settings.isError ? (
        <ErrorState error={form.settings.error} onRetry={() => form.settings.refetch()} size="inline" />
      ) : !form.settings.data ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <FormFields form={form} keys={keys} storage={o.secretStorage.available} hints={hints} />
      )}
      {extra?.(form)}
      {form.problem && <Notice tone="danger">{form.problem}</Notice>}
    </>,
    <FormActions form={form} done={s.done} optional={!s.required} onNext={onNext} />,
  );
}

type StepProps = { o: Onboarding; id: OnboardingStepId; frame: (body: ReactNode, actions: ReactNode) => ReactNode; onNext: () => void; onPick: (id: OnboardingStepId) => void };

function PasskeyStep({ o, frame, onNext }: StepProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const n = o.steps.passkey.passkeys;
  const add = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await registerPasskey();
      setMessage({ tone: "info", text: "Passkey added." });
    } catch (error) {
      setMessage({ tone: "danger", text: passkeyProblem(error) });
    } finally {
      setBusy(false);
    }
  };
  return frame(
    <>
      <p className="text-body text-pretty">
        {n > 0 ? `You sign in with ${n === 1 ? "one passkey" : `${fmtInt(n)} passkeys`}. Add one on another device to sign in there too.` : "No passkey is registered yet."}
      </p>
      <Button className="self-start" busy={busy} busyLabel="Waiting for passkey" onClick={() => void add()}>
        Add a passkey
      </Button>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </>,
    o.steps.passkey.done && (
      <Button variant="primary" onClick={onNext}>
        Continue
      </Button>
    ),
  );
}

function ConnectStep({ o, frame, onNext, onPick }: StepProps) {
  const s = o.steps.spotifyConnect;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; needsApp: boolean } | null>(null);
  const connect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await connectSpotify();
    } catch (error) {
      const needsApp = error instanceof ApiError && error.code === "spotify_not_configured";
      setProblem({ text: needsApp ? "Add the Spotify client ID first." : describeError(error), needsApp });
      setBusy(false);
    }
  };
  const missing = s.done && s.missingScopes.length > 0;
  return frame(
    <>
      <p className="text-body text-pretty">
        {s.done
          ? `Connected as ${s.userId ?? "your Spotify account"}. New plays are logged as you listen.`
          : "Sign in to Spotify and allow encore to read what you play. Spotify sends you back here when you are done."}
      </p>
      {missing && <Notice tone="warning">Spotify has not granted {s.missingScopes.join(", ")}. Connect again to grant them.</Notice>}
      {(!s.done || missing) && (
        <Button variant="accent" className="self-start" busy={busy} busyLabel="Opening Spotify" onClick={() => void connect()}>
          {s.done ? "Connect again" : "Connect Spotify"}
        </Button>
      )}
      {problem && (
        <Notice
          tone="danger"
          action={
            problem.needsApp && (
              <Button size="sm" onClick={() => onPick("spotifyApp")}>
                Go to Spotify app
              </Button>
            )
          }
        >
          {problem.text}
        </Notice>
      )}
    </>,
    s.done && (
      <Button variant="primary" onClick={onNext}>
        Continue
      </Button>
    ),
  );
}

function LocaleStep(props: StepProps) {
  const s = props.o.steps.locale;
  const stored = s.playsStored;
  return (
    <SettingsStep
      {...props}
      hints={{
        timezone:
          stored > 0
            ? `Each play keeps the day and hour it was stored with. The ${fmtInt(stored)} plays stored so far keep the current zone.`
            : "Each play keeps the day and hour it was stored with, so choose this before the import.",
      }}
      extra={(form) => <DetectZone form={form} done={s.done} />}
    />
  );
}

/** Starts the time zone at the browser's zone the first time, so the common case is one click. */
function DetectZone({ form, done }: { form: SettingsForm; done: boolean }) {
  const field = form.fields.get("timezone");
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { set } = form;
  const ready = Boolean(field && !field.locked && !done && !("timezone" in form.draft) && field.value !== browserZone && field.options?.includes(browserZone));
  useEffect(() => {
    if (ready) set("timezone", browserZone);
  }, [ready, browserZone, set]);
  return null;
}

function ClaudeStep(props: StepProps) {
  return (
    <SettingsStep
      {...props}
      intro={
        <p className="text-body text-pretty">
          Sets, weekly picks, Ask, liner notes and recaps use Claude. Create a key in the <External href="https://console.anthropic.com/settings/keys">Anthropic console</External>.
        </p>
      }
      extra={(form) => <VerifyKey form={form} />}
    />
  );
}

function VerifyKey({ form }: { form: SettingsForm }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const typed = form.draft.claudeApiKey;
  const field = form.fields.get("claudeApiKey");
  if (!field || (!field.set && typeof typed !== "string")) return null;
  const verify = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await request<ClaudeKeyCheck>("/api/settings/claude/verify", { json: typeof typed === "string" && typed ? { apiKey: typed } : {} });
      setResult(r.valid ? { tone: "info", text: `The key works with ${r.model}.` } : { tone: "danger", text: r.message });
    } catch (error) {
      setResult({ tone: "danger", text: describeError(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-start gap-3">
      <Button size="sm" busy={busy} busyLabel="Checking" disabled={typed === ""} onClick={() => void verify()}>
        Check key
      </Button>
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
    </div>
  );
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function McpStep(props: StepProps) {
  const s = props.o.steps.mcp;
  return (
    <SettingsStep
      {...props}
      intro={
        <>
          <p className="text-body text-pretty">Lets an MCP client such as Claude Desktop read your listening. Give it this address and the token.</p>
          <CopyField value={s.url} label="MCP address" />
        </>
      }
      extra={(form) => <NewToken form={form} storage={props.o.secretStorage.available} locked={s.locked} />}
    />
  );
}

function NewToken({ form, storage, locked }: { form: SettingsForm; storage: boolean; locked: boolean }) {
  const typed = form.draft.mcpToken;
  if (locked) return null;
  if (typeof typed === "string" && typed.length >= 40)
    return (
      <div className="flex flex-col gap-1.5">
        <CopyField value={typed} label="New token" />
        <p className="text-caption text-secondary">Copy it now. encore does not show it again after you save.</p>
      </div>
    );
  return (
    <Button size="sm" className="self-start" disabled={!storage} onClick={() => form.set("mcpToken", randomToken())}>
      Generate a token
    </Button>
  );
}

function DiscordStep(props: StepProps) {
  return (
    <SettingsStep
      {...props}
      intro={
        <>
          <p className="text-body text-pretty">
            Run encore’s commands from Discord. In the <External href="https://discord.com/developers/applications">Discord developer portal</External>, set the
            application’s interactions endpoint to this address.
          </p>
          <CopyField value={props.o.steps.discord.interactionsUrl} label="Interactions endpoint" />
        </>
      }
      extra={() => (
        <p className="text-secondary text-pretty">Set the bot token, server and channel for posting picks and recaps in Settings, under Integrations.</p>
      )}
    />
  );
}

function SpotifyAppStep(props: StepProps) {
  return (
    <SettingsStep
      {...props}
      intro={
        <>
          <p className="text-body text-pretty">
            Create an app in the <External href="https://developer.spotify.com/dashboard">Spotify developer dashboard</External>, add this redirect URI to it, then paste its
            client ID.
          </p>
          <CopyField value={props.o.steps.spotifyApp.redirectUri} label="Redirect URI" />
        </>
      }
    />
  );
}

function ImportFrame({ o, frame, onNext }: StepProps) {
  const timezone = useTimezone();
  return frame(
    <ImportStep step={o.steps.import} timezone={timezone} />,
    o.steps.import.done && (
      <Button variant="primary" onClick={onNext}>
        Continue
      </Button>
    ),
  );
}

const STEPS: Record<OnboardingStepId, (p: StepProps) => ReactNode> = {
  passkey: PasskeyStep,
  spotifyApp: SpotifyAppStep,
  spotifyConnect: ConnectStep,
  locale: LocaleStep,
  import: ImportFrame,
  claude: ClaudeStep,
  discord: DiscordStep,
  mcp: McpStep,
};

function SetupBody({ o }: { o: Onboarding }) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const fromUrl = new URLSearchParams(search).get("step") as OnboardingStepId | null;
  const [skipped, setSkipped] = useState<Set<OnboardingStepId>>(new Set());
  const picked = fromUrl && o.order.includes(fromUrl) ? fromUrl : null;
  const setPicked = (id: OnboardingStepId) => navigate(`/setup?step=${id}`, { replace: true });
  const current = picked ?? firstOpen(o, skipped);
  const index = o.order.indexOf(current);
  const required = o.order.filter((id) => o.steps[id].required);
  const doneRequired = required.filter((id) => o.steps[id].done).length;

  const next = () => {
    const nowSkipped = new Set(skipped).add(current);
    setSkipped(nowSkipped);
    const after = o.order.slice(index + 1).find((id) => !o.steps[id].done) ?? o.order.find((id) => !o.steps[id].done && !nowSkipped.has(id));
    if (!after) {
      if (o.complete) navigate("/");
      else setPicked(firstOpen(o, nowSkipped));
      return;
    }
    setPicked(after);
  };
  const pick = (id: OnboardingStepId) => setPicked(id);
  const Step = STEPS[current];
  const frame = (body: ReactNode, actions: ReactNode) => (
    <Frame index={index} total={o.order.length} id={current} optional={!o.steps[current].required} actions={actions}>
      {body}
    </Frame>
  );

  return (
    <Page>
      <PageHeader
        title="Setup"
        description={o.complete ? undefined : `${fmtInt(doneRequired)} of ${fmtInt(required.length)} required steps done`}
        actions={
          o.complete && (
            <AppLink to="/" className={buttonClass({ variant: "secondary" })}>
              Open Overview
            </AppLink>
          )
        }
      />
      {!o.secretStorage.available && (
        <Notice tone="warning">Keys and tokens cannot be saved here until {o.secretStorage.envVar} is set on the server. Ones set as environment variables still work.</Notice>
      )}
      <div className="grid items-start gap-6 md:grid-cols-[240px_minmax(0,1fr)] md:gap-10 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="hidden md:block">
          <StepList o={o} current={current} onPick={pick} />
        </div>
        <div className="md:hidden">
          <PhoneStepMenu o={o} current={current} onPick={pick} />
        </div>
        <Step key={current} o={o} id={current} frame={frame} onNext={next} onPick={pick} />
      </div>
    </Page>
  );
}

export function Setup() {
  const q = useOnboarding();
  if (q.isError)
    return (
      <Page>
        <PageHeader title="Setup" />
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Page>
    );
  if (!q.data)
    return (
      <Page>
        <PageHeader title="Setup" />
        <div aria-busy className="grid gap-10 md:grid-cols-[240px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="hidden flex-col gap-3 md:flex">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-8 w-40" />
          </div>
        </div>
      </Page>
    );
  return <SetupBody o={q.data} />;
}
