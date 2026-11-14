import { Toast } from "@base-ui/react/toast";
import { toastManager } from "../lib/toast";
import { buttonClass } from "./Button";
import { Icon } from "./Icon";
import { XIcon } from "./icons";

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className="absolute inset-x-0 bottom-0 mx-auto flex w-full items-center gap-2 rounded-lg bg-standout py-1.5 pr-1.5 pl-4 text-body-sm text-on-standout shadow-modal transition-[opacity,transform] duration-200 ease-out select-none data-[ending-style]:translate-y-2 data-[ending-style]:opacity-0 data-[limited]:opacity-0 data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:translate-y-0 motion-reduce:data-[starting-style]:translate-y-0"
    >
      <Toast.Title className="min-w-0 flex-1 py-1.5 text-pretty" />
      <Toast.Action className={buttonClass({ variant: "ghost", size: "sm", className: "text-on-standout hover:bg-fill-on-standout hover:text-on-standout" })} />
      <Toast.Close aria-label="Dismiss" className={buttonClass({ variant: "ghost", size: "sm", className: "touch-target size-(--control-h-sm) px-0 text-on-standout-secondary hover:bg-fill-on-standout hover:text-on-standout" })}>
        <Icon icon={XIcon} />
      </Toast.Close>
    </Toast.Root>
  ));
}

/** One toast at a time, bottom centre, above the player. Mount once in the shell. */
export function Toaster({ children }: { children: React.ReactNode }) {
  return (
    <Toast.Provider toastManager={toastManager} limit={1}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="fixed inset-x-4 bottom-[calc(var(--bottom-chrome,0px)+12px)] z-[70] mx-auto max-w-[420px] outline-none">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
