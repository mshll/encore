import { useMutation, useQueryClient } from "@tanstack/react-query";
import { request } from "../api/client";
import type { Session } from "../api/types";
import { describeError } from "../ui/States";
import { showToast } from "./toast";

/** Ends this browser's session and drops every cached answer; the app then shows sign-in. */
export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => request("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.setQueryData<Session>(["session"], (s) => ({ authenticated: false, setupRequired: false, setupTokenConfigured: s?.setupTokenConfigured ?? true }));
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
    },
    onError: (e) => showToast(describeError(e), "problem"),
  });
}
