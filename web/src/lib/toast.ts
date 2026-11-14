import { Toast } from "@base-ui/react/toast";

export const toastManager = Toast.createToastManager();

export type ToastTone = "info" | "problem";
export type ToastAction = { label: string; onClick: () => void };

/**
 * One result the user cannot otherwise see. A toast with an action (Undo) or a problem stays
 * until dismissed or acted on; never use one for a successful copy.
 */
export function showToast(message: string, tone: ToastTone = "info", action?: ToastAction) {
  const id = toastManager.add({
    title: message,
    type: tone,
    priority: tone === "problem" ? "high" : "low",
    timeout: action || tone === "problem" ? 0 : 4000,
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
