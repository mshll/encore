import { Tooltip as Base } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

export const TooltipProvider = Base.Provider;

/** A short label for an icon-only control, on hover or keyboard focus. Never the only place information lives. */
export function Tooltip({ label, children, side = "top" }: { label: ReactNode; children: ReactElement; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Base.Root>
      <Base.Trigger render={children} />
      <Base.Portal>
        <Base.Positioner side={side} sideOffset={6} className="z-[60]">
          <Base.Popup className="rounded-sm bg-standout px-2 py-1 text-caption font-medium text-on-standout transition-opacity duration-100 data-[ending-style]:opacity-0 data-[instant]:transition-none data-[starting-style]:opacity-0">
            {label}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
