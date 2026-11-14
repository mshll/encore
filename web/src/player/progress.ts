import { useEffect, useState } from "react";
import type { PlayerNow } from "../api/types";

export function useProgress(now: PlayerNow | undefined) {
  const [tick, setTick] = useState(() => Date.now());
  const playing = Boolean(now?.playing);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [playing]);
  if (!now?.track || now.progressMs === null) return { ms: 0, share: 0 };
  const elapsed = playing ? Math.max(0, tick - Date.parse(now.fetchedAt)) : 0;
  const ms = Math.min(now.track.durationMs, now.progressMs + elapsed);
  return { ms, share: now.track.durationMs ? ms / now.track.durationMs : 0 };
}

export function hourBucketNow(timezone: string, at = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(at));
  return hour < 6 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}
