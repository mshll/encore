import { useEffect, useState } from "react";
import type { RunState } from "../lib/useRun";
import { Button } from "./Button";

function useElapsed(since: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.round((now - since) / 1000));
}

const elapsedLabel = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`);

/**
 * A server-owned run (picks, sets, ask) as it happens: status with elapsed time, Cancel pinned right,
 * then the steps so far, newest first. Leaving the page stops listening, not the run.
 */
export function RunProgress({ run, title, onCancel }: { run: RunState; title: string; onCancel: () => void }) {
  const elapsed = useElapsed(run.startedAt);
  const steps = [...run.steps].reverse().slice(0, 8);
  const counts = [
    run.searches > 0 && `${run.searches} ${run.searches === 1 ? "search" : "searches"} of your history`,
    run.checked > 0 && `${run.checked} new ${run.checked === 1 ? "song" : "songs"} checked on Spotify`,
  ].filter(Boolean);
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
          <p className="truncate font-medium">{title}</p>
          <span className="shrink-0 text-caption text-secondary tabular">{elapsedLabel(elapsed)}</span>
        </div>
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <ol className="flex flex-col gap-1 pl-[18px]">
        {steps.length === 0 && <li className="text-secondary">Reading your listening…</li>}
        {steps.map((line, i) => (
          <li key={`${run.steps.length - i}-${line}`} className={i === 0 ? "text-primary text-pretty" : "text-secondary text-pretty"}>
            {line}
          </li>
        ))}
      </ol>
      {counts.length > 0 && <p className="text-caption text-secondary">{counts.join(", ")}</p>}
    </div>
  );
}
