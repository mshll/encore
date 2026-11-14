import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearchParams } from "wouter";
import { ApiError, request } from "../api/client";
import { useAskThread, useAskThreads, useLifetime } from "../api/queries";
import type { AskResult, AskTurn } from "../api/types";
import { assistantProblem } from "../lib/assistant";
import { fmtAgo } from "../lib/format";
import { useAskStarters } from "../lib/prompts";
import { showToast } from "../lib/toast";
import { useRun } from "../lib/useRun";
import { AppLink } from "../ui/AppLink";
import { buttonClass } from "../ui/Button";
import { useClaudeGate } from "../ui/ClaudeNotice";
import { Composer } from "../ui/Composer";
import { ConversationPanel, DOCKED, useDocked } from "../ui/Conversation";
import { cx } from "../ui/cx";
import { Confirm } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { CaretRightIcon, ChatCircleTextIcon, PlusIcon, TrashIcon, WaveformIcon } from "../ui/icons";
import { MenuItem, MenuPopup, MenuRoot, MoreTrigger } from "../ui/Menu";
import { Page, PageHeader } from "../ui/Page";
import { RowSkeleton } from "../ui/Rows";
import { RunProgress } from "../ui/RunProgress";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState, ErrorState, FirstUseState } from "../ui/States";
import { Notice } from "../ui/Notice";

/** Splits an answer into paragraphs and its closing "Based on:" line. */
function splitAnswer(text: string) {
  const at = text.lastIndexOf("Based on");
  const body = at > 0 ? text.slice(0, at) : text;
  const basis = at > 0 ? text.slice(at).replace(/^Based on:?\s*/, "") : null;
  return {
    paragraphs: body
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean),
    basis,
  };
}

function Answer({ text }: { text: string }) {
  const { paragraphs, basis } = splitAnswer(text);
  return (
    <div className="space-y-3">
      {paragraphs.map((p, i) => (
        <p key={i} className="text-body text-pretty">
          {p}
        </p>
      ))}
      {basis && (
        <details className="group text-caption text-secondary">
          <summary className="-my-2 flex w-fit cursor-pointer py-2 phone:-my-3 phone:py-3 list-none items-center gap-1 rounded-xs hover:text-primary [&::-webkit-details-marker]:hidden">
            Based on
            <Icon icon={CaretRightIcon} className="transition-transform duration-150 group-open:rotate-90" />
          </summary>
          <p className="mt-1 max-w-[60ch] text-pretty">{basis}</p>
        </details>
      )}
    </div>
  );
}

function Question({ text }: { text: string }) {
  return <p className="max-w-[85%] self-end rounded-lg bg-fill px-3 py-2 text-body text-pretty">{text}</p>;
}

