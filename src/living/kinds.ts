import type { AbstractStyle } from "../covers/style";
import type { Hue } from "../covers/tint";
import { LIVING_KINDS, type LivingKind } from "../db/schema";
import { momentOf, type BuildContext } from "./engine";
import type { Rule } from "./rules";
import type { LivingRow } from "./schedule";

export type LivingCover = { style: AbstractStyle; colours: { lead: Hue; second: Hue } };

/** What fills a playlist and how it looks: a built-in kind or one of the owner's rules. */
export type LivingSpec = {
  id: string;
  builtin: boolean;
  /** The playlist name in Spotify, on the cover and in the app. */
  name: string;
  /** What the playlist holds, for its Spotify description and the app. */
  about: (ctx: BuildContext) => string;
  cover: LivingCover;
  rule: Rule;
  /** Makes no playlist while there is nothing to put in it. */
  waitForSongs: boolean;
};

export const LIVING_CAP = 50;

const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;
const monthName = (ctx: BuildContext) => new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: ctx.timezone }).format(ctx.now);

const builtin = (spec: Omit<LivingSpec, "builtin" | "waitForSongs"> & { waitForSongs?: boolean }): LivingSpec => ({ builtin: true, waitForSongs: false, ...spec });

export const LIVING: Record<LivingKind, LivingSpec> = {
  picks: builtin({
    id: "picks",
    name: "Weekly picks",
    about: () => "This week's new songs picked for you",
    cover: { style: "orb", colours: { lead: { h: 0.11, s: 0.8 }, second: { h: 0.07, s: 0.75 } } },
    rule: { source: { type: "picks" }, filters: {}, sort: "source", limit: LIVING_CAP, schedule: "picks" },
  }),
  forgotten: builtin({
    id: "forgotten",
    name: "Forgotten favourites",
    about: () => "Songs you played a lot, then stopped playing",
    cover: { style: "waves", colours: { lead: { h: 0.6, s: 0.55 }, second: { h: 0.68, s: 0.5 } } },
    rule: {
      source: { type: "history", window: { type: "all" } },
      filters: { listens: { min: 10 }, lastPlayed: { before: { daysAgo: 90 } } },
      sort: "listens-by-key",
      limit: LIVING_CAP,
      rolling: { perRefresh: 10 },
      schedule: "weekly",
    },
  }),
  "most-played": builtin({
    id: "most-played",
    name: "Most played lately",
    about: () => "Your most played songs of the last four weeks",
    cover: { style: "rings", colours: { lead: { h: 0.95, s: 0.7 }, second: { h: 0.92, s: 0.6 } } },
    rule: { source: { type: "history", window: { type: "days", days: 28 } }, filters: { listens: { min: 2 } }, sort: "listens-by-key", limit: LIVING_CAP, schedule: "daily" },
  }),
  "new-releases": builtin({
    id: "new-releases",
    name: "New from your artists",
    about: () => "Songs from new releases by artists you play",
    cover: { style: "rays", colours: { lead: { h: 0.48, s: 0.7 }, second: { h: 0.52, s: 0.6 } } },
    rule: { source: { type: "releases", days: 90 }, filters: {}, sort: "source", limit: LIVING_CAP, rolling: { perRefresh: LIVING_CAP }, schedule: "releases" },
  }),
  "this-month": builtin({
    id: "this-month",
    name: "This month in past years",
    about: (ctx) => `What you played most in ${monthName(ctx)} in earlier years`,
    cover: { style: "tiles", colours: { lead: { h: 0.3, s: 0.55 }, second: { h: 0.36, s: 0.6 } } },
    rule: { source: { type: "history", window: { type: "month-in-past-years" } }, filters: { listens: { min: 1 } }, sort: "listens", limit: LIVING_CAP, schedule: "monthly" },
  }),
  "this-year": builtin({
    id: "this-year",
    name: "This year so far",
    about: (ctx) => `The songs that defined ${new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: ctx.timezone }).format(ctx.now)} so far`,
    cover: { style: "tiles", colours: { lead: { h: 0.02, s: 0.7 }, second: { h: 0.98, s: 0.6 } } },
    rule: { source: { type: "history", window: { type: "year-to-date" } }, filters: { listens: { min: 2 } }, sort: "listens", limit: LIVING_CAP, schedule: "yearly-weekly" },
    waitForSongs: true,
  }),
  "right-now": builtin({
    id: "right-now",
    name: "Right now",
    about: (ctx) => {
      const { from, to } = momentOf(ctx.now, ctx.timezone);
      const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: ctx.timezone }).format(ctx.now);
      return `What you play on ${weekday}s from ${hour(from)} to ${hour(to)}`;
    },
    cover: { style: "orb", colours: { lead: { h: 0.75, s: 0.6 }, second: { h: 0.8, s: 0.55 } } },
    rule: { source: { type: "moment", weekdays: "today", hours: "now" }, filters: { listens: { min: 2 } }, sort: "keepers", limit: LIVING_CAP, perArtist: 3, schedule: "window" },
    waitForSongs: true,
  }),
};

export const LIVING_ORDER: LivingKind[] = [...LIVING_KINDS];

export const isLivingKind = (value: string): value is LivingKind => (LIVING_KINDS as readonly string[]).includes(value);

const USER_STYLES: AbstractStyle[] = ["rings", "orb", "waves", "rays", "tiles"];
export const USER_ABOUT = "Built from your rules";

/** A cover of its own for each rule, picked from its id so it stays the same. */
function ruleCover(id: string): LivingCover {
  const hash = [...id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
  const h = (hash % 1000) / 1000;
  return { style: USER_STYLES[hash % USER_STYLES.length]!, colours: { lead: { h, s: 0.65 }, second: { h: (h + 0.05) % 1, s: 0.6 } } };
}

/** The spec of a built-in kind, or of one of the owner's rules from its row. */
export function specOf(row: Pick<LivingRow, "kind" | "name" | "about" | "rule">): LivingSpec {
  if (isLivingKind(row.kind)) return LIVING[row.kind];
  const about = row.about || USER_ABOUT;
  return { id: row.kind, builtin: false, name: row.name!, about: () => about, cover: ruleCover(row.kind), rule: row.rule!, waitForSongs: true };
}
