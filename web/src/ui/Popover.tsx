import { Popover as Base } from "@base-ui/react/popover";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { POPUP } from "./surfaces";

export const PopoverRoot = Base.Root;
export const PopoverTrigger = Base.Trigger;
export const PopoverClose = Base.Close;

export function PopoverPopup({ children, align = "end", className }: { children: ReactNode; align?: "start" | "center" | "end"; className?: string }) {
  return (
    <Base.Portal>
      <Base.Positioner sideOffset={6} align={align} collisionPadding={8} className="z-50">
        <Base.Popup className={cx(POPUP, "max-h-(--available-height) overflow-y-auto", className)}>{children}</Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  );
}
