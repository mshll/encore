import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { request } from "../api/client";
import type { ChatResult } from "../api/types";
import { usePageContext } from "../app/pageContext";
import { useAi } from "../lib/ai";
import { assistantProblem } from "../lib/assistant";
import { showToast } from "../lib/toast";
import { useDesktop } from "../lib/useMedia";
import { useRun } from "../lib/useRun";
import { useClaudeGate } from "../ui/ClaudeNotice";
import { ChatContext, threadKey, type Chat, type ShowOptions } from "./state";

const STORE = "encore-chat";

function stored(): number | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORE) ?? "null") as { conversation?: unknown } | null;
    return typeof value?.conversation === "number" ? value.conversation : null;
  } catch {
    return null;
  }
}

/** The request path a message goes to; also the key a working run is found by. */
const runPath = (conversation: number | null) => (conversation === null ? "/api/chat" : `/api/chat/${conversation}/messages`);

/** What a finished turn changed outside the chat, so those pages read it again. */
const TOUCHED: Record<ChatResult["turn"]["outcome"]["kind"], string[][]> = {
  answer: [["ask"]],
  set: [["sets"], ["dj"]],
  plan: [["library"]],
  rule: [],
  play: [],
};

/**
 * The one conversation with the assistant, held by the shell so it survives navigation: which conversation is open, the
 * message on its way and the run that answers it. The run belongs to the server; this follows it.
 */
export function ChatProvider({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [location, navigate] = useLocation();
  const desktop = useDesktop();
  const [conversation, setConversation] = useState(stored);
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
  const gate = useClaudeGate({ needsSpotify: false });

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ conversation }));
    } catch {
      // Private mode or blocked storage: the chat still works, it only forgets the conversation on reload.
    }
  }, [conversation]);

  const current = useRef(conversation);
  current.current = conversation;
  const select = useCallback((next: number | null) => {
    if (current.current === next) return;
    sendSeq.current++;
    setPending(null);
    setStopped(false);
    current.current = next;
    setConversation(next);
  }, []);

  const runRef = useRef<{ steps: string[]; startedAt: number | null }>({ steps: [], startedAt: null });
  const finish = async (result: ChatResult) => {
    const { steps, startedAt } = runRef.current;
    const seconds = startedAt ? Math.round((Date.now() - startedAt) / 1000) : null;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["chat"] }),
      ...TOUCHED[result.turn.outcome.kind].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    ]);
    setFinished({ conversation: threadKey(result.conversationId), steps, seconds });
    setPending(null);
    select(result.conversationId);
    if (location.startsWith("/chat") && location !== `/chat/${result.conversationId}`) navigate(`/chat/${result.conversationId}`);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const path = runPath(conversation);
  const run = useRun<ChatResult>({ key: path, onDone: (r) => void finishRef.current(r) });
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
      const result = await run.start(path, { message: text, ...(context ? { context } : {}) });
      if (seq !== sendSeq.current) return;
      if (result) await finishRef.current(result);
      else {
        setPending(null);
        setDraft(text);
      }
    },
    [gate.blocked, run, path, context],
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
    ({ conversation: next, send: text, open: opening = true }: ShowOptions = {}) => {
      if (next !== undefined) select(next);
      if (text) setQueued(text);
      if (opening) {
        onOpenChange(true);
        focusComposer();
      }
    },
    [select, onOpenChange, focusComposer],
  );

  const attach = useCallback<Chat["attach"]>(
    async (subject) => {
      try {
        const { conversationId } = await request<{ conversationId: number }>("/api/chat/attach", { json: subject });
        show({ conversation: conversationId });
      } catch (error) {
        showToast(assistantProblem(error), "problem");
      }
    },
    [show],
  );

  const stop = useCallback(() => {
    sendSeq.current++;
    run.cancel();
    setStopped(true);
    if (pending) setDraft(pending);
    setPending(null);
  }, [run, pending]);

  const onPage = location.startsWith("/chat");
  const expand = useCallback(() => {
    returnTo.current = location;
    navigate(conversation === null ? "/chat" : `/chat/${conversation}`);
  }, [location, navigate, conversation]);
  const collapse = useCallback(() => {
    navigate(returnTo.current ?? "/");
    returnTo.current = null;
    onOpenChange(true);
  }, [navigate, onOpenChange]);

  const value = useMemo<Chat>(
    () => ({
      open,
      conversation,
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
      attach,
      send: (text) => void send(text),
      stop,
      close: () => onOpenChange(false),
      toggle: () => {
        if (onPage) collapse();
        else if (open) onOpenChange(false);
        else show();
      },
      leave: () => {
        if (!desktop) onOpenChange(false);
      },
      expand,
      collapse,
      runningFor: (c) => run.running && c === conversation,
    }),
    [open, conversation, context, pageKey, draft, pending, stopped, finished, run, gate, show, attach, send, stop, onOpenChange, onPage, collapse, desktop, expand],
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
