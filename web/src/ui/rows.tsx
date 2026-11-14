import type { ReactNode } from "react";
import { AppLink } from "./AppLink";
import { Artwork } from "./Artwork";
import { SongContext, SongMenu, type SongRef } from "./SongMenu";

export function RowList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <ol className={`flex flex-col [&>li+li]:border-t-[0.5px] [&>li+li]:border-border-default ${className}`}>{children}</ol>;
}

export function Row({
  to,
  rank,
  title,
  subtitle,
  value,
  detail,
  art,
  song,
}: {
  to?: string;
  song?: SongRef;
  rank?: number;
  art?: { src: string | null | undefined; name?: string; round?: boolean };
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  detail?: ReactNode;
}) {
  const body = (
    <>
      {rank !== undefined && <span className="w-6 shrink-0 text-center text-body-base font-semibold text-secondary tabular">{rank}</span>}
      {art && <Artwork src={art.src} name={art.name ?? (typeof title === "string" ? title : undefined)} round={art.round} className="size-11 md:size-10" />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-primary">{title}</span>
        {subtitle && <span className="truncate text-body-sm text-secondary">{subtitle}</span>}
      </span>
      {(value !== undefined || detail) && (
        <span className="flex shrink-0 flex-col items-end">
          {value !== undefined && <span className="text-primary tabular">{value}</span>}
          {detail && <span className="text-body-sm text-secondary tabular">{detail}</span>}
        </span>
      )}
    </>
  );
  const cls = "-mx-2 flex min-h-14 flex-1 min-w-0 items-center gap-3 rounded-lg px-2 py-1.5";
  const main = to ? (
    <AppLink to={to} className={`${cls} transition-colors duration-150 hover-fine:bg-transparent-hover`}>
      {body}
    </AppLink>
  ) : (
    <div className={cls}>{body}</div>
  );
  if (!song) return <li className="flex">{main}</li>;
  return (
    <SongContext song={song} className="group flex items-center gap-1">
      {main}
      <SongMenu song={song} className="max-md:hidden md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[popup-open]:opacity-100" />
    </SongContext>
  );
}

export function MoreButton({
  expanded,
  onClick,
  more = "Show more",
  less = "Show fewer",
}: {
  expanded: boolean;
  onClick: () => void;
  more?: string;
  less?: string;
}) {
  return (
    <button type="button" className="btn btn-transparent -ml-3 self-start" onClick={onClick} aria-expanded={expanded}>
      {expanded ? less : more}
    </button>
  );
}
