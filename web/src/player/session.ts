import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { request } from "../api/client";
import { showToast } from "../lib/toast";
import { playbackProblem } from "./playback";

export function useStartSession() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  const start = async (uris: string[]) => {
    setBusy(true);
    try {
      await request("/api/dj/start", { json: { uris: [...new Set(uris)].slice(0, 500) } });
      await queryClient.invalidateQueries({ queryKey: ["dj"] });
      navigate("/session");
    } catch (error) {
      showToast(playbackProblem(error), "problem");
    } finally {
      setBusy(false);
    }
  };
  return { start, busy };
}
