import type { ReactNode } from "react";
import { Artwork, type ArtKind } from "./Artwork";
import { Skeleton } from "./Skeleton";

/**
 * The head of an artist, album or song page (`kind`): artwork left, title over its credits and one line of detail,
 * the page's actions under them. `aside` (the range picker) sits top right on desktop, last on phone.
 */
export function EntityHeader({
  title,
  art,
  kind,
  credits,
  detail,
  actions,
  aside,
}: {
  title: string;
  art: string | null | undefined;
  kind: ArtKind;
  credits?: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 md:flex-row md:items-end md:gap-6">
      <div className="w-28 shrink-0 md:w-40">
        <Artwork src={art} kind={kind} box="fill" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 title={title} className="line-clamp-3 font-serif text-title text-balance break-words text-primary">
            {title}
          </h1>
          {(credits || detail) && (
            <div className="flex min-w-0 flex-col gap-1">
              {credits && <p className="min-w-0 text-body text-secondary">{credits}</p>}
              {detail && <p className="text-caption text-secondary">{detail}</p>}
            </div>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {aside && <div className="flex shrink-0 phone:w-full md:self-start">{aside}</div>}
    </header>
  );
}

export function EntityHeaderSkeleton({ round = false }: { round?: boolean }) {
  return (
    <div aria-hidden className="flex flex-col gap-5 md:flex-row md:items-end md:gap-6">
      <Skeleton className={round ? "size-28 rounded-full md:size-40" : "size-28 rounded-md md:size-40"} />
      <div className="flex flex-1 flex-col gap-3">
        <Skeleton className="h-9 w-2/3 max-w-80" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-2 h-(--control-h) w-24" />
      </div>
    </div>
  );
}
