import { useCallback, useEffect, useRef, useState } from "react";
import { get, request } from "../api/client";
import type { AnswerVisual, ChatTask } from "../api/types";
import { followRun, streamPost, type StreamEvent, type StreamHandlers } from "../api/stream";
import { assistantProblem, progressLine } from "./assistant";

export type RunState = {
  running: boolean;
  steps: string[];
  text: string;
  /** Visuals the run has drawn so far, by the id its text places them with. */
  visuals: Record<string, AnswerVisual>;
  searches: number;
  checked: number;
  startedAt: number | null;
  problem: string | null;
  /** The task the chat picked for the message, once the server says. */
  task: ChatTask | null;
};

const IDLE: RunState = { running: false, steps: [], text: "", visuals: {}, searches: 0, checked: 0, startedAt: null, problem: null, task: null };

type ActiveRun = { run: { id: string; startedAt: string } | null };

/**
 * Runs one streamed assistant request, collecting progress lines and text. The run belongs to the server:
 * leaving the page only stops listening, and `resume` picks a working run up again on return. Cancel stops it.
 */
export function useRun<T>(resume?: { key: string; onDone: (result: T) => void }) {
  const [state, setState] = useState<RunState>(IDLE);
  const listening = useRef<AbortController | null>(null);
  const runId = useRef<string | null>(null);
  const onDone = useRef(resume?.onDone);
  onDone.current = resume?.onDone;

  const listen = useCallback(async (open: (handlers: StreamHandlers, signal: AbortSignal) => Promise<T>, startedAt: number): Promise<T | null> => {
    listening.current?.abort();
    const controller = new AbortController();
    listening.current = controller;
    runId.current = null;
    setState({ ...IDLE, running: true, startedAt });
    const onEvent = (e: StreamEvent) =>
      setState((s) => {
        if (e.type === "text") return { ...s, text: s.text + e.delta };
        if (e.type === "visual") return { ...s, visuals: { ...s.visuals, [e.id]: e.visual } };
        if (e.type === "task") return { ...s, task: e.task };
        const line = progressLine(e);
        return {
          ...s,
          steps: s.steps.at(-1) === line ? s.steps : [...s.steps, line],
          searches: s.searches + (e.name === "find_songs" ? 1 : 0),
          checked: s.checked + (e.name === "verify_new_song" ? 1 : 0),
        };
      });
    const onRun = (run: { id: string; startedAt: string }) => {
      runId.current = run.id;
      setState((s) => ({ ...s, startedAt: Date.parse(run.startedAt) }));
    };
    try {
      const result = await open({ onEvent, onRun }, controller.signal);
      setState((s) => ({ ...s, running: false }));
      return result;
    } catch (error) {
      if (controller.signal.aborted) return null;
      setState((s) => ({ ...s, running: false, problem: assistantProblem(error) }));
      return null;
    } finally {
      if (listening.current === controller) listening.current = null;
    }
  }, []);

  const start = useCallback((path: string, body: unknown) => listen((handlers, signal) => streamPost<T>(path, body, handlers, signal), Date.now()), [listen]);

  const resumeKey = resume?.key;
  useEffect(() => {
    let left = false;
    if (resumeKey) {
      void get<ActiveRun>("/api/runs", { key: resumeKey })
        .then(async ({ run }) => {
          if (!run || left || listening.current) return;
          const result = await listen((handlers, signal) => followRun<T>(run.id, handlers, signal), Date.parse(run.startedAt));
          if (result && !left) onDone.current?.(result);
        })
        .catch(() => {});
    }
    return () => {
      left = true;
      listening.current?.abort();
    };
  }, [resumeKey, listen]);

  const cancel = useCallback(() => {
    if (runId.current) void request(`/api/runs/${runId.current}`, { method: "DELETE" }).catch(() => {});
    listening.current?.abort();
    setState(IDLE);
  }, []);

  const reset = useCallback(() => setState(IDLE), []);

  return { ...state, start, cancel, reset };
}
