import { Toast, ToastAction, ToastClose, ToastRegion, ToastTitle } from "@ui-sdk/react/toast";
import type { ReactNode } from "react";
import { toaster } from "../lib/toast";
import { buttonClass } from "./Button";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { XIcon } from "./icons";

const TOAST = cx(
  "absolute inset-x-0 bottom-0 mx-auto flex w-full items-center gap-2 rounded-lg bg-standout py-1.5 pr-1.5 pl-4 text-body-sm text-on-standout shadow-modal select-none",
  "[transform:translate(var(--toast-swipe-x,0px),var(--toast-swipe-y,0px))] transition-[opacity,transform,translate] duration-200 ease-out data-[swiping]:transition-none",
  "data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 data-[ending-style]:translate-y-2 data-[ending-style]:opacity-0",
  "data-[ending-style]:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-y,0px)+150%))]",
  "motion-reduce:data-[ending-style]:translate-y-0 motion-reduce:data-[starting-style]:translate-y-0",
);

/** One toast at a time, bottom centre, above the player and the tab bar. Swipe down to dismiss. Mount once in the shell. */
export function Toaster({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ToastRegion
        toaster={toaster}
        side="bottom"
        align="center"
        maxVisible={1}
        className="fixed translate-none right-[max(16px,env(safe-area-inset-right))] bottom-[calc(var(--bottom-chrome)+12px)] left-[max(16px,env(safe-area-inset-left))] z-[70] transition-[bottom] duration-(--dur-move) ease-(--ease-move) mx-auto max-w-[420px] outline-none"
      >
        {() => (
          <Toast className={TOAST}>
            <ToastTitle className="min-w-0 flex-1 py-1.5 text-pretty" />
            <ToastAction className={buttonClass({ variant: "standout", size: "sm" })} />
            <ToastClose aria-label="Dismiss" className={buttonClass({ variant: "standout", size: "sm", className: "touch-target size-(--control-h-sm) px-0" })}>
              <Icon icon={XIcon} className="text-on-standout-secondary" />
            </ToastClose>
          </Toast>
        )}
      </ToastRegion>
    </>
  );
}
