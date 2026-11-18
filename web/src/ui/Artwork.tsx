import { useState } from "react";
import { cx } from "./cx";
import { Icon, type IconGlyph } from "./Icon";
import { MicrophoneIcon, MicrophoneStageIcon, MusicNoteIcon, PlaylistIcon, VinylRecordIcon } from "./icons";

const FAMILIES = [
  { prefixes: ["ab67616d00004851", "ab67616d00001e02", "ab67616d0000b273"], pick: { sm: 0, md: 1, lg: 2 } },
  { prefixes: ["ab6761610000f178", "ab67616100005174", "ab6761610000e5eb"], pick: { sm: 0, md: 1, lg: 2 } },
] as const;

export type ArtSize = "sm" | "md" | "lg";

/** Picks the smallest Spotify image that still covers the drawn size (64, 300, 640 px). */
export function sizedArt(url: string, size: ArtSize) {
  for (const { prefixes, pick } of FAMILIES) {
    const current = prefixes.find((p) => url.includes(`/image/${p}`));
    if (current) return url.replace(current, prefixes[pick[size]]);
  }
  return url;
}

const BOX = { 20: "size-5", 24: "size-6", 32: "size-8", 40: "size-10", 48: "size-12", 56: "size-14", 64: "size-16" } as const;
export type ArtBox = keyof typeof BOX;

/** What the artwork shows. Sets the shape (artists are round) and the glyph drawn when there is no image. */
export type ArtKind = "artist" | "album" | "song" | "playlist" | "podcast";

export const ART_GLYPH: Record<ArtKind, IconGlyph> = {
  artist: MicrophoneStageIcon,
  album: VinylRecordIcon,
  song: MusicNoteIcon,
  playlist: PlaylistIcon,
  podcast: MicrophoneIcon,
};

/**
 * Album art, an artist photo or a playlist cover, always decorative next to its name. While the image loads the
 * box is a plain fill; with no image, or one that fails to load, the fill carries the kind's glyph. The box never
 * changes size between the three.
 */
export function Artwork({
  src,
  kind,
  box = 40,
  className,
}: {
  src: string | null | undefined;
  kind: ArtKind;
  box?: ArtBox | "fill";
  className?: string;
}) {
  const [settled, setSettled] = useState<{ src: string; ok: boolean } | null>(null);
  const size: ArtSize = box === "fill" ? "lg" : box <= 40 ? "sm" : "md";
  const missing = !src || (settled?.src === src && !settled.ok);
  const loaded = settled !== null && settled.src === src && settled.ok;
  return (
    <span
      aria-hidden
      className={cx(
        "@container relative flex aspect-square shrink-0 items-center justify-center overflow-hidden bg-fill select-none",
        kind === "artist" ? "rounded-full" : box === "fill" || box >= 56 ? "rounded-md" : "rounded-xs",
        box === "fill" ? "w-full" : BOX[box],
        className,
      )}
    >
      {missing ? (
        <Icon icon={ART_GLYPH[kind]} size="fill" className="size-[clamp(12px,round(down,50cqw,2px),48px)] text-tertiary" />
      ) : (
        <img
          key={src}
          src={sizedArt(src, size)}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => setSettled({ src, ok: true })}
          onError={() => setSettled({ src, ok: false })}
          className={cx("absolute inset-0 size-full object-cover transition-opacity duration-200 ease-out", loaded ? "opacity-100" : "opacity-0")}
        />
      )}
    </span>
  );
}
