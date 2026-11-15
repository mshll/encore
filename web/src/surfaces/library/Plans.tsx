import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { request } from "../../api/client";
import { useBatches, usePlans, useStatus } from "../../api/queries";
import type { PlanSummary } from "../../api/types";
import { useChat } from "../../chat/state";
import { fmtAgo, fmtInt } from "../../lib/format";
import { showToast } from "../../lib/toast";
import { AppLink } from "../../ui/AppLink";
import { Button, buttonClass } from "../../ui/Button";
import { ChatCircleTextIcon } from "../../ui/icons";
import { Notice } from "../../ui/Notice";
import { Section } from "../../ui/Page";
import { RowList, RowSkeleton } from "../../ui/Rows";
import { describeError, EmptyState, ErrorState } from "../../ui/States";
import { BatchStatus, useBatchEndings, useUndo } from "./batch";
import { LibraryFrame } from "./LibraryFrame";
import { FigureRow } from "./rows";
import { SOURCE_LABEL, songs } from "./words";

function planLine(p: PlanSummary): string {
  if (p.runningBatchId) return "Applying now";
  const ticked = p.counts.selected < p.counts.open ? `, ${fmtInt(p.counts.selected)} ticked` : "";
  return `${SOURCE_LABEL[p.source]}${ticked}${p.source === "rule" ? "" : `, ${fmtAgo(p.updatedAt)}`}`;
}

function OpenPlans({ plans }: { plans: PlanSummary[] }) {
  const chat = useChat();
  const open = plans.filter((p) => p.status === "open" && (p.source !== "rule" || p.counts.open > 0));
  return (
    <Section
      title="To review"
      labelledBy="open-plans"
      actions={
        <Button size="sm" icon={ChatCircleTextIcon} onClick={() => chat.show({ thread: null, mode: "tidy" })}>
          Plan with Claude
        </Button>
      }
    >
      {open.length === 0 ? (
        <EmptyState size="inline" title="Nothing to review" description="Make a plan from a figure on the overview, or plan with Claude." />
      ) : (
        <RowList label="Plans to review">
          {open.map((p) => (
            <FigureRow key={p.id} to={`/library/plans/${p.id}`} title={p.title} subtitle={planLine(p)} value={songs(p.counts.open)} />
          ))}
        </RowList>
      )}
    </Section>
  );
}

const BATCHES_SHOWN = 8;

function Applied() {
  const q = useBatches();
  const { undo, pending } = useUndo();
  const [all, setAll] = useState(false);
  useBatchEndings(q.data?.items, (id) => void undo(id));
  const items = q.data?.items ?? [];
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (items.length === 0) return null;
  return (
    <Section title="Applied" labelledBy="applied">
      <ul className="flex flex-col gap-6">
        {(all ? items : items.slice(0, BATCHES_SHOWN)).map((b) => (
          <li key={b.id} className="flex flex-col gap-1">
            {b.planId ? (
              <AppLink to={`/library/plans/${b.planId}`} className="w-fit max-w-full truncate rounded-xs font-medium text-primary hover:underline">
                {b.planTitle ?? "Plan"}
              </AppLink>
            ) : (
              <span className="font-medium text-primary">{b.planTitle ?? "Plan"}</span>
            )}
            <BatchStatus batch={b} onUndo={() => void undo(b.id)} undoing={pending === b.id} />
          </li>
        ))}
      </ul>
      {!all && items.length > BATCHES_SHOWN && (
        <Button className="self-start" onClick={() => setAll(true)}>
          Show all {fmtInt(items.length)}
        </Button>
      )}
    </Section>
  );
}

function Dismissed({ plans }: { plans: PlanSummary[] }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<number | null>(null);
  const dismissed = plans.filter((p) => p.status === "dismissed");
  if (dismissed.length === 0) return null;
  const restore = async (p: PlanSummary) => {
    setPending(p.id);
    try {
      await request(`/api/library/plans/${p.id}/restore`, { json: {} });
      await queryClient.invalidateQueries({ queryKey: ["library", "plans"] });
    } catch (error) {
      showToast(describeError(error), "problem");
    } finally {
      setPending(null);
    }
  };
  return (
    <Section title="Dismissed" labelledBy="dismissed">
      <ul className="flex flex-col">
        {dismissed.map((p) => (
          <li key={p.id} className="flex min-h-(--row-h) items-center justify-between gap-3">
            <span className="flex min-w-0 flex-col">
              <AppLink to={`/library/plans/${p.id}`} className="truncate rounded-xs text-primary hover:underline">
                {p.title}
              </AppLink>
              <span className="truncate text-caption text-secondary">
                {SOURCE_LABEL[p.source]}, {fmtAgo(p.updatedAt)}
              </span>
            </span>
            <Button size="sm" variant="ghost" busy={pending === p.id} busyLabel="Restoring" onClick={() => void restore(p)}>
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Plans waiting for review (Claude makes a new one in the chat), applied changes with undo, and dismissed plans. */
export function LibraryPlans() {
  const q = usePlans();
  const status = useStatus().data;
  return (
    <LibraryFrame>
      {status && !status.spotify.connected && (
        <Notice
          tone="warning"
          action={
            <AppLink to="/settings/spotify" className={buttonClass({ size: "sm" })}>
              Connect Spotify
            </AppLink>
          }
        >
          Spotify is not connected, so plans cannot be applied.
        </Notice>
      )}
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <RowSkeleton rows={5} />
      ) : (
        <>
          <OpenPlans plans={q.data.items} />
          <Applied />
          <Dismissed plans={q.data.items} />
        </>
      )}
    </LibraryFrame>
  );
}
