import { useEffect, useState } from "react";
import type { RunState } from "../lib/useRun";

function useElapsed(since: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.round((now - since) / 1000));
}

/** Live progress of a streamed run: the latest step, the earlier ones, counts and a cancel. */
export function RunProgress({ run, title, onCancel }: { run: RunState; title: string; onCancel: () => void }) {
  const elapsed = useElapsed(run.startedAt);
  const current = run.steps.at(-1);
  const earlier = run.steps.slice(-6, -1).reverse();
  const counts = [
    run.searches > 0 && `${run.searches} ${run.searches === 1 ? "search" : "searches"} of your history`,
    run.checked > 0 && `${run.checked} new ${run.checked === 1 ? "song" : "songs"} checked on Spotify`,
  ].filter(Boolean);
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-semibold">{title}</p>
        <span className="shrink-0 text-body-sm text-secondary tabular">{elapsed} s</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="flex items-center gap-2.5 text-body-lg text-pretty">
          <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-accent" />
          {current ?? "Reading your listening"}
        </p>
        {earlier.map((line, i) => (
          <p key={`${i}-${line}`} className="pl-[18px] text-body-sm text-tertiary text-pretty">
            {line}
          </p>
        ))}
      </div>
      {counts.length > 0 && <p className="text-body-sm text-secondary">{counts.join(", ")}.</p>}
      <button type="button" className="btn btn-secondary self-start" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
