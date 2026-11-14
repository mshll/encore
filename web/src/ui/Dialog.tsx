import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as Base } from "@base-ui/react/dialog";
import { useRef, type ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";
import { BACKDROP, focusSheetOnTouch } from "./surfaces";

/** Centred card on desktop, bottom sheet on a phone. */
const SHEET =
  "fixed z-50 flex max-h-[calc(var(--app-h,100dvh)-env(safe-area-inset-top)-24px)] flex-col overflow-y-auto overscroll-contain bg-overlay shadow-modal outline-none transition-[opacity,transform] ease-out " +
  "inset-x-0 bottom-(--keyboard-inset,0px) rounded-t-[14px] pb-[max(20px,env(safe-area-inset-bottom))] duration-300 data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full data-[ending-style]:duration-200 " +
  "md:inset-x-auto md:bottom-auto md:top-[14vh] md:left-1/2 md:w-[min(var(--dialog-w),calc(100vw-32px))] md:-translate-x-1/2 md:rounded-xl md:pb-0 md:duration-200 " +
  "md:data-[ending-style]:translate-y-2 md:data-[starting-style]:translate-y-2 md:data-[ending-style]:opacity-0 md:data-[starting-style]:opacity-0 " +
  "motion-reduce:data-[ending-style]:translate-y-0 motion-reduce:data-[starting-style]:translate-y-0 motion-reduce:data-[ending-style]:opacity-0 motion-reduce:data-[starting-style]:opacity-0";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 560,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: 440 | 560 | 720;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  return (
    <Base.Root open={open} onOpenChange={onOpenChange}>
      <Base.Portal>
        <Base.Backdrop className={BACKDROP} />
        <Base.Popup ref={sheet} initialFocus={focusSheetOnTouch(sheet)} className={SHEET} style={{ ["--dialog-w" as string]: `${width}px` }}>
          <div className="flex flex-col gap-1 px-5 pt-5">
            <Base.Title className="text-heading font-medium">{title}</Base.Title>
            {description && <Base.Description className="text-secondary text-pretty">{description}</Base.Description>}
          </div>
          {children && <div className="px-5 pt-4">{children}</div>}
          {footer && <div className="flex flex-col-reverse gap-2 px-5 pt-5 md:flex-row md:justify-end md:pb-5">{footer}</div>}
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  );
}

export const DialogClose = Base.Close;

/** Asks once before something that cannot be undone. Prefer an undo toast for anything that can. */
export function Confirm({
  open,
  onOpenChange,
  title,
  children,
  action,
  danger = false,
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  action: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={BACKDROP} />
        <AlertDialog.Popup ref={sheet} initialFocus={focusSheetOnTouch(sheet)} className={cx(SHEET, "gap-4 p-5")} style={{ ["--dialog-w" as string]: "440px" }}>
          <div className="flex flex-col gap-1">
            <AlertDialog.Title className="text-heading font-medium">{title}</AlertDialog.Title>
            <AlertDialog.Description className="text-secondary text-pretty">{children}</AlertDialog.Description>
          </div>
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <AlertDialog.Close render={<Button>Cancel</Button>} />
            <Button variant={danger ? "danger" : "primary"} busy={busy} onClick={onConfirm}>
              {action}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
