import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { request } from "../../api/client";
import { useStanding, useStatus, useTimezone } from "../../api/queries";
import type { Standing } from "../../api/types";
import { fmtDate } from "../../lib/format";
import { showToast } from "../../lib/toast";
import { AppLink } from "../../ui/AppLink";
import { Button } from "../../ui/Button";
import { Confirm } from "../../ui/Dialog";
import { Input } from "../../ui/Field";
import { MenuItem, MenuPopup, MenuRoot, MoreTrigger } from "../../ui/Menu";
import { Notice } from "../../ui/Notice";
import { Section } from "../../ui/Page";
import { RowSkeleton } from "../../ui/Rows";
import { Select } from "../../ui/Select";
import { describeError, EmptyState, ErrorState } from "../../ui/States";
import { Switch } from "../../ui/Switch";
import { BlockedList } from "../BlockedList";
import { LibraryFrame } from "./LibraryFrame";

type Cadence = Standing["cadence"];
const CADENCES: { value: Cadence; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

function useStandingEdit() {
  const queryClient = useQueryClient();
  return async (path: string, init: RequestInit & { json?: unknown }) => {
    try {
      await request(path, init);
      return true;
    } catch (error) {
      showToast(describeError(error), "problem");
      return false;
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["library", "standing"] });
    }
  };
}

function detail(s: Standing, timezone: string) {
  const cadence = s.cadence === "weekly" ? "Weekly" : "Monthly";
  const due = !s.nextRunAt || Date.parse(s.nextRunAt) <= Date.now();
  const when = s.enabled ? (due ? "runs within the hour" : `next run ${fmtDate(s.nextRunAt!, timezone)}`) : "off";
  return `${cadence}, ${when}`;
}

function StandingRow({ s }: { s: Standing }) {
  const timezone = useTimezone();
  const edit = useStandingEdit();
  const [deleting, setDeleting] = useState(false);
  const path = `/api/library/standing/${s.id}`;
  const patch = (json: Partial<Standing>) => edit(path, { method: "PATCH", body: JSON.stringify(json), headers: { "content-type": "application/json" } });
  return (
    <li className="flex items-start gap-3 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-pretty text-primary">{s.instruction}</p>
        <p className="text-caption text-secondary">
          {detail(s, timezone)}
          {s.lastPlanId && (
            <>
              {", "}
              <AppLink to={`/library/plans/${s.lastPlanId}`} className="rounded-xs underline decoration-line-strong underline-offset-2 hover:text-primary hover:decoration-current">
                last plan
              </AppLink>
            </>
          )}
        </p>
        {s.lastError && <p className="text-caption text-pretty text-danger">Last run: {s.lastError}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Switch checked={s.enabled} onChange={(enabled) => void patch({ enabled })} label={`Run “${s.instruction}”`} />
        <MenuRoot>
          <MoreTrigger label={`More for “${s.instruction}”`} />
          <MenuPopup>
            {CADENCES.filter((c) => c.value !== s.cadence).map((c) => (
              <MenuItem key={c.value} onClick={() => void patch({ cadence: c.value })}>
                Run {c.label.toLowerCase()}
              </MenuItem>
            ))}
            <MenuItem danger onClick={() => setDeleting(true)}>
              Delete
            </MenuItem>
          </MenuPopup>
        </MenuRoot>
      </div>
      <Confirm
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this instruction?"
        action="Delete"
        danger
        onConfirm={() => {
          setDeleting(false);
          void edit(path, { method: "DELETE" });
        }}
      >
        Plans it already made stay.
      </Confirm>
    </li>
  );
}

function AddForm() {
  const edit = useStandingEdit();
  const [instruction, setInstruction] = useState("");
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = instruction.trim();
    if (!text) return;
    setBusy(true);
    if (await edit("/api/library/standing", { json: { instruction: text, cadence } })) setInstruction("");
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 md:flex-row md:items-center">
      <Input
        aria-label="New standing instruction"
        placeholder="Archive liked songs I haven’t played in a year"
        value={instruction}
        maxLength={2000}
        onChange={(e) => setInstruction(e.target.value)}
        className="md:flex-1"
      />
      <div className="flex gap-2">
        <Select label="How often" value={cadence} onChange={setCadence} options={CADENCES} className="flex-1 md:w-32" />
        <Button type="submit" variant="primary" disabled={!instruction.trim()} busy={busy} busyLabel="Adding">
          Add
        </Button>
      </div>
    </form>
  );
}

/** Standing instructions (Claude plans on a schedule, off until switched on) and what is kept out of picks and sets. */
export function LibraryInstructions() {
  const q = useStanding();
  const scheduled = useStatus().data?.llm.schedule.enabled;
  return (
    <LibraryFrame width="read">
      <Section
        title="Standing instructions"
        description="Claude makes a plan on this schedule for you to review. Nothing is applied on its own, and each run counts toward the monthly Claude budget."
        labelledBy="standing"
      >
        {scheduled === false && <Notice tone="warning">Scheduled jobs are off on this server, so these instructions do not run.</Notice>}
        <AddForm />
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <RowSkeleton rows={2} />
        ) : q.data.items.length === 0 ? (
          <EmptyState size="inline" title="No standing instructions" />
        ) : (
          <ul className="flex flex-col">
            {q.data.items.map((s) => (
              <StandingRow key={s.id} s={s} />
            ))}
          </ul>
        )}
      </Section>
      <BlockedList />
    </LibraryFrame>
  );
}
