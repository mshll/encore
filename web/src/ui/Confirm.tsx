import { AlertDialog } from "@base-ui/react/alert-dialog";
import type { ReactNode } from "react";

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
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/60" />
        <AlertDialog.Popup className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md flex-col gap-4 rounded-2xl bg-overlay p-5 shadow-extra-large outline-none transition-[opacity,transform] duration-200 ease-(--ease-out-quint) data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0 md:top-1/2 md:bottom-auto md:-translate-y-1/2 md:p-6">
          <AlertDialog.Title className="text-heading-6 font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="text-body-base text-secondary text-pretty">{children}</AlertDialog.Description>
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <AlertDialog.Close className="btn btn-secondary">Cancel</AlertDialog.Close>
            <button type="button" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} disabled={busy} onClick={onConfirm}>
              {action}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
