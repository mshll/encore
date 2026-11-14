import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "wouter";
import { request } from "../api/client";
import { useAskThread, useAskThreads } from "../api/queries";
import type { AskResult, AskTurn } from "../api/types";
import { assistantProblem } from "../lib/assistant";
import { fmtAgo } from "../lib/format";
import { useAskStarters } from "../lib/prompts";
import { showToast } from "../lib/toast";
import { useRun } from "../lib/useRun";
import { Composer } from "../ui/Composer";
import { ArrowUp02Icon, Cancel01Icon, Icon } from "../ui/Icon";
import { Page } from "../ui/Page";
import { RunProgress } from "../ui/RunProgress";
import { SkeletonRows } from "../ui/states";

/** Splits an answer into paragraphs and the closing "Based on:" line. */
function splitAnswer(text: string) {
  const at = text.lastIndexOf("Based on");
  const body = at > 0 ? text.slice(0, at) : text;
  const basis = at > 0 ? text.slice(at).replace(/^Based on:?\s*/, "") : null;
  return {
    paragraphs: body
      .split(/\n{2,}|\n/)
      .map((p) => p.trim())
      .filter(Boolean),
    basis,
  };
}

function Answer({ text }: { text: string }) {
  const { paragraphs, basis } = splitAnswer(text);
  return (
    <div className="flex flex-col gap-3">
      {paragraphs.map((p, i) => (
        <p key={i} className="text-body-lg text-pretty">
          {p}
        </p>
      ))}
      {basis && (
        <p className="border-t-[0.5px] border-border-default pt-2 text-body-sm text-secondary text-pretty">
          <span className="font-medium">Based on</span> {basis}
        </p>
      )}
    </div>
  );
}

function Turns({ turns }: { turns: AskTurn[] }) {
  return (
    <ol className="flex flex-col gap-6">
      {turns.map((t, i) => (
        <li key={i} className={t.role === "owner" ? "self-end max-w-[85%] rounded-2xl bg-component px-3.5 py-2 text-pretty" : ""}>
          {t.role === "owner" ? t.text : <Answer text={t.text} />}
        </li>
      ))}
    </ol>
  );
}

export default function Ask() {
  const [params, setParams] = useSearchParams();
  const threadParam = params.get("thread");
  const threadId = threadParam ? Number(threadParam) : null;
  const threads = useAskThreads();
  const thread = useAskThread(threadId);
  const starters = useAskStarters();
  const queryClient = useQueryClient();
  const run = useRun<AskResult>({
    key: "/api/ask",
    onDone: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["ask"] });
      open(result.threadId);
    },
  });
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const autoAsked = useRef(false);

  const open = (id: number | null) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.delete("q");
        if (id === null) out.delete("thread");
        else out.set("thread", String(id));
        return out;
      },
      { replace: false },
    );

  const ask = async (question: string) => {
    setPending(question);
    setText("");
    const result = await run.start("/api/ask", threadId ? { question, threadId } : { question });
    setPending(null);
    if (!result) {
      setText(question);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["ask"] });
    if (result.threadId !== threadId) open(result.threadId);
  };

  const fromPalette = params.get("q");
  useEffect(() => {
    if (!fromPalette || autoAsked.current) return;
    // Deferred so a mount that is torn down at once (React StrictMode) never starts, and so never aborts, a paid run.
    const timer = setTimeout(() => {
      autoAsked.current = true;
      void ask(fromPalette);
    });
    return () => clearTimeout(timer);
  });

  const remove = async (id: number) => {
    try {
      await request(`/api/ask/threads/${id}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["ask"] });
      if (id === threadId) open(null);
    } catch (error) {
      showToast(assistantProblem(error), "problem");
    }
  };

  const turns = threadId ? (thread.data?.turns ?? []) : [];
  const empty = turns.length === 0 && !pending;

  return (
    <Page title="Ask">
      <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14">
        <nav aria-label="Questions" className="flex flex-col gap-1 max-lg:order-2">
          <button type="button" className="btn btn-secondary mb-2 self-start" onClick={() => open(null)} disabled={threadId === null}>
            New question
          </button>
          {!threads.data ? (
            <SkeletonRows rows={4} />
          ) : (
            threads.data.items.map((t) => (
              <div
                key={t.id}
                className={`group flex items-center gap-1 rounded-lg ${t.id === threadId ? "bg-nav-selected" : "hover-fine:bg-transparent-hover"}`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col px-2.5 py-2 text-left"
                  onClick={() => open(t.id)}
                  aria-current={t.id === threadId}
                >
                  <span className="truncate text-body-sm font-medium">{t.title}</span>
                  <span className="text-caption-lg text-tertiary">{fmtAgo(t.updatedAt)}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-icon btn-transparent md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  aria-label={`Delete “${t.title}”`}
                  onClick={() => remove(t.id)}
                >
                  <Icon icon={Cancel01Icon} size={16} />
                </button>
              </div>
            ))
          )}
        </nav>
        <div className="flex max-w-3xl min-w-0 flex-col gap-8">
          {threadId && thread.isPending ? <SkeletonRows rows={4} /> : <Turns turns={turns} />}
          {pending && (
            <div className="flex flex-col gap-6">
              <p className="max-w-[85%] self-end rounded-2xl bg-component px-3.5 py-2 text-pretty">{pending}</p>
              {run.text ? <Answer text={run.text} /> : run.running && <RunProgress run={run} title="Looking through your listening" onCancel={run.cancel} />}
            </div>
          )}
          {run.problem && (
            <p role="alert" className="text-danger">
              {run.problem}
            </p>
          )}
          {!run.running && (
            <Composer
              label={threadId ? "Ask a follow-up" : "Ask about your listening"}
              placeholder={threadId ? "Ask a follow-up" : "Why did I stop playing…, what do I play when…"}
              value={text}
              onChange={setText}
              onSubmit={() => ask(text.trim())}
              maxLength={1000}
              autoFocus
              action={
                <>
                  <Icon icon={ArrowUp02Icon} size={16} />
                  Ask
                </>
              }
            />
          )}
          {empty && !run.running && starters.length > 0 && (
            <ul className="flex flex-col">
              {starters.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    className="-mx-2 w-full rounded-lg px-2 py-2 text-left text-pretty transition-colors hover-fine:bg-transparent-hover"
                    onClick={() => ask(s)}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Page>
  );
}
