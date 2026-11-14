import { Menu as Base } from "@base-ui/react/menu";
import type { ComponentProps, ReactNode } from "react";
import { iconButtonClass } from "./Button";
import { cx } from "./cx";
import { Icon, type IconGlyph } from "./Icon";
import { DotsThreeIcon } from "./icons";
import { MENU_ITEM, POPUP } from "./surfaces";

export const MenuRoot = Base.Root;
export const MenuTrigger = Base.Trigger;

/** The "more" button that opens a row's or a page's menu. `label` names what it is for ("More for Woods"). */
export function MoreTrigger({ label, size = "sm", className }: { label: string; size?: "sm" | "md"; className?: string }) {
  return (
    <Base.Trigger className={iconButtonClass({ size, className })} aria-label={label}>
      <Icon icon={DotsThreeIcon} size="md" />
    </Base.Trigger>
  );
}

export function MenuPopup({
  children,
  align = "end",
  side = "bottom",
  className,
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  return (
    <Base.Portal>
      <Base.Positioner side={side} align={align} sideOffset={6} collisionPadding={8} className="z-50">
        <Base.Popup className={cx(POPUP, "flex max-h-(--available-height) min-w-52 flex-col overflow-y-auto p-1", className)}>{children}</Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  );
}

type ItemProps = { icon?: IconGlyph; danger?: boolean; children: ReactNode; hint?: ReactNode };

export function MenuItem({ icon, danger, children, hint, className, ...props }: ItemProps & Omit<ComponentProps<typeof Base.Item>, "children">) {
  return (
    <Base.Item className={cx(MENU_ITEM, danger && "text-danger", className)} {...props}>
      {icon && <Icon icon={icon} className={danger ? "" : "text-secondary"} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-caption text-tertiary">{hint}</span>}
    </Base.Item>
  );
}

export function MenuLinkItem({ icon, children, className, ...props }: ItemProps & Omit<ComponentProps<typeof Base.LinkItem>, "children">) {
  return (
    <Base.LinkItem className={cx(MENU_ITEM, className)} {...props}>
      {icon && <Icon icon={icon} className="text-secondary" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </Base.LinkItem>
  );
}

export function MenuSeparator() {
  return <Base.Separator className="mx-1 my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pt-2 pb-1 text-caption text-tertiary">{children}</div>;
}
