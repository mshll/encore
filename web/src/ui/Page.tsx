import { useEffect, type ReactNode } from "react";
import { cx } from "./cx";

/** Sections stacked at the page rhythm, for a body that sits under a shared header (Patterns tabs). */
export const SECTIONS = "flex flex-col gap-10 md:gap-12";

/** The main answer left, small related lists right (DESIGN.md, Main plus side column). */
export const SIDE_COLUMNS = "grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] lg:gap-12";

/** Old data stays on screen, dimmed, while a new range or filter loads. */
export const dimWhile = (refetching: boolean) => cx("transition-opacity duration-200", refetching && "opacity-60");

/** The content column inside the page panel. `width` picks the column: data 1200, read 800, form 480. */
export function Page({ children, width = "data", className }: { children: ReactNode; width?: "data" | "read" | "form"; className?: string }) {
  return (
    <div
      className={cx(
        SECTIONS,
        "mx-auto w-full px-(--gutter) pt-6 pb-16 md:pt-8",
        width === "data" ? "max-w-(--page-max)" : width === "read" ? "max-w-[800px]" : "max-w-[480px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · encore` : "encore";
  }, [title]);
}

/** Page title (display face), an optional one-line description, actions on the right, and a slot under it for tabs. */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  useDocumentTitle(title);
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:gap-x-6">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-title text-balance text-primary">{title}</h1>
          {description && <p className="max-w-2xl text-secondary text-pretty">{description}</p>}
        </div>
        {actions && <div className="flex max-w-full shrink-0 items-center gap-2 phone:w-full">{actions}</div>}
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
