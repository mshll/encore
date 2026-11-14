import { useCallback, useEffect, useRef, useState } from "react";
import { streamPost, type StreamEvent } from "../api/stream";
import { assistantProblem, progressLine } from "./assistant";

export type RunState = {
  running: boolean;
  steps: string[];
  text: string;
  searches: number;
  checked: number;
  startedAt: number | null;
  problem: string | null;
};

const IDLE: RunState = { running: false, steps: [], text: "", searches: 0, checked: 0, startedAt: null, problem: null };

/** Runs one streamed assistant request, collecting progress lines and text. Cancel stops waiting; the server may still finish the run. */
export function useRun<T>() {
  const [state, setState] = useState<RunState>(IDLE);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const start = useCallback(async (path: string, body: unknown): Promise<T | null> => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState({ ...IDLE, running: true, startedAt: Date.now() });
    const onEvent = (e: StreamEvent) =>
      setState((s) => {
        if (e.type === "text") return { ...s, text: s.text + e.delta };
        const line = progressLine(e);
        return {
          ...s,
          steps: s.steps.at(-1) === line ? s.steps : [...s.steps, line],
          searches: s.searches + (e.name === "find_songs" ? 1 : 0),
          checked: s.checked + (e.name === "verify_new_song" ? 1 : 0),
        };
      });
    try {
      const result = await streamPost<T>(path, body, onEvent, controller.signal);
      setState((s) => ({ ...s, running: false }));
      return result;
    } catch (error) {
      if (controller.signal.aborted) {
        setState(IDLE);
        return null;
      }
      setState((s) => ({ ...s, running: false, problem: assistantProblem(error) }));
      return null;
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    abort.current?.abort();
    setState(IDLE);
  }, []);

  const reset = useCallback(() => setState(IDLE), []);

  return { ...state, start, cancel, reset };
}
