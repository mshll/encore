import { createToaster } from "@ui-sdk/react/toast";

export const toaster = createToaster();

export type ToastTone = "info" | "problem";
export type ToastAction = { label: string; onClick: () => void };

const INFO_MS = 4000;
const ACTION_MS = 8000;

/**
 * One result the user cannot otherwise see; never use one for a successful copy. A new toast replaces the one
 * showing. Info goes after 4 s, a toast with an action (Undo) after 8 s, a problem stays until dismissed.
 * Hover, focus or a finger on the toast pauses the timer.
 */
export function showToast(message: string, tone: ToastTone = "info", action?: ToastAction): string {
  toaster.dismiss();
  return toaster({
    title: message,
    type: tone === "problem" ? "error" : "info",
    priority: tone === "problem" ? "assertive" : "polite",
    duration: tone === "problem" ? Infinity : action ? ACTION_MS : INFO_MS,
    action: action ? { label: action.label, dismiss: true, onAction: () => action.onClick() } : undefined,
  });
}
