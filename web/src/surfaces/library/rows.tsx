import type { ReactNode } from "react";
import { DitherMeter } from "../../charts/DitherMeter";
import { AppLink } from "../../ui/AppLink";
import { Artwork } from "../../ui/Artwork";
import { cx } from "../../ui/cx";

/** A row that opens the songs behind a figure: title over subtitle, an optional meter, the figure right. */
export function FigureRow({ to, title, subtitle, value, share }: { to: string; title: string; subtitle?: string; value: string; share?: number }) {
  return (
    <li className={cx("group relative -mx-2 flex items-center gap-3 rounded-md px-2 transition-colors duration-150 hover:bg-fill", subtitle ? "min-h-(--row-h) py-1.5" : "min-h-11 py-2")}>
      <AppLink to={to} className="absolute inset-0 rounded-md" aria-label={`${title}${subtitle ? `, ${subtitle}` : ""}: ${value}`} />
      <span className="pointer-events-none flex min-w-0 flex-1 flex-col">
        <span className="truncate text-primary">{title}</span>
        {subtitle && <span className="truncate text-caption text-secondary">{subtitle}</span>}
      </span>
      {share !== undefined && <DitherMeter share={share} className="pointer-events-none hidden w-24 shrink-0 @md:block" />}
      <span className="pointer-events-none min-w-12 shrink-0 text-right text-secondary tabular">{value}</span>
    </li>
  );
}

/** A song with the evidence line under it. `lead` is a checkbox in a plan; `end` holds per-song actions. */
export function SongLine({
  name,
  artist,
  art,
  detail,
  lead,
  end,
  muted = false,
  className,
}: {
  name: string;
  artist: string;
  art: string | null;
  detail: ReactNode;
  lead?: ReactNode;
  end?: ReactNode;
  muted?: boolean;
  className?: string;
}) {
  return (
    <li className={cx("-mx-2 flex min-h-(--row-h) items-center gap-3 rounded-md px-2 py-2", className)}>
      {lead}
      <Artwork src={art} kind="song" box={40} />
      <div className={cx("flex min-w-0 flex-1 flex-col", muted && "opacity-60")}>
        <span className="truncate text-primary" title={name}>
          {name}
        </span>
        <span className="truncate text-caption text-secondary" title={artist}>
          {artist}
        </span>
        <span className="text-caption text-pretty text-secondary">{detail}</span>
      </div>
      {end}
    </li>
  );
}
