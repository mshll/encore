import { useState } from "react";
import { DitherAvatar } from "../components/dither-kit/avatar";
import { cx } from "./cx";

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

const BOX = { 24: "size-6", 32: "size-8", 40: "size-10", 48: "size-12", 56: "size-14", 64: "size-16" } as const;
export type ArtBox = keyof typeof BOX;

/**
 * Album art or an artist photo. Missing or broken images fall back to a dithered avatar seeded by the name,
 * so a row never shows an empty box. `round` is for artists.
 */
export function Artwork({
  src,
  name,
  box = 40,
  round = false,
  className,
}: {
  src: string | null | undefined;
  name: string;
  box?: ArtBox | "fill";
  round?: boolean;
  className?: string;
}) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  const size: ArtSize = box === "fill" ? "lg" : box <= 40 ? "sm" : "md";
  const showImage = src && state !== "failed";
  return (
    <span
      aria-hidden
      className={cx(
        "relative flex aspect-square shrink-0 items-center justify-center overflow-hidden bg-fill select-none",
        round ? "rounded-full" : box === "fill" || box >= 56 ? "rounded-md" : "rounded-xs",
        box === "fill" ? "w-full" : BOX[box],
        className,
      )}
    >
      {(!src || state === "failed") && <DitherAvatar name={name} animate={false} className="absolute inset-[18%]" />}
      {showImage && (
        <img
          key={src}
          src={sizedArt(src, size)}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => setState("loaded")}
          onError={() => setState("failed")}
          className={cx("absolute inset-0 size-full object-cover transition-opacity duration-200 ease-out", state === "loaded" ? "opacity-100" : "opacity-0")}
        />
      )}
    </span>
  );
}
