import type { ReactNode } from "react";
import { AppLink } from "./AppLink";
import { Artwork } from "./Artwork";
import { Skeleton } from "./states";

const PHONE_TRACK = "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
const DESKTOP_TRACK = "md:-mx-10 md:scroll-px-10 md:gap-5 md:px-10";
const DESKTOP_GRID = "md:mx-0 md:grid md:grid-cols-[repeat(auto-fill,minmax(168px,1fr))] md:gap-x-5 md:gap-y-6 md:overflow-visible md:px-0 md:[&>li]:w-auto";
const TRACK = `${PHONE_TRACK} ${DESKTOP_TRACK}`;
const WIDTH = "w-[136px] md:w-[168px]";

export function Shelf({ label, children, expanded = false, className = "" }: { label: string; children: ReactNode; expanded?: boolean; className?: string }) {
  return (
    <ol aria-label={label} className={`${PHONE_TRACK} ${expanded ? DESKTOP_GRID : DESKTOP_TRACK} ${className}`}>
      {children}
    </ol>
  );
}

export function ShowAll({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="btn btn-transparent -mr-3 max-md:hidden" aria-expanded={expanded} onClick={onToggle}>
      {expanded ? "Show less" : "Show all"}
    </button>
  );
}

export function Tile({
  to,
  src,
  round = false,
  rank,
  title,
  subtitle,
}: {
  to: string;
  src: string | null | undefined;
  round?: boolean;
  rank?: number;
  title: string;
  subtitle?: ReactNode;
}) {
  return (
    <li className={`shrink-0 snap-start ${WIDTH}`}>
      <AppLink to={to} className={`group flex flex-col gap-2 ${round ? "items-center text-center" : ""}`}>
        <span className="block w-full overflow-hidden rounded-[inherit] transition-transform duration-200 ease-(--ease-out-quint) group-active:scale-[0.98]">
          <Artwork src={src} name={title} round={round} size="md" className={`w-full ${round ? "" : "rounded-lg"}`} />
        </span>
        <span className="flex w-full min-w-0 flex-col">
          <span className="truncate font-medium text-primary">
            {rank !== undefined && <span className="mr-1.5 font-semibold text-tertiary tabular">{rank}</span>}
            {title}
          </span>
          {subtitle && <span className="truncate text-body-sm text-secondary tabular">{subtitle}</span>}
        </span>
      </AppLink>
    </li>
  );
}

export function ShelfSkeleton({ round = false, count = 6 }: { round?: boolean; count?: number }) {
  return (
    <div aria-hidden className={`${TRACK} overflow-hidden`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`flex shrink-0 flex-col gap-2 ${WIDTH}`}>
          <Skeleton className={`aspect-square w-full ${round ? "rounded-full" : "rounded-lg"}`} />
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
