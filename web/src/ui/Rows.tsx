import type { CSSProperties, ReactNode } from "react";
import type { AlbumStats, ArtistStats, Song } from "../api/types";
import { albumPath, artistPath, songPath } from "../app/paths";
import { DitherMeter } from "../charts/DitherMeter";
import { usePlayback } from "../player/playback";
import { AppLink } from "./AppLink";
import { Artwork, type ArtKind } from "./Artwork";
import { IconButton } from "./Button";
import { cx } from "./cx";
import { PlayIcon } from "./icons";
import { Skeleton } from "./Skeleton";
import { SongContext, SongMenu, type SongRef } from "./SongMenu";

/** A ranked or plain list of rows separated by hairlines. */
export function RowList({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <ol aria-label={label} className={cx("@container flex flex-col", className)}>
      {children}
    </ol>
  );
}

type RowProps = {
  to: string;
  title: string;
  subtitle?: ReactNode;
  art: { src: string | null | undefined; kind: ArtKind };
  rank?: number;
  value?: ReactNode;
  /** Share of the top row, 0 to 1; draws the dither meter when the list is 512px or wider. */
  share?: number;
  song?: SongRef;
  /** Positions the row inside a virtualised list. */
  style?: CSSProperties;
};

/**
 * One row of a ranked list at Mercury density: rank, art, title over subtitle, an optional dither meter,
 * a right-aligned tabular figure, and hover actions (play, menu) for songs. Whole row is the link.
 */
/** With a mouse the song actions sit over the figure while they show, so hidden actions take no width from the title. */
const HIDE_ON_ACTIONS =
  "md:transition-opacity md:duration-150 md:group-hover:opacity-0 md:can-hover:group-focus-within:opacity-0 md:can-hover:group-has-[[data-popup-open]]:opacity-0";

export function Row({ to, title, subtitle, art, rank, value, share, song, style }: RowProps) {
  const playback = usePlayback();
  const actionsOver = value !== undefined;
  const body = (
    <>
      <AppLink to={to} className="absolute inset-0 rounded-md" aria-label={subtitle && typeof subtitle === "string" ? `${title}, ${subtitle}` : title} />
      {rank !== undefined && <span className="pointer-events-none w-[var(--rank-w,1.25rem)] shrink-0 text-right text-caption text-tertiary tabular">{rank}</span>}
      <Artwork src={art.src} kind={art.kind} box={32} className="pointer-events-none phone:size-10" />
      <span className="pointer-events-none flex min-w-0 flex-1 flex-col">
        <span className="truncate text-primary">{title}</span>
        {subtitle && <span className="truncate text-caption text-secondary">{subtitle}</span>}
      </span>
      {share !== undefined && <DitherMeter share={share} className="pointer-events-none hidden w-24 shrink-0 @lg:block" />}
      {value !== undefined && (
        <span className={cx("pointer-events-none w-16 shrink-0 text-right text-secondary tabular", song && actionsOver && HIDE_ON_ACTIONS)}>{value}</span>
      )}
      {song && (
        <span
          className={cx(
            "flex shrink-0 items-center md:transition-opacity md:duration-150 md:can-hover:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:group-has-[[data-popup-open]]:opacity-100",
            actionsOver ? "relative md:can-hover:absolute md:can-hover:top-1/2 md:can-hover:right-2 md:can-hover:-translate-y-1/2" : "relative",
          )}
        >
          <IconButton icon={PlayIcon} label={`Play ${title}`} size="sm" className="max-md:hidden" onClick={() => playback.play([song.uri])} />
          <SongMenu song={song} />
        </span>
      )}
    </>
  );
  const cls = "group relative -mx-2 flex min-h-(--row-h) items-center gap-3 rounded-md px-2 transition-colors duration-150 hover:bg-fill";
  if (!song)
    return (
      <li className={cls} style={style} data-row>
        {body}
      </li>
    );
  return (
    <SongContext song={song} render="li" className={cls} style={style}>
      {body}
    </SongContext>
  );
}

export function TrackRow({ song, rank, value, share, style }: { song: Song; rank?: number; value?: ReactNode; share?: number; style?: CSSProperties }) {
  return (
    <Row
      to={songPath(song.songKey)}
      title={song.name}
      subtitle={song.artist}
      art={{ src: song.albumArtUrl, kind: "song" }}
      rank={rank}
      value={value}
      share={share}
      style={style}
      song={{ uri: song.uri, name: song.name, songKey: song.songKey, artist: song.artist }}
    />
  );
}

export function ArtistRow({
  artist,
  rank,
  value,
  share,
  subtitle,
  style,
}: {
  artist: ArtistStats;
  rank?: number;
  value?: ReactNode;
  share?: number;
  subtitle?: ReactNode;
  style?: CSSProperties;
}) {
  return <Row to={artistPath(artist.artist)} title={artist.artist} subtitle={subtitle} art={{ src: artist.imageUrl, kind: "artist" }} rank={rank} value={value} share={share} style={style} />;
}

export function AlbumRow({ album, rank, value, share, style }: { album: AlbumStats; rank?: number; value?: ReactNode; share?: number; style?: CSSProperties }) {
  return (
    <Row to={albumPath(album.artist, album.album)} title={album.album} subtitle={album.artist} art={{ src: album.albumArtUrl, kind: "album" }} rank={rank} value={value} share={share} style={style} />
  );
}

export function RowSkeleton({ rows = 6, rank = false }: { rows?: number; rank?: boolean }) {
  return (
    <div aria-hidden className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-(--row-h) items-center gap-3">
          {rank && <span className="w-5" />}
          <Skeleton className="size-8 phone:size-10" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}
