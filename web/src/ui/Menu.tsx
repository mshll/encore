import { Menu, MenuContent, MenuItem as Item, MenuSeparator as Separator, MenuTrigger as Trigger } from "@ui-sdk/react/menu";
import type { ComponentProps, ReactNode } from "react";
import { iconButtonClass } from "./Button";
import { cx } from "./cx";
import { Icon, type IconGlyph } from "./Icon";
import { DotsThreeIcon } from "./icons";
import { LAYER, MENU_ITEM, POPUP } from "./surfaces";

export const MenuRoot = Menu;
export const MenuTrigger = Trigger;

/** The "more" button that opens a row's or a page's menu. `label` names what it is for ("More for Woods"). */
export function MoreTrigger({ label, size = "sm", className }: { label: string; size?: "sm" | "md"; className?: string }) {
  return (
    <Trigger className={iconButtonClass({ size, className })} aria-label={label}>
      <Icon icon={DotsThreeIcon} size="md" />
    </Trigger>
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
    <MenuContent
      container={LAYER}
      side={side}
      align={align}
      sideOffset={6}
      collisionPadding={8}
      className={cx(POPUP, "flex max-h-(--available-height) min-w-52 flex-col overflow-y-auto p-1", className)}
    >
      {children}
    </MenuContent>
  );
}

type ItemProps = { icon?: IconGlyph; danger?: boolean; children: ReactNode; hint?: ReactNode };

/** `onClick` runs for a click, Enter or Space alike. */
export function MenuItem({
  icon,
  danger,
  children,
  hint,
  className,
  onClick,
  ...props
}: ItemProps & { onClick?: () => void } & Omit<ComponentProps<typeof Item>, "children" | "onClick" | "onSelect">) {
  return (
    <Item className={cx(MENU_ITEM, danger && "text-danger", className)} onSelect={onClick} {...props}>
      {icon && <Icon icon={icon} className={danger ? "" : "text-secondary"} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-caption text-tertiary">{hint}</span>}
    </Item>
  );
}

export function MenuLinkItem({
  icon,
  children,
  className,
  href,
  target,
  rel,
  download,
}: Omit<ItemProps, "danger" | "hint"> & { className?: string; href: string; target?: string; rel?: string; download?: boolean }) {
  return (
    <Item className={cx(MENU_ITEM, className)} render={<a href={href} target={target} rel={rel} download={download} />}>
      {icon && <Icon icon={icon} className="text-secondary" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </Item>
  );
}

export function MenuSeparator() {
  return <Separator className="mx-1 my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pt-2 pb-1 text-caption text-tertiary">{children}</div>;
}
