import { useSyncExternalStore } from "react";

export type Toast = { id: number; message: string; tone: "info" | "problem" };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function showToast(message: string, tone: Toast["tone"] = "info") {
  const id = nextId++;
  toasts = [...toasts.slice(-2), { id, message, tone }];
  emit();
  setTimeout(() => dismissToast(id), tone === "problem" ? 9000 : 4000);
}

export const useToasts = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
