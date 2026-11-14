import { Fragment } from "react";
import type { Crumb } from "../app/nav";
import { AppLink } from "./AppLink";
import { Icon } from "./Icon";
import { CaretLeftIcon, CaretRightIcon } from "./icons";
import { Skeleton } from "./Skeleton";

/**
 * Where a page sits below its surface. Desktop: the whole trail, ending in the page's own name (not a link).
 * Phone: one link back to the parent. `current` is undefined while the page's data loads and null when it failed.
 */
export function Breadcrumbs({ trail, current }: { trail: Crumb[]; current: string | null | undefined }) {
  const parent = trail.at(-1)!;
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-1.5 text-body-sm phone:hidden">
        {trail.map((c) => (
          <Fragment key={c.path}>
            <li className="flex min-w-0 shrink-[2]">
              <AppLink to={c.path} title={c.label} className="truncate text-secondary transition-colors duration-150 hover:text-primary">
                {c.label}
              </AppLink>
            </li>
            {current !== null && (
              <li aria-hidden className="flex shrink-0 text-tertiary">
                <Icon icon={CaretRightIcon} size="sm" />
              </li>
            )}
          </Fragment>
        ))}
        {current === undefined && (
          <li className="flex w-24 shrink-0">
            <Skeleton className="h-3 w-full" />
            <span className="sr-only">Loading</span>
          </li>
        )}
        {current && (
          <li className="flex min-w-0 shrink">
            <span aria-current="page" title={current} className="truncate text-primary">
              {current}
            </span>
          </li>
        )}
      </ol>
      <AppLink to={parent.path} className="-ml-2 flex h-11 min-w-0 items-center gap-1 rounded-md px-2 text-body text-secondary md:hidden">
        <Icon icon={CaretLeftIcon} className="shrink-0" />
        <span className="truncate">{parent.label}</span>
      </AppLink>
    </nav>
  );
}
