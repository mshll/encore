import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { request } from "../../api/client";
import { useStatus } from "../../api/queries";
import type { Digest, RecapKind } from "../../api/types";
import { useAi } from "../../lib/ai";
import { assistantProblem } from "../../lib/assistant";
import { useRun } from "../../lib/useRun";

/** Whether recaps can have their words written now: AI is set up and this month's budget is not spent. Without it, recaps are their figures. */
export function useCanWrite(): boolean {
  const ai = useAi();
  const exhausted = useStatus().data?.llm.exhausted ?? false;
  return ai.configured && !exhausted;
}

/**
 * Makes or completes one period's recap. With AI it runs on the server as a run (one at a time, resumed after leaving
 * the page); without, it is a plain request that stores the figures alone.
 */
export function useWriteRecap() {
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["digests"] });
  const run = useRun<Digest>({ key: "/api/digests/generate", onDone: refresh });
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const write = async (kind: RecapKind, key: string) => {
    setProblem(null);
    setTarget(`${kind}:${key}`);
    if (canWrite) {
      if (await run.start("/api/digests/generate", { kind, key })) refresh();
      return;
    }
    setBusy(true);
    try {
      await request("/api/digests/generate", { json: { kind, key } });
      refresh();
    } catch (error) {
      setProblem(assistantProblem(error));
    } finally {
      setBusy(false);
    }
  };
  const working = busy || run.running;
  return {
    canWrite,
    run,
    working,
    /** Whether this period is the one being written. A run picked up after a reload belongs to whichever page asks. */
    writing: (kind: RecapKind, key: string) => working && (target === null || target === `${kind}:${key}`),
    problem: problem ?? run.problem,
    write,
  };
}

export type RecapWriter = ReturnType<typeof useWriteRecap>;
