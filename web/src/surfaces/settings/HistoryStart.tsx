import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, get, request } from "../../api/client";
import { useSettings, useTimezone } from "../../api/queries";
import type { HistoryStartResult, PlaysBefore, SettingIssue, SettingsPatchResult } from "../../api/types";
import { todayIn } from "../../lib/dates";
import { fmtDay, fmtInt } from "../../lib/format";
import { settingLabel } from "../../lib/settingLabels";
import { showToast } from "../../lib/toast";
import { Button } from "../../ui/Button";
import { Confirm } from "../../ui/Dialog";
import { Input } from "../../ui/Field";
import { Section } from "../../ui/Page";
import { SettingRow, SettingRows } from "../../ui/SettingRow";
import { describeError } from "../../ui/States";
import { displayValue, fieldsByKey } from "./form";

const plays = (n: number) => `${fmtInt(n)} ${n === 1 ? "play" : "plays"}`;

type Problem = { text: string; badDate: boolean };

function problemOf(error: unknown): Problem {
  if (error instanceof ApiError) {
    if (error.code === "snapshot_failed") return { text: "Could not back up the database, so nothing was deleted.", badDate: false };
    const issue = error.code === "invalid_settings" && Array.isArray(error.details) ? (error.details as unknown as SettingIssue[])[0] : undefined;
    if (issue) return { text: issue.message.charAt(0).toUpperCase() + issue.message.slice(1).replace(/\.?$/, "."), badDate: issue.reason === "invalid" };
    if (error.code === "invalid_request") return { text: "Enter a full date.", badDate: true };
  }
  return { text: describeError(error), badDate: false };
}

const playsBefore = (day: string) => get<PlaysBefore>("/api/settings/history-start", { before: day });

/** The day stored history starts: saving it deletes the plays before it, after a confirmation with the real numbers. */
export function HistoryStart() {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const timezone = useTimezone();
  const field = fieldsByKey(settings.data).get("historyStart");
  const saved = typeof field?.value === "string" ? field.value : null;
  const [draft, setDraft] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ day: string; before: PlaysBefore } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const day = draft ?? saved ?? "";
  const leftover = useQuery({ queryKey: ["history-start", saved], queryFn: () => playsBefore(saved!), enabled: saved !== null });

  const apply = useMutation({
    mutationFn: (start: string) => request<HistoryStartResult>("/api/settings/history-start", { json: { historyStart: start } }),
    onSuccess: ({ removed, snapshot: _snapshot, ...fresh }, start) => {
      queryClient.setQueryData(["settings"], fresh);
      setConfirm(null);
      setDraft(null);
      showToast(removed.plays > 0 ? `Deleted ${plays(removed.plays)}` : `Saved. No plays before ${fmtDay(start)}.`);
      void queryClient.invalidateQueries();
    },
    onError: (error) => {
      setConfirm(null);
      setProblem(problemOf(error));
    },
  });
  const check = useMutation({
    mutationFn: playsBefore,
    onSuccess: (before, start) => (before.plays > 0 ? setConfirm({ day: start, before }) : apply.mutate(start)),
    onError: (error) => setProblem(problemOf(error)),
  });
  const clear = useMutation({
    mutationFn: () => request<SettingsPatchResult>("/api/settings", { method: "PATCH", json: { historyStart: null } }),
    onSuccess: ({ changed: _changed, effects: _effects, ...fresh }) => {
      queryClient.setQueryData(["settings"], fresh);
      setDraft(null);
      showToast("Cleared. Import your Spotify export again to get earlier plays back.");
    },
    onError: (error) => setProblem(problemOf(error)),
  });

  if (!field) return null;
  const label = settingLabel(field.key);
  const busy = check.isPending || apply.isPending;
  const removable = (leftover.data?.plays ?? 0) > 0;
  const canApply = day !== "" && (day !== saved || removable);
  const start = () => {
    setProblem(null);
    check.mutate(day);
  };
  const dialog = confirm && (
    <Confirm
      open
      onOpenChange={(open) => !open && setConfirm(null)}
      title={`Delete plays before ${fmtDay(confirm.day)}?`}
      action={`Delete ${plays(confirm.before.plays)}`}
      danger
      busy={apply.isPending}
      onConfirm={() => apply.mutate(confirm.day)}
    >
      {plays(confirm.before.plays)} from {fmtDay(confirm.before.firstDay!)} to {fmtDay(confirm.before.lastDay!)} will be deleted. To get them back,{" "}
      {field.locked ? `remove ${field.env} from the server` : "clear this date"} and import your Spotify export again.
    </Confirm>
  );

  return (
    <Section title="History">
      <SettingRows>
        {field.locked ? (
          <SettingRow label={label} hint={`Set by ${field.env} on the server.`} error={problem?.text}>
            {(control) => (
              <div className="flex min-h-(--control-h) flex-wrap items-center justify-between gap-x-3 gap-y-1 md:justify-end">
                <span id={control.id} className="text-primary">
                  {displayValue(field)}
                </span>
                {removable && (
                  <Button size="sm" busy={busy} busyLabel="Checking" onClick={start}>
                    Delete earlier plays
                  </Button>
                )}
              </div>
            )}
          </SettingRow>
        ) : (
          <SettingRow label={label} error={problem?.text}>
            {(control) => (
              <div className="flex items-center gap-2">
                <Input
                  {...control}
                  invalid={problem?.badDate ?? false}
                  type="date"
                  max={todayIn(timezone)}
                  value={day}
                  onChange={(e) => {
                    setProblem(null);
                    setDraft(e.target.value);
                  }}
                  className="flex-1"
                />
                {canApply ? (
                  <Button busy={busy} busyLabel="Checking" onClick={start}>
                    Apply
                  </Button>
                ) : (
                  saved && (
                    <Button variant="ghost" busy={clear.isPending} busyLabel="Clearing" onClick={() => clear.mutate()}>
                      Clear
                    </Button>
                  )
                )}
              </div>
            )}
          </SettingRow>
        )}
      </SettingRows>
      {dialog}
    </Section>
  );
}
