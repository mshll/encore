import { useQueryClient, type Query } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useLocation, useSearch } from "wouter";
import type { LivingKind, PageContext, PatternView, RecapKind } from "../api/types";
import { rangeLabel } from "../lib/range";
import { PATTERN_TABS } from "./nav";
import { paramValue, RECAP_SLUGS } from "./paths";

const LIVING: LivingKind[] = ["picks", "forgotten", "most-played", "new-releases", "this-month", "this-year", "right-now"];
const VIEWS: PatternView[] = ["when", "eras", "taste", "discovery", "records", "skips", "places"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What the address alone says about the page: the entity's ids. Names that the address does not hold are looked up after. */
export type RouteContext =
  | Extract<PageContext, { kind: "artist" | "album" | "patterns" }>
  | { kind: "song"; songKey: string }
  | { kind: "playlist"; playlist: LivingKind }
  | { kind: "recap"; period: RecapKind; key: string }
  | { kind: "library"; planId?: number }
  | { kind: "set"; setId: number };

const recapKind = (slug: string) => (Object.entries(RECAP_SLUGS) as [RecapKind, string][]).find(([, s]) => s === slug)?.[0];
const positive = (s: string | undefined) => (s && /^\d+$/.test(s) && Number(s) > 0 ? Number(s) : null);

/** The page behind an address (as wouter reports it, `decodeURI`d), or null for a page with no subject (Home, a list, Settings, Ask). */
export function routeContext(location: string, search: string): RouteContext | null {
  const parts = location.split("/").filter(Boolean).map(paramValue);
  const [top, a, b, c] = parts;
  if (top === "music" && a === "artist" && b && parts.length === 3) return { kind: "artist", artist: b };
  if (top === "music" && a === "album" && b && c && parts.length === 4) return { kind: "album", artist: b, album: c };
  if (top === "music" && a === "song" && b && parts.length === 3) return { kind: "song", songKey: b };
  if (top === "for-you" && a && parts.length === 2 && (LIVING as string[]).includes(a)) return { kind: "playlist", playlist: a as LivingKind };
  if (top === "recaps" && a && b && parts.length === 3) {
    const period = recapKind(a);
    return period ? { kind: "recap", period, key: b } : null;
  }
  if (top === "patterns" && a && parts.length === 2 && (VIEWS as string[]).includes(a)) {
    const q = new URLSearchParams(search);
    const from = q.get("from");
    const to = q.get("to");
    return { kind: "patterns", view: a as PatternView, ...(from && DAY.test(from) ? { from } : {}), ...(to && DAY.test(to) ? { to } : {}) };
  }
  if (top === "library") {
    const planId = a === "plans" ? positive(b) : null;
    return planId ? { kind: "library", planId } : { kind: "library" };
  }
  if (top === "sets" && parts.length === 2) {
    const setId = positive(a);
    return setId ? { kind: "set", setId } : null;
  }
  return null;
}

/** The first non-null value `pick` reads from a cached query whose key `match` accepts. Follows the cache without fetching. */
function useCachedValue(match: ((key: readonly unknown[]) => boolean) | null, pick: (data: unknown) => string | null): string | null {
  const queryClient = useQueryClient();
  const cache = queryClient.getQueryCache();
  const subscribe = useCallback((onChange: () => void) => cache.subscribe(onChange), [cache]);
  const read = useCallback(() => {
    if (!match) return null;
    for (const q of cache.findAll({ predicate: (q: Query) => match(q.queryKey) })) {
      const value = q.state.data === undefined ? null : pick(q.state.data);
      if (value) return value;
    }
    return null;
  }, [cache, match, pick]);
  return useSyncExternalStore(subscribe, read);
}

type Named = { name?: string; title?: string; label?: string; artist?: string };

const field = (key: keyof Named) => (data: unknown) => ((data as Named | null)?.[key] as string | undefined) ?? null;

/** How the lookups find a name: the page's own query, already in the cache. */
function lookup(route: RouteContext | null): { match: (key: readonly unknown[]) => boolean; pick: (data: unknown) => string | null } | null {
  switch (route?.kind) {
    case "song":
      return {
        match: (k) => k[0] === "/api/entities/track" && (k[3] as { songKey?: string } | undefined)?.songKey === route.songKey,
        pick: (d) => {
          const song = d as Named;
          return song.name && song.artist ? JSON.stringify([song.name, song.artist]) : null;
        },
      };
    case "playlist":
      return {
        match: (k) => k[0] === "living",
        pick: (d) => {
          const list = d as { items?: { kind: string; name: string }[]; kind?: string; name?: string };
          return list.items ? (list.items.find((p) => p.kind === route.playlist)?.name ?? null) : list.kind === route.playlist ? (list.name ?? null) : null;
        },
      };
    case "recap":
      return { match: (k) => k[0] === "digests" && k[1] === "period" && k[2] === route.period && k[3] === route.key, pick: field("label") };
    case "set":
      return { match: (k) => k[0] === "sets" && k[1] === route.setId, pick: field("title") };
    case "library":
      return route.planId
        ? { match: (k) => k[0] === "library" && k[1] === "plan" && k[2] === route.planId, pick: (d) => (d as { pages?: Named[] }).pages?.[0]?.title ?? null }
        : null;
    default:
      return null;
  }
}

/** The route's context with the names the page has loaded. Null until a name it needs has loaded. */
export function resolveContext(route: RouteContext | null, name: string | null): PageContext | null {
  if (!route) return null;
  switch (route.kind) {
    case "artist":
    case "album":
    case "patterns":
      return route;
    case "song": {
      if (!name) return null;
      const [songName, artist] = JSON.parse(name) as [string, string];
      return { kind: "song", songKey: route.songKey, name: songName, artist };
    }
    case "playlist":
      return name ? { kind: "playlist", playlist: route.playlist, name } : null;
    case "recap":
      return name ? { kind: "recap", period: route.period, key: route.key, label: name } : null;
    case "set":
      return name ? { kind: "set", setId: route.setId, title: name } : null;
    case "library":
      return route.planId ? (name ? { kind: "library", planId: route.planId, title: name } : null) : { kind: "library" };
  }
}

/** The page the owner is on, as the chat sends it with a message. One place: the address, then names from the page's own data. */
export function usePageContext(): PageContext | null {
  const [location] = useLocation();
  const search = useSearch();
  const route = useMemo(() => routeContext(location, search), [location, search]);
  const find = useMemo(() => lookup(route), [route]);
  const name = useCachedValue(find?.match ?? null, find?.pick ?? field("name"));
  return useMemo(() => resolveContext(route, name), [route, name]);
}

/** The chip's words: "Mac Miller", "Skips, all time". */
export function contextLabel(context: PageContext): string {
  switch (context.kind) {
    case "artist":
      return context.artist;
    case "album":
      return context.album;
    case "song":
      return context.name;
    case "playlist":
      return context.name;
    case "recap":
      return context.label;
    case "patterns": {
      const view = PATTERN_TABS.find((t) => t.path === `/patterns/${context.view}`)?.label ?? context.view;
      return `${view}, ${rangeLabel({ from: context.from, to: context.to }, []).replace(/^All time$/, "all time")}`;
    }
    case "library":
      return context.title ?? "Library";
    case "set":
      return context.title;
  }
}
