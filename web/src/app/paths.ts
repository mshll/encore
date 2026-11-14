import type { RecapKind } from "../api/types";

export const artistPath = (name: string) => `/music/artist/${encodeURIComponent(name)}`;
export const songPath = (songKey: string) => `/music/song/${encodeURIComponent(songKey)}`;
export const albumPath = (artist: string, album: string) => `/music/album/${encodeURIComponent(artist)}/${encodeURIComponent(album)}`;
export const RECAP_SLUGS = { weekly: "week", monthly: "month", yearly: "year" } as const satisfies Record<RecapKind, string>;
export type RecapSlug = (typeof RECAP_SLUGS)[RecapKind];
export const recapPath = (kind: RecapKind, key: string) => `/recaps/${RECAP_SLUGS[kind]}/${key}`;
/** Wouter runs `decodeURI` on the path, which leaves reserved characters escaped; this decodes those for one param. */
export const paramValue = (param: string) => param.replace(/%(2[346BCF]|3[ABDF]|40)/gi, (escape) => decodeURIComponent(escape));
