import { Toast } from "@base-ui/react/toast";
import { toastManager } from "../lib/toast";
import { buttonClass } from "./Button";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { XIcon } from "./icons";

const SWIPE: ("down" | "left" | "right")[] = ["down", "left", "right"];

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      swipeDirection={SWIPE}
      className={cx(
        "absolute inset-x-0 bottom-0 mx-auto flex w-full items-center gap-2 rounded-lg bg-standout py-1.5 pr-1.5 pl-4 text-body-sm text-on-standout shadow-modal select-none",
        "transition-[opacity,transform,translate] duration-200 ease-out data-[limited]:opacity-0",
        "data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 data-[ending-style]:translate-y-2 data-[ending-style]:opacity-0",
        "data-[ending-style]:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "data-[ending-style]:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-110%))]",
        "data-[ending-style]:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+110%))]",
        "motion-reduce:data-[ending-style]:translate-y-0 motion-reduce:data-[starting-style]:translate-y-0",
      )}
    >
      <Toast.Title className="min-w-0 flex-1 py-1.5 text-pretty" />
      <Toast.Action className={buttonClass({ variant: "standout", size: "sm" })} />
      <Toast.Close aria-label="Dismiss" className={buttonClass({ variant: "standout", size: "sm", className: "touch-target size-(--control-h-sm) px-0" })}>
        <Icon icon={XIcon} className="text-on-standout-secondary" />
      </Toast.Close>
    </Toast.Root>
  ));
}

/** One toast at a time, bottom centre, above the player and the tab bar. Swipe down or sideways to dismiss. Mount once in the shell. */
export function Toaster({ children }: { children: React.ReactNode }) {
  return (
    <Toast.Provider toastManager={toastManager} limit={1}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="fixed right-[max(16px,env(safe-area-inset-right))] bottom-[calc(var(--bottom-chrome)+12px)] left-[max(16px,env(safe-area-inset-left))] z-[70] transition-[bottom] duration-(--dur-move) ease-(--ease-move) mx-auto max-w-[420px] outline-none">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
