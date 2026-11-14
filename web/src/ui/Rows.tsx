import type { ReactNode } from "react";
import type { AlbumStats, ArtistStats, Song } from "../api/types";
import { albumPath, artistPath, songPath } from "../app/paths";
import { DitherMeter } from "../charts/DitherMeter";
import { usePlayback } from "../player/playback";
import { AppLink } from "./AppLink";
import { Artwork } from "./Artwork";
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
  art: { src: string | null | undefined; round?: boolean };
  rank?: number;
  value?: ReactNode;
  /** Share of the top row, 0 to 1; draws the dither meter when the list is 512px or wider. */
  share?: number;
  song?: SongRef;
};

/**
 * One row of a ranked list at Mercury density: rank, art, title over subtitle, an optional dither meter,
 * a right-aligned tabular figure, and hover actions (play, menu) for songs. Whole row is the link.
 */
export function Row({ to, title, subtitle, art, rank, value, share, song }: RowProps) {
  const playback = usePlayback();
  const body = (
    <>
      <AppLink to={to} className="absolute inset-0 rounded-md" aria-label={subtitle && typeof subtitle === "string" ? `${title}, ${subtitle}` : title} />
      {rank !== undefined && <span className="pointer-events-none w-5 shrink-0 text-right text-caption text-tertiary tabular">{rank}</span>}
      <Artwork src={art.src} name={title} round={art.round} box={32} className="pointer-events-none phone:size-10" />
      <span className="pointer-events-none flex min-w-0 flex-1 flex-col">
        <span className="truncate text-primary">{title}</span>
        {subtitle && <span className="truncate text-caption text-secondary">{subtitle}</span>}
      </span>
      {share !== undefined && <DitherMeter share={share} className="pointer-events-none hidden w-24 shrink-0 @lg:block" />}
      {value !== undefined && <span className="pointer-events-none w-16 shrink-0 text-right text-secondary tabular">{value}</span>}
      {song && (
        <span className="relative flex shrink-0 items-center md:opacity-0 md:transition-opacity md:duration-150 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:has-[[data-popup-open]]:opacity-100">
          <IconButton icon={PlayIcon} label={`Play ${title}`} size="sm" className="max-md:hidden" onClick={() => playback.play([song.uri])} />
          <SongMenu song={song} />
        </span>
      )}
    </>
  );
  const cls = "group relative -mx-2 flex min-h-(--row-h) items-center gap-3 rounded-md px-2 transition-colors duration-150 hover:bg-fill";
  if (!song)
    return (
      <li className={cls} data-row>
        {body}
      </li>
    );
  return (
    <SongContext song={song} render="li" className={cls}>
      {body}
    </SongContext>
  );
}

export function TrackRow({ song, rank, value, share }: { song: Song; rank?: number; value?: ReactNode; share?: number }) {
  return (
    <Row
      to={songPath(song.songKey)}
      title={song.name}
      subtitle={song.artist}
      art={{ src: song.albumArtUrl }}
      rank={rank}
      value={value}
      share={share}
      song={{ uri: song.uri, name: song.name, songKey: song.songKey, artist: song.artist }}
    />
  );
}

export function ArtistRow({ artist, rank, value, share, subtitle }: { artist: ArtistStats; rank?: number; value?: ReactNode; share?: number; subtitle?: ReactNode }) {
  return <Row to={artistPath(artist.artist)} title={artist.artist} subtitle={subtitle} art={{ src: artist.imageUrl, round: true }} rank={rank} value={value} share={share} />;
}

export function AlbumRow({ album, rank, value, share }: { album: AlbumStats; rank?: number; value?: ReactNode; share?: number }) {
  return (
    <Row to={albumPath(album.artist, album.album)} title={album.album} subtitle={album.artist} art={{ src: album.albumArtUrl }} rank={rank} value={value} share={share} />
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
