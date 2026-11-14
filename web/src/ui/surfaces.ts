import type { RefObject } from "react";

/**
 * Opened by touch, a sheet focuses itself rather than its first control, which Safari would draw a focus ring on.
 * A sheet opened from outside its Dialog.Trigger gets no open type, so a touch screen counts as touch unless a key opened it.
 */
export const focusSheetOnTouch = (sheet: RefObject<HTMLElement | null>) => (openType: string) =>
  openType === "touch" || (openType !== "keyboard" && window.matchMedia("(pointer: coarse)").matches) ? sheet.current : true;

/** Shared class strings for floating surfaces, so every menu, popover and select reads the same. */
export const POPUP =
  "origin-(--transform-origin) overscroll-contain rounded-lg bg-overlay shadow-overlay outline-none transition-[opacity,transform] duration-150 ease-out data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:duration-100 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100";

export const MENU_ITEM =
  "flex min-h-(--control-h) cursor-default items-center gap-2.5 rounded-sm px-2.5 text-body-sm text-primary outline-none select-none data-[highlighted]:bg-fill data-[disabled]:opacity-50";

export const BACKDROP =
  "fixed inset-0 z-50 bg-backdrop transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0";
