import type { ReactNode } from "react";
import { ApiError } from "../api/client";
import { useAskThread, usePlanConversation, usePlans, useSet } from "../api/queries";
import type { SetChange, SetDetail } from "../api/types";
import { fmtInt } from "../lib/format";
import { AnswerView, answerFromText } from "../ui/Answer";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { CaretRightIcon } from "../ui/icons";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState, ErrorState } from "../ui/States";
import { Thinking } from "./parts/Thinking";
import { threadKey, useChat, type ChatThread } from "./state";

/** The owner's message: a soft block on the right that rises in (Beautiful UI's Chat). */
export function OwnerTurn({ text }: { text: string }) {
  return <p className="max-w-[85%] self-end rounded-xl bg-fill px-3 py-1.5 text-body text-pretty animate-[fade-up_300ms_var(--ease-out)_both]">{text}</p>;
}

function ClaudeText({ text }: { text: string }) {
  return <p className="text-body text-pretty">{text}</p>;
}

function ThreadSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <Skeleton className="h-9 w-2/3 self-end" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}

function Missing() {
  const chat = useChat();
  return (
    <EmptyState
      size="inline"
      title="This conversation does not exist"
      action={
        <Button size="sm" onClick={() => chat.show({ thread: null })}>
          New chat
        </Button>
      }
    />
  );
}

const missing = (error: unknown) => error instanceof ApiError && error.status === 404;

/** The trace of the run that wrote this thread's newest turn, folded under it. */
function FinishedSteps({ thread }: { thread: ChatThread }) {
  const { finished, pending } = useChat();
  if (pending || !finished || finished.thread !== threadKey(thread)) return null;
  return <Thinking running={false} label="" steps={finished.steps} startedAt={null} seconds={finished.seconds} />;
}

