import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { trailFor } from "../app/nav";
import { AppLink } from "./AppLink";
import { Breadcrumbs } from "./Breadcrumbs";
import { Button, buttonClass } from "./Button";
import { cx } from "./cx";
import type { IconGlyph } from "./Icon";
import { MenuItem, MenuPopup, MenuRoot, MoreTrigger } from "./Menu";

/** Sections stacked at the page rhythm, for a body that sits under a shared header (Patterns tabs). */
export const SECTIONS = "flex flex-col gap-10 md:gap-12";

/** The main answer left, small related lists right (DESIGN.md, Main plus side column). */
export const SIDE_COLUMNS = "grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] lg:gap-12";

/** Old data stays on screen, dimmed, while a new range or filter loads. */
export const dimWhile = (refetching: boolean) => cx("transition-opacity duration-200", refetching && "opacity-60");

/**
 * The page frame, the same on every page: one column, `--page-max` wide with the gutter inside it, centred in the page
 * panel. A band at the top holds the breadcrumb trail (desktop: always reserved, so every title starts at the same
 * offset; phone: only on a page below its surface). `width="read"` keeps the frame and holds everything under the
 * header to the reading measure (`--measure`), left-aligned on the frame's edge.
 * `crumb` names this page in the trail: undefined while its data loads, null when it failed.
 */
export function Page({
  children,
  width = "data",
  className,
  crumb,
}: {
  children: ReactNode;
  width?: "data" | "read";
  className?: string;
  crumb?: string | null;
}) {
  const [location] = useLocation();
  const trail = trailFor(location);
  return (
    <div className={cx("mx-auto flex w-full max-w-(--page-max) flex-col px-(--gutter) pb-16", className)}>
      <div className={cx("flex items-center md:h-12", trail ? "h-12" : "h-6")}>{trail && <Breadcrumbs trail={trail} current={crumb} />}</div>
      <div className={cx(SECTIONS, "flex-1", width === "read" && "[&>:not(header)]:max-w-(--measure)")}>{children}</div>
    </div>
  );
}

export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · encore` : "encore";
  }, [title]);
}

/** A header action that gives way to the overflow menu on a phone. */
export type HeaderAction = { label: string; icon?: IconGlyph; to?: string; onClick?: () => void; danger?: boolean };

function SecondaryButtons({ items }: { items: HeaderAction[] }) {
  return items.map((a) =>
    a.to ? (
      <AppLink key={a.label} to={a.to} className={buttonClass({ variant: a.danger ? "danger" : "secondary", className: "phone:hidden" })}>
        {a.label}
      </AppLink>
    ) : (
      <Button key={a.label} variant={a.danger ? "danger" : "secondary"} icon={a.icon} onClick={a.onClick} className="phone:hidden">
        {a.label}
      </Button>
    ),
  );
}

function SecondaryMenu({ items }: { items: HeaderAction[] }) {
  const [, navigate] = useLocation();
  return (
    <MenuRoot>
      <MoreTrigger label="More actions" size="md" className="md:hidden" />
      <MenuPopup>
        {items.map((a) => (
          <MenuItem key={a.label} icon={a.icon} danger={a.danger} onClick={a.to ? () => navigate(a.to!) : a.onClick}>
            {a.label}
          </MenuItem>
        ))}
      </MenuPopup>
    </MenuRoot>
  );
}

/**
 * Page title (display face), an optional one-line description, and the actions on the same row at every width:
 * right-aligned, at their full size; the title gives way (two lines, then an ellipsis). `secondary` actions sit before
 * `actions` on desktop and fold into one More menu on a phone. Children (tabs) sit under the row.
 */
export function PageHeader({
  title,
  description,
  actions,
  secondary,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  secondary?: HeaderAction[];
  children?: ReactNode;
}) {
  useDocumentTitle(title);
  const hasActions = Boolean(actions) || Boolean(secondary?.length);
  return (
    <header className="flex flex-col gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 md:items-end md:gap-x-6">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 title={title} className="line-clamp-2 font-display text-title text-balance break-words text-primary">
            {title}
          </h1>
          {description && <p className="max-w-2xl text-secondary text-pretty">{description}</p>}
        </div>
        {hasActions && (
          <div className="-mt-1.5 flex shrink-0 items-center gap-2 self-start md:mt-0 md:self-end">
            {secondary && secondary.length > 0 && <SecondaryButtons items={secondary} />}
            {actions}
            {secondary && secondary.length > 0 && <SecondaryMenu items={secondary} />}
          </div>
        )}
      </div>
      {children}
    </header>
  );
}

/** A titled block of the page. Actions sit right of the title, above the data they act on. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  labelledBy,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section aria-labelledby={labelledBy} className={cx("flex min-w-0 flex-col gap-4", className)}>
      {(title || actions) && (
        <div className="flex min-h-(--control-h) flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title && (
              <h2 id={labelledBy} className="text-heading font-medium text-primary">
                {title}
              </h2>
            )}
            {description && <p className="text-secondary text-pretty">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
