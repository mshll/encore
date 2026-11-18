import type { ReactNode } from "react";
import { ApiError } from "../api/client";
import { useConversation } from "../api/queries";
import type { ChatOutcome, ChatTask, ChatTurn } from "../api/types";
import { AnswerView, answerFromText } from "../ui/Answer";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState, ErrorState } from "../ui/States";
import { PlanCard, PlayCard, RuleCard, SetCard } from "./Cards";
import { Thinking } from "./parts/Thinking";
import { ShareAnswer } from "./ShareAnswer";
import { threadKey, useChat } from "./state";

/** The owner's message: a soft block on the right that rises in (Beautiful UI's Chat). */
export function OwnerTurn({ text }: { text: string }) {
  return <p className="max-w-[85%] self-end rounded-xl bg-fill px-3 py-1.5 text-body text-pretty animate-[fade-up_300ms_var(--ease-out)_both]">{text}</p>;
}

function ReplyText({ text }: { text: string }) {
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
        <Button size="sm" onClick={() => chat.show({ conversation: null })}>
          New chat
        </Button>
      }
    />
  );
}

/** The trace of the run that wrote this conversation's newest turn, folded under it. */
function FinishedSteps({ conversation }: { conversation: number }) {
  const { finished, pending } = useChat();
  if (pending || !finished || finished.conversation !== threadKey(conversation)) return null;
  return <Thinking running={false} label="" steps={finished.steps} startedAt={null} seconds={finished.seconds} />;
}

/** What one turn produced. A set or plan changed again later shows its card only on its newest turn. */
function Outcome({ outcome, latest }: { outcome: ChatOutcome; latest: boolean }) {
  const reply = "reply" in outcome && outcome.reply ? <ReplyText text={outcome.reply} /> : null;
  switch (outcome.kind) {
    case "answer":
      return outcome.content || outcome.text ? (
        <AnswerView answer={outcome.content ?? answerFromText(outcome.text ?? "")} actions={<ShareAnswer threadId={outcome.threadId} turn={outcome.turn} />} />
      ) : (
        <p className="text-secondary">This answer was deleted.</p>
      );
    case "set":
      return (
        <>
          {reply}
          {outcome.changed && (latest ? <SetCard setId={outcome.setId} card={outcome.set} /> : <p className="text-caption text-secondary">Changed the set</p>)}
        </>
      );
    case "plan":
      return (
        <>
          {reply}
          {outcome.planId !== null && (latest ? <PlanCard plan={outcome.plan} /> : <p className="text-caption text-secondary">Changed the plan</p>)}
        </>
      );
    case "rule":
      return (
        <>
          {reply}
          {outcome.draftId !== null && <RuleCard draft={outcome.draft} />}
        </>
      );
    case "play":
      return (
        <>
          {reply}
          {outcome.songs.length > 0 && <PlayCard title={outcome.title} songs={outcome.songs} />}
        </>
      );
  }
}

const subjectOf = (o: ChatOutcome) => (o.kind === "set" ? `set:${o.setId}` : o.kind === "plan" && o.planId !== null ? `plan:${o.planId}` : null);

function Turns({ id }: { id: number }) {
  const q = useConversation(id);
  if (q.isError) return q.error instanceof ApiError && q.error.status === 404 ? <Missing /> : <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <ThreadSkeleton />;
  const turns = q.data.turns;
  const newest = new Map<string, number>();
  turns.forEach((t, i) => {
    const key = subjectOf(t.outcome);
    if (key) newest.set(key, i);
  });
  return (
    <ol className="flex flex-col gap-6">
      {turns.map((t: ChatTurn, i) => (
        <li key={t.id} className="flex flex-col gap-3">
          <OwnerTurn text={t.message} />
          {i === turns.length - 1 && <FinishedSteps conversation={id} />}
          <Outcome outcome={t.outcome} latest={newest.get(subjectOf(t.outcome) ?? "") === i} />
        </li>
      ))}
    </ol>
  );
}

const WORKING: Record<ChatTask, string> = {
  answer: "Answering",
  set: "Building your set",
  rule: "Drafting a playlist rule",
  plan: "Making a plan",
  play: "Picking songs",
  refine: "Making the change",
};

/** The message on its way and the run answering it: the trace, then the answer as it streams. */
function LiveTurn() {
  const { pending, run } = useChat();
  if (!pending && !run.running) return null;
  return (
    <div className="flex flex-col gap-4">
      {pending && <OwnerTurn text={pending} />}
      {run.running && <Thinking running label={run.task ? WORKING[run.task] : "Reading your message"} steps={run.steps} startedAt={run.startedAt} seconds={null} />}
      {run.task === "answer" && run.text && <AnswerView answer={answerFromText(run.text, run.visuals)} streaming={run.running} />}
    </div>
  );
}

/** Everything above the composer: the stored conversation, then what is happening now. Null while there is nothing. */
export function useMessages(): ReactNode {
  const { conversation, pending, run } = useChat();
  const live = Boolean(pending || run.running);
  if (conversation === null && !live) return null;
  return (
    <div className="flex flex-col gap-6">
      {conversation !== null && <Turns id={conversation} />}
      <LiveTurn />
    </div>
  );
}
