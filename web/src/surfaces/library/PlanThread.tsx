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
import { Conversation } from "../../ui/Conversation";
import { ChatCircleTextIcon } from "../../ui/icons";
import { Notice } from "../../ui/Notice";
import { Page, PageHeader } from "../../ui/Page";
import { RowSkeleton } from "../../ui/Rows";
import { RunProgress } from "../../ui/RunProgress";
import { EmptyState, ErrorState } from "../../ui/States";
import { CONVERSATIONS } from "./Plans";

const OWNER = "max-w-[85%] self-end rounded-lg bg-fill px-3 py-2 text-pretty";

/** The conversation behind a Claude plan. Each message changes the same plan; the owner's unticks stay. */
export function PlanThread({ threadId, planId, contained }: { threadId: number; planId: number | null; contained: boolean }) {
  const q = usePlanConversation(threadId);
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const gate = useClaudeGate({ needsSpotify: false });
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const done = async (turn: PlanTurn) => {
    setSent(null);
    await queryClient.invalidateQueries({ queryKey: ["library"], predicate: (k) => ["conversation", "plan", "plans"].includes(String(k.queryKey[1])) });
    if (turn.planId && turn.planId !== planId) navigate(`/library/plans/${turn.planId}`);
  };
  const run = useRun<PlanTurn>({ key: CONVERSATIONS, onDone: (t) => void done(t) });
  const send = async () => {
    const message = text.trim();
    if (!message) return;
    setSent(message);
    setStopped(false);
    setText("");
    const turn = await run.start(CONVERSATIONS, { message, threadId });
    if (turn) await done(turn);
    else setText(message);
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
    <Conversation
      contained={contained}
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
  return (
    <Page width="read">
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
        <PlanThread threadId={threadId} planId={null} contained={false} />
      )}
    </Page>
  );
}