/** The steps of the run that wrote the newest answer, folded away (Customer.io's "Thought for"). */
function RunSteps({ steps, seconds }: { steps: string[]; seconds: number | null }) {
  if (steps.length === 0) return null;
  return (
    <details className="group text-caption text-secondary">
      <summary className="-my-2 flex w-fit cursor-pointer py-2 phone:-my-3 phone:py-3 list-none items-center gap-1 rounded-xs hover:text-primary [&::-webkit-details-marker]:hidden">
        {seconds !== null ? `Worked for ${seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`}` : `${steps.length} steps`}
        <Icon icon={CaretRightIcon} className="transition-transform duration-150 group-open:rotate-90" />
      </summary>
      <ol className="mt-2 flex flex-col gap-1 pl-1">
        {steps.map((s, i) => (
          <li key={i} className="text-pretty">
            {s}
          </li>
        ))}
      </ol>
    </details>
  );
}

function Turns({ turns, lastSteps }: { turns: AskTurn[]; lastSteps: ReactNode }) {
  const lastAnswer = turns.findLastIndex((t) => t.role === "assistant");
  return (
    <ol className="flex flex-col gap-6">
      {turns.map((t, i) => (
        <li key={i} className={cx("flex flex-col gap-3", t.role === "owner" && "items-end")}>
          {t.role === "owner" ? (
            <Question text={t.text} />
          ) : (
            <>
              {i === lastAnswer && lastSteps}
              <Answer text={t.text} />
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

function ThreadList({ activeId }: { activeId: number | null }) {
  const threads = useAskThreads();
  if (threads.isError) return <ErrorState size="inline" error={threads.error} onRetry={() => threads.refetch()} title="Could not load your questions" />;
  if (!threads.data) return <RowSkeleton rows={4} />;
  if (threads.data.items.length === 0) return <p className="text-secondary">Questions you ask stay here.</p>;
  return (
    <ul className="flex flex-col">
      {threads.data.items.map((t) => (
        <li key={t.id}>
          <AppLink
            to={`/ask/${t.id}`}
            aria-current={t.id === activeId ? "page" : undefined}
            className={cx("-mx-2 flex flex-col rounded-md px-2 py-2 transition-colors duration-150", t.id === activeId ? "bg-fill-active" : "hover:bg-fill")}
          >
            <span className="truncate text-primary">{t.title}</span>
            <span className="text-caption text-secondary">{fmtAgo(t.updatedAt)}</span>
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

function DeleteThread({ id, title }: { id: number; title: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const remove = async () => {
    setBusy(true);
    try {
      await request(`/api/ask/threads/${id}`, { method: "DELETE" });
      queryClient.removeQueries({ queryKey: ["ask", "threads", id] });
      await queryClient.invalidateQueries({ queryKey: ["ask", "threads"], exact: true });
      navigate("/ask");
    } catch (error) {
      showToast(assistantProblem(error), "problem");
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };
  return (
    <>
      <MenuRoot>
        <MoreTrigger label="More for this question" size="md" />
        <MenuPopup>
          <MenuItem icon={TrashIcon} danger onClick={() => setOpen(true)}>
            Delete question
          </MenuItem>
        </MenuPopup>
      </MenuRoot>
      <Confirm open={open} onOpenChange={setOpen} title={`Delete “${title}”?`} action="Delete" danger busy={busy} onConfirm={remove}>
        The question and its answers are deleted.
      </Confirm>
    </>
  );
}

/** Ask: a question about the owner's listening, answered from their history. One page for new questions and threads. */
export function Ask({ id }: { id?: string }) {
  const threadId = id ? Number(id) : null;
  const [params, setParams] = useSearchParams();
  const [, navigate] = useLocation();
  const docked = useDocked();
  const thread = useAskThread(threadId);
  const lifetime = useLifetime();
  const starters = useAskStarters();
  const gate = useClaudeGate({ needsSpotify: false });
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [finished, setFinished] = useState<{ thread: number; steps: string[]; seconds: number | null } | null>(null);

  const run = useRun<AskResult>({ key: "/api/ask", onDone: (result) => void finish(result) });
  const runRef = useRef(run);
  runRef.current = run;

  const finish = async (result: AskResult) => {
    const { steps, startedAt } = runRef.current;
    await queryClient.invalidateQueries({ queryKey: ["ask"] });
    setFinished({ thread: result.threadId, steps, seconds: startedAt ? Math.round((Date.now() - startedAt) / 1000) : null });
    if (result.threadId !== threadId) navigate(`/ask/${result.threadId}`);
  };

  const ask = async (question: string) => {
    setPending(question);
    setStopped(false);
    setFinished(null);
    setText("");
    const result = await run.start("/api/ask", threadId ? { question, threadId } : { question });
    setPending(null);
    if (result) await finish(result);
    else setText(question);
  };

  const fromPalette = params.get("q");
  const askedFromPalette = useRef(false);
  useEffect(() => {
    if (!fromPalette || askedFromPalette.current || !gate.ready) return;
    // Deferred so a mount React StrictMode tears down at once never starts, and so never abandons, a paid run.
    const timer = setTimeout(() => {
      askedFromPalette.current = true;
      setParams({}, { replace: true });
      if (gate.blocked) setText(fromPalette);
      else void ask(fromPalette);
    });
    return () => clearTimeout(timer);
  });

  const firstUse = lifetime.data !== undefined && !lifetime.data.firstPlayed;
  const turns = thread.data?.turns ?? [];
  const showStarters = threadId === null && !pending && !run.running && starters.length > 0 && !gate.blocked;
  const missing = thread.error instanceof ApiError && thread.error.status === 404;

  const cancel = () => {
    run.cancel();
    setStopped(true);
    if (pending) setText(pending);
    setPending(null);
  };

  const threadBody =
    threadId === null ? null : thread.isError ? (
      <ErrorState error={thread.error} onRetry={() => thread.refetch()} />
    ) : !thread.data ? (
      <div aria-hidden className="flex flex-col gap-3">
        <Skeleton className="h-9 w-2/3 self-end" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    ) : (
      <Turns turns={turns} lastSteps={finished?.thread === threadId && !pending ? <RunSteps steps={finished.steps} seconds={finished.seconds} /> : null} />
    );

  const live = pending || run.running;
  const messages = (threadBody || live) && (
    <div className="flex flex-col gap-8">
      {threadBody}
      {live && (
        <div className="flex flex-col gap-5">
          {pending && <Question text={pending} />}
          <RunProgress run={run} title="Answering" />
          {run.text && <Answer text={run.text} />}
        </div>
      )}
    </div>
  );

  const composer = (
    <>
      {run.problem && (
        <Notice tone="danger" onRetry={gate.blocked || !text.trim() ? undefined : () => ask(text.trim())}>
          {run.problem}
        </Notice>
      )}
      {stopped && <p className="text-secondary">Stopped.</p>}
      <Composer
        label={threadId ? "Ask a follow-up" : "Ask about your listening"}
        placeholder={threadId ? "Ask a follow-up" : "Why did I stop playing…, what do I play when…"}
        value={text}
        onChange={setText}
        onSubmit={() => ask(text.trim())}
        onStop={cancel}
        running={Boolean(live)}
        maxLength={1000}
        disabled={Boolean(gate.blocked)}
        notice={gate.blocked}
        footer={gate.spend}
      />
    </>
  );

  const starterList = showStarters && (
    <ul className="mt-4 flex flex-col">
      {starters.map((s) => (
        <li key={s}>
          <button
            type="button"
            className="-mx-2 flex min-h-(--control-h) w-[calc(100%+16px)] items-center rounded-md px-2 py-2 text-left text-pretty transition-colors duration-150 hover:bg-fill"
            onClick={() => ask(s)}
          >
            {s}
          </button>
        </li>
      ))}
    </ul>
  );

  const panelTitle = threadId === null ? "New question" : (thread.data?.title ?? "Question");
  const main = missing ? (
    <EmptyState
      icon={ChatCircleTextIcon}
      title="This question does not exist"
      action={
        <AppLink to="/ask" className={buttonClass()}>
          Ask something new
        </AppLink>
      }
    />
  ) : (
    <ConversationPanel
      title={panelTitle}
      actions={threadId !== null && thread.data && <DeleteThread id={threadId} title={thread.data.title} />}
      flatHeader={threadId !== null}
      className={DOCKED}
      messages={messages}
      composer={composer}
      follow={turns.length + (pending ? 1 : 0)}
      startAtEnd
      thread={threadId}
      empty={
        <>
          {starterList}
          {!docked && (
            <nav aria-label="Your questions" className="mt-10 flex flex-col gap-2">
              <h2 className="text-heading font-medium">Your questions</h2>
              <ThreadList activeId={null} />
            </nav>
          )}
        </>
      }
    />
  );

  const header = (
    <PageHeader
      title="Ask"
      actions={
        threadId !== null && (
          <AppLink to="/ask" className={buttonClass()}>
            <Icon icon={PlusIcon} />
            New question
          </AppLink>
        )
      }
    />
  );

  const crumb = threadId === null ? undefined : (thread.data?.title ?? (thread.isError ? null : undefined));

  if (firstUse)
    return (
      <Page>
        <PageHeader title="Ask" />
        <FirstUseState icon={WaveformIcon} description="Answers come from your history. Import it or connect Spotify first." />
      </Page>
    );

  if (docked)
    return (
      <Page crumb={crumb}>
        <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-12">
          <div className="flex min-w-0 flex-col gap-10">
            {header}
            <nav aria-label="Your questions" className="flex min-w-0 flex-col gap-2">
              <h2 className="text-caption text-secondary">Your questions</h2>
              <ThreadList activeId={threadId} />
            </nav>
          </div>
          {main}
        </div>
      </Page>
    );

  return (
    <Page crumb={crumb} className={cx("min-h-full", messages && !missing && "pb-0!")}>
      {header}
      {main}
    </Page>
  );
}
