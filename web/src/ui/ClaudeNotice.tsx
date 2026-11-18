import type { ReactNode } from "react";
import { useStatus, useTimezone } from "../api/queries";
import { resetDay } from "../lib/assistant";
import { fmtTime } from "../lib/format";
import { AppLink } from "./AppLink";

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
  <AppLink to="/settings/ai" className="font-medium text-primary underline decoration-line-strong underline-offset-2 hover:decoration-current">
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
  if (!llm.configured) return { ready: true, blocked: <>AI is not set up. {settingsLink("Set it up in Settings › AI")}</>, warning: null, spend: null };
  if (llm.exhausted)
    return {
      ready: true,
      blocked: (
        <>
          This month’s AI budget is spent ({usd(llm.spentUsd)} of {usd(llm.capUsd)}). It resets on {resetDay(llm.month)}.{" "}
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
