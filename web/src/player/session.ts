import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { request } from "../api/client";
import { useOpenQueue } from "../app/Shell";
import { showToast } from "../lib/toast";
import { playbackProblem } from "./playback";

/** Starts a DJ session from these songs and shows it where it runs: the queue panel, or the now-playing sheet on a phone. */
export function useStartSession() {
  const queryClient = useQueryClient();
  const openQueue = useOpenQueue();
  const [busy, setBusy] = useState(false);
  const start = async (uris: string[]) => {
    setBusy(true);
    try {
      await request("/api/dj/start", { json: { uris: [...new Set(uris)].slice(0, 500) } });
      await queryClient.invalidateQueries({ queryKey: ["dj"] });
      openQueue();
    } catch (error) {
      showToast(playbackProblem(error), "problem");
    } finally {
      setBusy(false);
    }
  };
  return { start, busy };
}
