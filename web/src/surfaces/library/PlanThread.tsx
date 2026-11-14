import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Redirect, useLocation } from "wouter";
import { ApiError } from "../../api/client";
import { usePlanConversation } from "../../api/queries";
import type { PlanTurn } from "../../api/types";
import { useRun } from "../../lib/useRun";
import { AppLink } from "../../ui/AppLink";
import { buttonClass } from "../../ui/Button";
import { useClaudeGate } from "../../ui/ClaudeNotice";
import { Composer } from "../../ui/Composer";
import { ConversationPanel, DOCKED } from "../../ui/Conversation";
import { ChatCircleTextIcon } from "../../ui/icons";
import { Notice } from "../../ui/Notice";
import { Page, PageHeader } from "../../ui/Page";
import { RowSkeleton } from "../../ui/Rows";
import { RunProgress } from "../../ui/RunProgress";
import { EmptyState, ErrorState } from "../../ui/States";
import { CONVERSATIONS } from "./Plans";

const OWNER = "max-w-[85%] self-end rounded-lg bg-fill px-3 py-2 text-pretty";

/** The run that changes a plan by message. The page holds it, so its header can say a change is under way. Only a page with a conversation picks up a working run. */
export function usePlanTurn(planId: number | null, hasConversation: boolean) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const done = async (turn: PlanTurn) => {
    await queryClient.invalidateQueries({ queryKey: ["library"], predicate: (k) => ["conversation", "plan", "plans"].includes(String(k.queryKey[1])) });
    if (turn.planId && turn.planId !== planId) navigate(`/library/plans/${turn.planId}`);
  };
  const run = useRun<PlanTurn>(hasConversation ? { key: CONVERSATIONS, onDone: (t) => void done(t) } : undefined);
  return { run, done };
}

type PlanTurnRun = ReturnType<typeof usePlanTurn>;

/** The conversation behind a Claude plan, as the docked panel. Each message changes the same plan; the owner's unticks stay. */
export function PlanThread({
  threadId,
  planId,
  turn,
  title,
  sheet,
  flatHeader,
  className = DOCKED,
}: {
  threadId: number;
  planId: number | null;
  turn: PlanTurnRun;
  title: string;
  sheet?: { open: boolean; onOpenChange: (open: boolean) => void };
  flatHeader?: boolean;
  className?: string;
}) {
  const q = usePlanConversation(threadId);
  const { run, done } = turn;
  const gate = useClaudeGate({ needsSpotify: false });
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const send = async () => {
    const message = text.trim();
    if (!message) return;
    setSent(message);
    setStopped(false);
    setText("");
    const result = await run.start(CONVERSATIONS, { message, threadId });
    if (result) {
      setSent(null);
      await done(result);
    } else setText(message);
  };
  const cancel = () => {
    run.cancel();
    setStopped(true);
    if (sent) setText(sent);
    setSent(null);
  };
  const turns = q.data?.turns ?? [];
  const messages = q.isError ? (
    <ErrorState error={q.error} onRetry={() => q.refetch()} />
  ) : !q.data ? (
    <RowSkeleton rows={3} />
  ) : (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-4">
        {turns.map((t, i) => (
          <li key={i} className={t.role === "owner" ? OWNER : "text-pretty text-secondary"}>
            {t.text}
          </li>
        ))}
        {run.running && sent && <li className={OWNER}>{sent}</li>}
      </ol>
      {run.running && <RunProgress run={run} title="Changing the plan" />}
    </div>
  );
  return (
    <ConversationPanel
      title={title}
      sheet={sheet}
      flatHeader={flatHeader}
      className={className}
      thread={threadId}
      startAtEnd
      follow={turns.length + (run.running && sent ? 1 : 0)}
      messages={messages}
      composer={
        <>
          {run.problem && (
            <Notice tone="danger" onRetry={gate.blocked || !text.trim() ? undefined : () => void send()}>
              {run.problem}
            </Notice>
          )}
          {stopped && <p className="text-secondary">Stopped.</p>}
          <Composer
            label={planId ? "Change the plan" : "Answer"}
            placeholder={planId ? "Keep anything by…, only playlists, leave out…" : "Your answer"}
            value={text}
            onChange={setText}
            onSubmit={() => void send()}
            onStop={cancel}
            running={run.running}
            disabled={Boolean(gate.blocked)}
            notice={gate.blocked}
            footer={gate.spend}
          />
        </>
      }
    />
  );
}

/** A conversation whose first turn was Claude's question; the plan page takes over once a plan exists. */
export function PlanThreadPage({ threadId }: { threadId: number }) {
  const q = usePlanConversation(threadId);
  const missing = q.error instanceof ApiError && q.error.status === 404;
  const turn = usePlanTurn(null, !missing);
  const crumb = q.isError ? null : q.data && (q.data.turns.find((t) => t.role === "owner")?.text ?? "Plan with Claude");
  return (
    <Page width="read" crumb={crumb} className="lg:h-full lg:pb-(--gutter)">
      <PageHeader title="Plan with Claude" />
      {missing ? (
        <EmptyState
          size="page"
          icon={ChatCircleTextIcon}
          title="This conversation does not exist"
          action={
            <AppLink to="/library/plans" className={buttonClass()}>
              Back to plans
            </AppLink>
          }
        />
      ) : q.data?.planId ? (
        <Redirect to={`/library/plans/${q.data.planId}`} replace />
      ) : (
        <PlanThread threadId={threadId} planId={null} turn={turn} title="Claude asks" flatHeader={false} className="lg:min-h-0 lg:flex-1" />
      )}
    </Page>
  );
}
