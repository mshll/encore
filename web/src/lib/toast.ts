import { Toast } from "@base-ui/react/toast";

export const toastManager = Toast.createToastManager();

export type ToastTone = "info" | "problem";
export type ToastAction = { label: string; onClick: () => void };

const INFO_MS = 4000;
const ACTION_MS = 8000;

/**
 * One result the user cannot otherwise see; never use one for a successful copy. A new toast replaces the one
 * showing. Info goes after 4 s, a toast with an action (Undo) after 8 s, a problem stays until dismissed.
 * Hover, focus or a finger on the toast pauses the timer.
 */
export function showToast(message: string, tone: ToastTone = "info", action?: ToastAction) {
  toastManager.close();
  const id = toastManager.add({
    title: message,
    type: tone,
    priority: tone === "problem" ? "high" : "low",
    timeout: tone === "problem" ? 0 : action ? ACTION_MS : INFO_MS,
    actionProps: action
      ? {
          children: action.label,
          onClick: () => {
            toastManager.close(id);
            action.onClick();
          },
        }
      : undefined,
  });
  return id;
}
