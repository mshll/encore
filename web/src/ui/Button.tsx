import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconGlyph } from "./Icon";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-fill-inverted text-inverted hover:bg-fill-inverted-hover",
  accent: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "bg-fill-raised text-primary shadow-control hover:bg-fill-raised-hover",
  ghost: "text-secondary hover:bg-fill-hover hover:text-primary data-[popup-open]:bg-fill-hover data-[popup-open]:text-primary",
  danger: "bg-danger-subtle text-danger hover:bg-fill-hover",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-(--control-h-sm) gap-1.5 px-2.5 text-body-sm",
  md: "h-(--control-h) gap-1.5 px-3 text-body-sm",
  lg: "h-(--control-h-lg) gap-2 px-4 text-body",
};

/** Class string for anything that should look like a button: links, Base UI triggers. */
export function buttonClass({ variant = "secondary", size = "md", className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cx(
    "press inline-flex max-w-full shrink-0 items-center justify-center rounded-md font-medium tracking-[-0.005em] whitespace-nowrap",
    "transition-[background-color,color,transform] duration-(--dur-hover) ease-out disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconGlyph;
  iconEnd?: IconGlyph;
  /** Swaps the label in place while the request runs; the button keeps its width. */
  busyLabel?: ReactNode;
  busy?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, iconEnd, busy = false, busyLabel, className, children, type = "button", disabled, ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={buttonClass({ variant, size, className })} {...props}>
      {icon && <Icon icon={icon} size={size === "lg" ? "md" : "sm"} />}
      <span className="truncate">{busy && busyLabel ? busyLabel : children}</span>
      {iconEnd && <Icon icon={iconEnd} size="sm" className="opacity-70" />}
    </button>
  );
});

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: "size-(--control-h-sm)",
  md: "size-(--control-h)",
  lg: "size-(--control-h-lg)",
};

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: IconGlyph;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fill?: boolean;
};

export function iconButtonClass({ variant = "ghost", size = "md", className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cx(buttonClass({ variant, size }), "touch-target px-0", ICON_SIZE[size], className);
}

/** Square icon-only button. `label` is the accessible name and the tooltip-free fallback. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = "ghost", size = "md", fill = false, className, type = "button", ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} aria-label={label} className={iconButtonClass({ variant, size, className })} {...props}>
      <Icon icon={icon} size={size === "lg" ? "md" : size === "sm" ? "sm" : "md"} fill={fill} />
    </button>
  );
});
