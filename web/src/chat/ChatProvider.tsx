import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import type { AskResult, PlanTurn, SetResult } from "../api/types";
import { usePageContext } from "../app/pageContext";
import { useAi } from "../lib/ai";
import { useDesktop } from "../lib/useMedia";
import { useRun } from "../lib/useRun";
import { useClaudeGate } from "../ui/ClaudeNotice";
import { ChatContext, modeOf, sameThread, threadKey, type Chat, type ChatMode, type ChatThread, type ShowOptions } from "./state";

const CONVERSATIONS = "/api/library/conversations";

type RunResult = AskResult | SetResult | PlanTurn;

const STORE = "encore-chat";

function stored(): { mode: ChatMode; thread: ChatThread | null } {
  try {
    const value = JSON.parse(localStorage.getItem(STORE) ?? "null") as { mode?: ChatMode; thread?: ChatThread | null } | null;
    return { mode: value?.mode ?? "ask", thread: value?.thread ?? null };
  } catch {
    return { mode: "ask", thread: null };
  }
}

/** The request path a message in this conversation goes to; also the key a working run is found by. */
function runPath(mode: ChatMode, thread: ChatThread | null): string {
  if (thread?.kind === "set") return `/api/sets/${thread.id}/messages`;
  if (mode === "ask") return "/api/ask";
  if (mode === "set") return "/api/sets";
  return CONVERSATIONS;
}

function body(mode: ChatMode, thread: ChatThread | null, text: string) {
  if (mode === "ask") return thread?.kind === "ask" ? { question: text, threadId: thread.id } : { question: text };
  if (mode === "set") return thread ? { message: text } : { request: text };
  return thread?.kind === "plan" ? { message: text, threadId: thread.threadId } : { message: text };
}

/**
 * The one conversation with Claude, held by the shell so it survives navigation: which conversation is open, the
 * message on its way and the run that answers it. The run belongs to the server; this follows it.
 */
export function ChatProvider({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [location, navigate] = useLocation();
  const desktop = useDesktop();
  const [{ mode, thread }, setSelection] = useState(stored);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [finished, setFinished] = useState<Chat["finished"]>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const returnTo = useRef<string | null>(null);
  const sendSeq = useRef(0);
  const page = usePageContext();
  const pageKey = page ? JSON.stringify(page) : null;
  const context = page && pageKey !== removed ? page : null;
  const gate = useClaudeGate({ needsSpotify: mode === "set" });

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ mode, thread }));
    } catch {
      // Private mode or blocked storage: the chat still works, it only forgets the conversation on reload.
    }
  }, [mode, thread]);

  const selection = useRef({ mode, thread });
  selection.current = { mode, thread };
  const select = useCallback((next: ChatThread | null, nextMode?: ChatMode) => {
    const current = selection.current;
    const m = next ? modeOf(next) : (nextMode ?? current.mode);
    if (sameThread(current.thread, next) && m === current.mode) return;
    sendSeq.current++;
    setPending(null);
    setStopped(false);
    selection.current = { mode: m, thread: next };
    setSelection({ mode: m, thread: next });
  }, []);

  const runRef = useRef<{ steps: string[]; startedAt: number | null }>({ steps: [], startedAt: null });
  const finish = async (result: RunResult) => {
    const { steps, startedAt } = runRef.current;
    const seconds = startedAt ? Math.round((Date.now() - startedAt) / 1000) : null;
    let next: ChatThread;
    if ("set" in result) {
      queryClient.setQueryData(["sets", result.set.id], result.set);
      await queryClient.invalidateQueries({ queryKey: ["sets"], exact: true });
      next = { kind: "set", id: result.set.id };
    } else if ("content" in result) {
      await queryClient.invalidateQueries({ queryKey: ["ask"] });
      next = { kind: "ask", id: result.threadId };
    } else {
      await queryClient.invalidateQueries({ queryKey: ["library"], predicate: (q) => ["conversation", "plan", "plans"].includes(String(q.queryKey[1])) });
      next = { kind: "plan", threadId: result.threadId };
    }
    setFinished({ thread: threadKey(next), steps, seconds });
    setPending(null);
    select(next);
    if (next.kind === "ask" && location.startsWith("/ask") && location !== `/ask/${next.id}`) navigate(`/ask/${next.id}`);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const path = runPath(mode, thread);
  const run = useRun<RunResult>({ key: path, onDone: (r) => void finishRef.current(r) });
  runRef.current = { steps: run.steps, startedAt: run.startedAt };

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      if (gate.blocked) {
        setDraft(text);
        return;
      }
      const seq = ++sendSeq.current;
      setPending(text);
      setStopped(false);
      setFinished(null);
      setDraft("");
      const result = await run.start(path, { ...body(mode, thread, text), ...(context ? { context } : {}) });
      if (seq !== sendSeq.current) return;
      if (result) await finishRef.current(result);
      else {
        setPending(null);
        setDraft(text);
      }
    },
    [gate.blocked, run, path, mode, thread, context],
  );

  // Deferred a tick so a mount React StrictMode tears down at once never starts, and so never abandons, a paid run.
  useEffect(() => {
    if (!queued || !gate.ready) return;
    const timer = setTimeout(() => {
      setQueued(null);
      void send(queued);
    });
    return () => clearTimeout(timer);
  }, [queued, gate.ready, send]);

  const focusComposer = useCallback(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    requestAnimationFrame(() => composer.current?.focus({ preventScroll: true }));
  }, []);

  const show = useCallback(
    ({ thread: next, mode: nextMode, send: text, open: opening = true }: ShowOptions = {}) => {
      if (next !== undefined) select(next, nextMode);
      else if (nextMode) select(null, nextMode);
      if (text) setQueued(text);
      if (opening) {
        onOpenChange(true);
        focusComposer();
      }
    },
    [select, onOpenChange, focusComposer],
  );

  const stop = useCallback(() => {
    sendSeq.current++;
    run.cancel();
    setStopped(true);
    if (pending) setDraft(pending);
    setPending(null);
  }, [run, pending]);

  const onAsk = location.startsWith("/ask");
  const expand = useCallback(() => {
    returnTo.current = location;
    navigate(thread?.kind === "ask" ? `/ask/${thread.id}` : "/ask");
  }, [location, navigate, thread]);
  const collapse = useCallback(() => {
    navigate(returnTo.current ?? "/");
    returnTo.current = null;
    onOpenChange(true);
  }, [navigate, onOpenChange]);

  const value = useMemo<Chat>(
    () => ({
      open,
      mode,
      thread,
      context,
      removeContext: () => setRemoved(pageKey),
      draft,
      setDraft,
      pending,
      stopped,
      finished,
      run,
      gate,
      composer,
      show,
      setMode: (m) => select(null, m),
      send: (text) => void send(text),
      stop,
      close: () => onOpenChange(false),
      toggle: () => {
        if (onAsk) collapse();
        else if (open) onOpenChange(false);
        else show();
      },
      leave: () => {
        if (!desktop) onOpenChange(false);
      },
      expand,
      collapse,
      runningFor: (t) => run.running && sameThread(t, thread),
    }),
    [open, mode, thread, context, pageKey, draft, pending, stopped, finished, run, gate, show, select, send, stop, onOpenChange, onAsk, collapse, desktop, expand],
  );

  const ai = useAi();
  const toggle = useRef(ai.configured ? value.toggle : null);
  toggle.current = ai.configured ? value.toggle : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (toggle.current && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggle.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
