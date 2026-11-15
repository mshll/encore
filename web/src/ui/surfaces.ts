/**
 * A sheet opened from state, not its trigger, counts as opened from code, which focuses its first control. On a touch
 * screen it focuses itself instead, as a tap on a trigger would, so Safari draws no focus ring and no keyboard opens.
 */
export const sheetFocus = (): "content" | "auto" => (window.matchMedia("(pointer: coarse)").matches ? "content" : "auto");

/** Popups render into body, so they inherit nothing from where their trigger sits. */
export const LAYER = document.body;

/** Shared class strings for floating surfaces, so every menu, popover and select reads the same. */
export const POPUP =
  "origin-(--transform-origin) overscroll-contain rounded-lg bg-overlay shadow-overlay outline-none transition-[opacity,transform] duration-150 ease-out data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:duration-100 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100";

export const MENU_ITEM =
  "flex min-h-(--control-h) cursor-default items-center gap-2.5 rounded-sm px-2.5 text-body-sm text-primary outline-none select-none data-[highlighted]:bg-fill data-[disabled]:opacity-50";

export const BACKDROP =
  "fixed inset-0 z-50 bg-backdrop transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0";

/** A drawer sets its backdrop's opacity as it moves, so this one only gives the colour. */
export const SHEET_BACKDROP = "fixed inset-0 bg-backdrop";
