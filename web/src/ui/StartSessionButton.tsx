import type { ReactNode } from "react";
import { useStartSession } from "../player/session";
import { Button } from "./Button";
import { WaveformIcon } from "./icons";

/** Starts a DJ session from these songs (a user action; nothing plays before the click). Hidden with no songs. */
export function StartSessionButton({ uris, className }: { uris: string[]; className?: string }): ReactNode {
  const { start, busy } = useStartSession();
  if (uris.length === 0) return null;
  return (
    <Button size="sm" icon={WaveformIcon} busy={busy} busyLabel="Starting" onClick={() => void start(uris)} className={className}>
      Start a session
    </Button>
  );
}
