import { Tooltip as Root, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import { LAYER } from "./surfaces";

/** A short label for an icon-only control, on hover or keyboard focus. Never the only place information lives. */
export function Tooltip({ label, children, side = "top" }: { label: ReactNode; children: ReactElement<Record<string, unknown>>; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Root delay={500}>
      <TooltipTrigger render={children} />
      <TooltipContent
        container={LAYER}
        side={side}
        sideOffset={6}
        className="rounded-sm bg-standout px-2 py-1 text-caption font-medium text-on-standout transition-opacity duration-100 data-[ending-style]:opacity-0 data-[instant]:transition-none data-[starting-style]:opacity-0"
      >
        {label}
      </TooltipContent>
    </Root>
  );
}
