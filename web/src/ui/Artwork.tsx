import { useState, type ReactNode } from "react";
import { DitherGradient } from "../components/dither-kit/gradient";
import { DitherAvatar } from "../components/dither-kit/avatar";

const FAMILIES = [
  { prefixes: ["ab67616d00004851", "ab67616d00001e02", "ab67616d0000b273"], pick: { sm: 1, md: 1, lg: 2 } },
  { prefixes: ["ab6761610000f178", "ab67616100005174", "ab6761610000e5eb"], pick: { sm: 0, md: 1, lg: 2 } },
] as const;

export type ArtSize = "sm" | "md" | "lg";

export function sizedArt(url: string, size: ArtSize) {
  for (const { prefixes, pick } of FAMILIES) {
    const current = prefixes.find((p) => url.includes(`/image/${p}`));
    if (current) return url.replace(current, prefixes[pick[size]]);
  }
  return url;
}

export function Artwork({
  src,
  name,
  round = false,
  size = "sm",
  className = "",
}: {
  src: string | null | undefined;
  name?: string;
  round?: boolean;
  size?: ArtSize;
  className?: string;
}) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  const showImage = src && state !== "failed";
  return (
    <span
      aria-hidden
      className={`relative flex aspect-square shrink-0 items-center justify-center overflow-hidden bg-raised text-secondary select-none ${round ? "rounded-full" : "rounded-md"} ${className}`}
    >
      {name && (!src || state === "failed") && <DitherAvatar name={name} animate={false} className="absolute inset-[18%]" />}
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
          className={`absolute inset-0 size-full object-cover transition-opacity duration-200 ease-out ${state === "loaded" ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </span>
  );
}

export function ArtTint({ src }: { src: string | null | undefined }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[460px] overflow-hidden [mask-image:linear-gradient(to_bottom,black,transparent)]"
    >
      {src ? (
        <img
          src={sizedArt(src, "sm")}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full scale-125 object-cover opacity-25 blur-3xl saturate-150 dark:opacity-35"
        />
      ) : (
        <DitherGradient from="grey" direction="down" opacity={0.35} />
      )}
    </div>
  );
}

export function EntityHero({
  art,
  round = false,
  name,
  meta,
  controls,
}: {
  art: string | null | undefined;
  round?: boolean;
  name: string;
  meta?: ReactNode;
  controls: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-5 text-center md:flex-row md:items-end md:gap-8 md:text-left">
      <ArtTint src={art} />
      <Artwork
        src={art}
        name={name}
        round={round}
        size="lg"
        className={round ? "w-44 shadow-large md:w-52" : "w-full max-w-[360px] rounded-xl shadow-large md:w-52"}
      />
      <div className="flex min-w-0 flex-col gap-1.5 md:pb-1">
        <h1 className="text-heading-4 font-semibold text-balance md:text-heading-2">{name}</h1>
        {meta && <div className="text-body-lg font-medium text-secondary">{meta}</div>}
        <div className="mt-3">{controls}</div>
      </div>
    </div>
  );
}
