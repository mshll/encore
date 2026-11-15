import { Popover, PopoverClose as Close, PopoverContent, PopoverTrigger as Trigger } from "@ui-sdk/react/popover";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { LAYER, POPUP } from "./surfaces";

export const PopoverRoot = Popover;
export const PopoverTrigger = Trigger;
export const PopoverClose = Close;

export function PopoverPopup({ children, align = "end", className }: { children: ReactNode; align?: "start" | "center" | "end"; className?: string }) {
  return (
    <PopoverContent container={LAYER} sideOffset={6} align={align} collisionPadding={8} className={cx(POPUP, "max-h-(--available-height) overflow-y-auto", className)}>
      {children}
    </PopoverContent>
  );
}
