import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, request } from "../../api/client";
import { useAlerts, useTimezone } from "../../api/queries";
import type { AlertChannel, AlertTest } from "../../api/types";
import { fmtTimestamp } from "../../lib/format";
import { Button } from "../../ui/Button";
import { Notice } from "../../ui/Notice";
import { Section } from "../../ui/Page";
import { describeError } from "../../ui/States";
import { SettingsBlock, useSettingsForm } from "./form";

const NTFY_KEYS = ["alertNtfyUrl", "alertNtfyTopic", "alertNtfyToken"];
const DISCORD_KEYS = ["alertDiscordWebhookUrl", "alertDiscordChannel"];
const WHEN_KEYS = ["alertPollStaleHours"];
export const ALERT_SECRET_KEYS = ["alertNtfyTopic", "alertNtfyToken", "alertDiscordWebhookUrl"];

const CHANNEL_LABELS: Record<AlertChannel, string> = { ntfy: "ntfy", discord_webhook: "Discord webhook", discord_channel: "Discord channel" };

function OpenAlerts() {
  const alerts = useAlerts();
  const timezone = useTimezone();
  const open = alerts.data?.open ?? [];
  if (open.length === 0) return null;
  return (
    <Section title="Open now">
      <ul className="flex flex-col">
        {open.map((incident) => (
          <li key={incident.key} className="flex min-h-(--row-h) items-center justify-between gap-4">
            <span className="min-w-0 truncate text-primary">{incident.title}</span>
            <span className="shrink-0 text-secondary tabular">Since {fmtTimestamp(incident.since, timezone, false)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function SendTest({ disabled }: { disabled: boolean }) {
  const [result, setResult] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const send = useMutation({
    mutationFn: () => request<AlertTest>("/api/alerts/test", { method: "POST" }),
    onSuccess: ({ results }) => {
      const failed = results.filter((r) => !r.ok);
      setResult(
        failed.length === 0
          ? { tone: "info", text: `Sent to ${results.map((r) => CHANNEL_LABELS[r.channel]).join(" and ")}.` }
          : { tone: "danger", text: failed.map((r) => `${CHANNEL_LABELS[r.channel]}: ${r.error ?? "not sent"}.`).join(" ") },
      );
    },
    onError: (e) =>
      setResult({ tone: "danger", text: e instanceof ApiError && e.code === "alerts_not_configured" ? "Add an ntfy topic or a Discord channel first." : describeError(e) }),
  });
  return (
    <div className="flex flex-col gap-3">
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
      <Button className="self-start" disabled={disabled} busy={send.isPending} busyLabel="Sending" onClick={() => send.mutate()}>
        Send test alert
      </Button>
    </div>
  );
}

export function AlertsTab() {
  const ntfy = useSettingsForm(NTFY_KEYS);
  const discord = useSettingsForm(DISCORD_KEYS);
  const when = useSettingsForm(WHEN_KEYS);
  const storage = ntfy.settings.data?.secretStorage.available ?? true;
  const editing = ntfy.dirty || discord.dirty;
  return (
    <>
      <OpenAlerts />
      <SettingsBlock title="ntfy" keys={NTFY_KEYS} form={ntfy} storage={storage} />
      <SettingsBlock title="Discord" keys={DISCORD_KEYS} form={discord} storage={storage} />
      <SendTest disabled={editing} />
      <SettingsBlock
        title="When to alert"
        description="Also when Spotify sign-in fails, a Spotify quota runs out, a backup fails or the monthly AI budget is spent."
        keys={WHEN_KEYS}
        form={when}
      />
    </>
  );
}