function AskTurns({ id }: { id: number }) {
  const q = useAskThread(id);
  if (q.isError) return missing(q.error) ? <Missing /> : <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <ThreadSkeleton />;
  const lastAnswer = q.data.turns.findLastIndex((t) => t.role === "assistant");
  return (
    <ol className="flex flex-col gap-6">
      {q.data.turns.map((t, i) => (
        <li key={i} className="flex flex-col gap-3">
          {t.role === "owner" ? (
            <OwnerTurn text={t.text} />
          ) : (
            <>
              {i === lastAnswer && <FinishedSteps thread={{ kind: "ask", id }} />}
              <AnswerView answer={t.content ?? answerFromText(t.text)} />
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

const names = (tracks: { name: string }[]) => tracks.map((t) => t.name).join(", ");

function changeLines(change: SetChange): string[] {
  if (change.source === "owner") return change.removed.length ? [`You removed ${names(change.removed)}.`] : [];
  const lines = [
    change.added.length > 0 && `Added ${names(change.added)}.`,
    change.removed.length > 0 && `Removed ${names(change.removed)}.`,
    change.moved.length > 0 && `Moved ${change.moved.map((m) => `${m.name} from ${m.from} to ${m.to}`).join(", ")}.`,
  ].filter((l): l is string => Boolean(l));
  return lines.length ? lines : ["Same songs, new order or reasons."];
}

type Entry = { kind: "turn"; role: "owner" | "assistant"; text: string } | { kind: "change"; change: SetChange };

/** The conversation with each version change placed after the message that asked for it; owner edits in order. */
function timeline(set: SetDetail): Entry[] {
  const pending = [...set.changes];
  const out: Entry[] = [];
  const flushOwnerBefore = (version: number) => {
    while (pending[0] && pending[0].source === "owner" && pending[0].version < version) out.push({ kind: "change", change: pending.shift()! });
  };
  set.conversation.forEach((turn, i) => {
    const at = turn.role === "owner" && i > 0 ? pending.findIndex((c) => c.source === "claude" && c.message === turn.text) : -1;
    if (at >= 0) flushOwnerBefore(pending[at]!.version);
    out.push({ kind: "turn", role: turn.role, text: turn.text });
    const idx = turn.role === "owner" && i > 0 ? pending.findIndex((c) => c.source === "claude" && c.message === turn.text) : -1;
    if (idx >= 0) out.push({ kind: "change", change: pending.splice(idx, 1)[0]! });
  });
  for (const change of pending) out.push({ kind: "change", change });
  return out;
}

/** A result in the conversation: one row that opens its own page (Beautiful UI's Task Rows, completed). */
function ResultRow({ to, art, title, detail }: { to: string; art?: ReactNode; title: string; detail: string }) {
  const { leave } = useChat();
  return (
    <AppLink
      to={to}
      onClick={leave}
      className="press -mx-2 flex min-h-(--row-h) items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-150 animate-[fade-up_450ms_var(--ease-out)_both] hover:bg-fill"
    >
      {art}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-primary">{title}</span>
        <span className="truncate text-caption text-secondary tabular">{detail}</span>
      </span>
      <Icon icon={CaretRightIcon} className="text-tertiary" />
    </AppLink>
  );
}

function SetTurns({ id }: { id: number }) {
  const q = useSet(id);
  if (q.isError) return missing(q.error) ? <Missing /> : <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <ThreadSkeleton />;
  const set = q.data;
  const entries = timeline(set);
  const lastTurn = entries.findLastIndex((e) => e.kind === "turn" && e.role === "assistant");
  const replied = lastTurn > entries.findLastIndex((e) => e.kind === "turn" && e.role === "owner");
  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-4">
        {entries.map((e, i) =>
          e.kind === "change" ? (
            <li key={`c${e.change.version}`} className="flex flex-col gap-0.5 text-caption text-secondary">
              <span className="font-medium text-primary">Version {e.change.version}</span>
              {changeLines(e.change).map((l) => (
                <span key={l} className="text-pretty">
                  {l}
                </span>
              ))}
            </li>
          ) : (
            <li key={i} className="flex flex-col gap-3">
              {e.role === "owner" ? (
                <OwnerTurn text={e.text} />
              ) : (
                <>
                  {replied && i === lastTurn && <FinishedSteps thread={{ kind: "set", id }} />}
                  <ClaudeText text={e.text} />
                </>
              )}
            </li>
          ),
        )}
      </ol>
      {!replied && <FinishedSteps thread={{ kind: "set", id }} />}
      {set.version > 0 && (
        <ResultRow
          to={`/sets/${set.id}`}
          art={<Artwork src={set.coverUrl} kind="playlist" box={40} />}
          title={set.title}
          detail={`${fmtInt(set.items.length)} songs · version ${fmtInt(set.version)}`}
        />
      )}
    </div>
  );
}

function PlanResult({ planId }: { planId: number }) {
  const plans = usePlans();
  const plan = plans.data?.items.find((p) => p.id === planId);
  if (!plan) return plans.isError ? null : <Skeleton className="h-11 w-full" />;
  const detail =
    plan.status === "applied" ? "Applied" : plan.status === "dismissed" ? "Dismissed" : `${fmtInt(plan.counts.open)} ${plan.counts.open === 1 ? "song" : "songs"} to review`;
  return <ResultRow to={`/library/plans/${plan.id}`} title={plan.title} detail={detail} />;
}

function PlanTurns({ threadId }: { threadId: number }) {
  const q = usePlanConversation(threadId);
  if (q.isError) return missing(q.error) ? <Missing /> : <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <ThreadSkeleton />;
  const lastTurn = q.data.turns.findLastIndex((t) => t.role === "assistant");
  const replied = lastTurn > q.data.turns.findLastIndex((t) => t.role === "owner");
  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-4">
        {q.data.turns.map((t, i) => (
          <li key={i} className="flex flex-col gap-3">
            {t.role === "owner" ? (
              <OwnerTurn text={t.text} />
            ) : (
              <>
                {replied && i === lastTurn && <FinishedSteps thread={{ kind: "plan", threadId }} />}
                <ClaudeText text={t.text} />
              </>
            )}
          </li>
        ))}
      </ol>
      {!replied && <FinishedSteps thread={{ kind: "plan", threadId }} />}
      {q.data.planId && <PlanResult planId={q.data.planId} />}
    </div>
  );
}

const WORKING: Record<string, string> = { ask: "Answering", "set-new": "Building your set", set: "Changing the set", "tidy-new": "Making a plan", tidy: "Changing the plan" };

/** The message on its way and the run answering it: the trace, then the answer as it streams. */
function LiveTurn() {
  const { pending, run, mode, thread } = useChat();
  if (!pending && !run.running) return null;
  const label = WORKING[mode === "ask" || thread ? mode : `${mode}-new`] ?? "Working";
  return (
    <div className="flex flex-col gap-4">
      {pending && <OwnerTurn text={pending} />}
      {run.running && <Thinking running label={label} steps={run.steps} startedAt={run.startedAt} seconds={null} />}
      {mode === "ask" && run.text && <AnswerView answer={answerFromText(run.text, run.visuals)} streaming={run.running} />}
    </div>
  );
}

/** Everything above the composer: the stored conversation, then what is happening now. Null while there is nothing. */
export function useMessages(): ReactNode {
  const { thread, pending, run } = useChat();
  const live = Boolean(pending || run.running);
  if (!thread && !live) return null;
  return (
    <div className="flex flex-col gap-6">
      {thread?.kind === "ask" && <AskTurns id={thread.id} />}
      {thread?.kind === "set" && <SetTurns id={thread.id} />}
      {thread?.kind === "plan" && <PlanTurns threadId={thread.threadId} />}
      <LiveTurn />
    </div>
  );
}
