/*
 * A run's trace, adapted from Beautiful UI's Loading State, Thinking and Tool Chips (MIT, see ./LICENSE).
 * While Claude works: the pixel loader, a shimmering status line and the elapsed time, over the steps as they run
 * (the newest one spinning). When the run ends the trace folds to one line ("Worked for 12 s") that opens it again.
 */
import { useEffect, useState } from "react";
import { cx } from "../../ui/cx";
import { Icon } from "../../ui/Icon";
import { CaretDownIcon, CheckIcon } from "../../ui/icons";

/** A chevron wavefront driving right across a 3 by 3 grid; the 650 ms cycle is shorter than the sweep, so two fronts are in flight. */
const WAVE = Array.from({ length: 9 }, (_, i) => (Math.floor(i % 3) + Math.abs(Math.floor(i / 3) - 1)) * 90);

export function PixelLoader() {
  return (
    <span aria-hidden className="grid shrink-0 grid-cols-3 gap-0.5">
      {WAVE.map((delay, i) => (
        <span key={i} className="size-1 bg-primary opacity-15" style={{ animation: `pixel-on 650ms ease-in-out ${delay}ms infinite` }} />
      ))}
    </span>
  );
}

function useElapsed(since: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.round((now - since) / 1000));
}

export const elapsedLabel = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`);

/** "Searching your history: Frank Ocean, night plays" as the tool's words and its arguments. */
function Step({ line, state }: { line: string; state: "done" | "running" }) {
  const at = line.indexOf(": ");
  const [label, detail] = at > 0 ? [line.slice(0, at), line.slice(at + 2)] : [line, null];
  return (
    <li className="flex min-h-7 min-w-0 items-center gap-2 animate-[fade-up_320ms_var(--ease-out)_both]">
      {state === "running" ? (
        <span aria-hidden className="size-3 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-secondary" />
      ) : (
        <Icon icon={CheckIcon} className="text-tertiary" />
      )}
      <span className="shrink-0 font-medium text-primary">{label}</span>
      {detail && <span className="block h-5 min-w-0 truncate rounded-xs bg-fill px-1.5 text-caption leading-5 text-secondary" title={detail}>{detail}</span>}
    </li>
  );
}

export function Thinking({
  running,
  label,
  steps,
  startedAt,
  seconds,
}: {
  running: boolean;
  /** What the run is doing, while it runs: "Answering", "Building your set". */
  label: string;
  steps: string[];
  startedAt: number | null;
  /** How long the finished run took; null when it is not known (a run followed after a reload). */
  seconds: number | null;
}) {
  const elapsed = useElapsed(running ? startedAt : null);
  const [opened, setOpened] = useState<boolean | null>(null);
  const expanded = opened ?? running;
  if (!running && steps.length === 0) return null;
  const done = seconds !== null ? `Worked for ${elapsedLabel(seconds)}` : `${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
  return (
    <div className="flex flex-col">
      {running ? (
        <div role="status" aria-live="polite" className="flex min-h-7 items-center gap-2.5">
          <PixelLoader />
          <span className="shimmer-text font-medium">{label}</span>
          <span className="text-caption text-tertiary tabular">{elapsedLabel(elapsed)}</span>
        </div>
      ) : (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setOpened(!expanded)}
          className="press -mx-1.5 flex min-h-7 w-fit items-center gap-1.5 rounded-sm px-1.5 text-caption font-medium text-secondary transition-colors duration-150 animate-[fade-in_350ms_var(--ease-out)_both] hover:bg-fill hover:text-primary phone:min-h-11"
        >
          {done}
          <Icon icon={CaretDownIcon} className={cx("text-tertiary transition-transform duration-300", expanded && "rotate-180")} />
        </button>
      )}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-400 ease-out"
        style={{ gridTemplateRows: expanded && steps.length > 0 ? "1fr" : "0fr", opacity: expanded ? 1 : 0 }}
      >
        <div className="min-h-0 overflow-hidden">
          <ol className="mt-1 ml-1.5 flex flex-col gap-0.5 border-l border-line py-1 pl-3.5 text-body-sm">
            {steps.map((line, i) => (
              <Step key={`${i}-${line}`} line={line} state={running && i === steps.length - 1 ? "running" : "done"} />
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
