import type { ComponentProps } from "react";
import { Link, useSearchParams } from "wouter";
import { rangeSearch } from "../lib/range";

export function useRangeHref() {
  const [params] = useSearchParams();
  const search = rangeSearch({ from: params.get("from") ?? undefined, to: params.get("to") ?? undefined });
  return (path: string) => {
    if (!search) return path;
    return path.includes("?") ? `${path}&${search.slice(1)}` : `${path}${search}`;
  };
}

export function AppLink({ to, ...props }: { to: string } & Omit<ComponentProps<"a">, "href">) {
  const href = useRangeHref();
  return <Link href={href(to)} {...props} />;
}

export const artistPath = (name: string) => `/artist/${encodeURIComponent(name)}`;
export const songPath = (songKey: string) => `/song/${encodeURIComponent(songKey)}`;
export const albumPath = (artist: string, album: string) => `/album/${encodeURIComponent(artist)}/${encodeURIComponent(album)}`;
