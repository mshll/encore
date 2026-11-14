import type { ReactNode } from "react";
import { useStatus, useTimezone } from "../api/queries";
import { resetDay } from "../lib/assistant";
import { fmtTime } from "../lib/format";
import { AppLink } from "./AppLink";
import { Button } from "./Button";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { WarningIcon } from "./icons";

const usd = (n: number) => `$${n.toFixed(2)}`;

export type ClaudeGate = {
  /** Status has loaded, so `blocked` is known. */
  ready: boolean;
  /** Why a run cannot start right now, or null when it can. */
  blocked: ReactNode | null;
  /** A condition the run can start under but should know about. */
  warning: ReactNode | null;
  /** This month's spend against the cap, for a composer footer. */
  spend: string | null;
};

const settingsLink = (label: string) => (
  <AppLink to="/settings/claude" className="font-medium text-primary underline decoration-line-strong underline-offset-2 hover:decoration-current">
    {label}
  </AppLink>
);

/**
 * What stands between the owner and a Claude run, read from `/api/status` before anything is sent:
 * no API key or the monthly cap blocks it; a Spotify pause only limits songs that need checking.
 */
export function useClaudeGate({ needsSpotify }: { needsSpotify: boolean }): ClaudeGate {
  const status = useStatus().data;
  const timezone = useTimezone();
  if (!status) return { ready: false, blocked: null, warning: null, spend: null };
  const { llm, spotify } = status;
  const spend = `${usd(llm.spentUsd)} of ${usd(llm.capUsd)} this month`;
  if (!llm.configured) return { ready: true, blocked: <>Claude is not set up. {settingsLink("Add an API key")}</>, warning: null, spend: null };
  if (llm.exhausted)
    return {
      ready: true,
      blocked: (
        <>
          This month’s Claude budget is spent ({usd(llm.spentUsd)} of {usd(llm.capUsd)}). It resets on {resetDay(llm.month)}.{" "}
          {settingsLink("Change the budget")}
        </>
      ),
      warning: null,
      spend,
    };
  const warning =
    needsSpotify && spotify.paused
      ? `Spotify calls are paused${spotify.paused.until ? ` until ${fmtTime(spotify.paused.until, timezone)}` : ""}, so songs new to you cannot be checked.`
      : null;
  return { ready: true, blocked: null, warning, spend };
}

/** A gate message or a failed run, in the page flow. Problems carry Try again when the run can be repeated. */
export function RunNotice({
  children,
  tone = "warning",
  onRetry,
  className,
}: {
  children: ReactNode;
  tone?: "warning" | "danger";
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx(
        "flex items-start gap-2.5 rounded-lg px-3 py-2.5",
        tone === "danger" ? "bg-danger-subtle text-danger" : "bg-warning-subtle text-warning",
        className,
      )}
    >
      <Icon icon={WarningIcon} className="mt-0.5" />
      <p className="min-w-0 flex-1 text-pretty">{children}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry} className="-my-1">
          Try again
        </Button>
      )}
    </div>
  );
}
