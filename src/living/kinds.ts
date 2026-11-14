import type { AbstractStyle } from "../covers/style";
import type { Hue } from "../covers/tint";
import type { Db } from "../db/client";
import { LIVING_KINDS, type LivingKind, type LivingTrack } from "../db/schema";
import { forgottenTracks, mostPlayedTracks, newReleaseTracks, picksTracks, thisMonthTracks, thisYearTracks, type BuildContext } from "./build";

/** Refreshed once per local day, week (from Monday) or month, or when its source changes. `yearly-weekly`: each week, and when the year turns. */
export type LivingSchedule = "daily" | "weekly" | "monthly" | "yearly-weekly" | "picks" | "releases";

export type LivingKindSpec = {
  id: LivingKind;
  /** The playlist name in Spotify, on the cover and in the app. */
  name: string;
  /** What the playlist holds, for its Spotify description and the app. */
  about: (ctx: BuildContext) => string;
  mode: "replace" | "rolling";
  schedule: LivingSchedule;
  /** Rolling only: songs added per refresh once the playlist is full. */
  perRefresh?: number;
  cover: { style: AbstractStyle; colours: { lead: Hue; second: Hue } };
  build: (db: Db, ctx: BuildContext) => LivingTrack[];
  /** Makes no playlist while there is nothing to put in it. */
  waitForSongs?: boolean;
};

export const LIVING_CAP = 50;

const monthName = (ctx: BuildContext) => new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: ctx.timezone }).format(ctx.now);

export const LIVING: Record<LivingKind, LivingKindSpec> = {
  picks: {
    id: "picks",
    name: "Weekly picks",
    about: () => "This week's new songs picked for you",
    mode: "replace",
    schedule: "picks",
    cover: { style: "orb", colours: { lead: { h: 0.11, s: 0.8 }, second: { h: 0.07, s: 0.75 } } },
    build: (db) => picksTracks(db),
  },
  forgotten: {
    id: "forgotten",
    name: "Forgotten favourites",
    about: () => "Songs you played a lot, then stopped playing",
    mode: "rolling",
    schedule: "weekly",
    perRefresh: 10,
    cover: { style: "waves", colours: { lead: { h: 0.6, s: 0.55 }, second: { h: 0.68, s: 0.5 } } },
    build: forgottenTracks,
  },
  "most-played": {
    id: "most-played",
    name: "Most played lately",
    about: () => "Your most played songs of the last four weeks",
    mode: "replace",
    schedule: "daily",
    cover: { style: "rings", colours: { lead: { h: 0.95, s: 0.7 }, second: { h: 0.92, s: 0.6 } } },
    build: mostPlayedTracks,
  },
  "new-releases": {
    id: "new-releases",
    name: "New from your artists",
    about: () => "Songs from new releases by artists you play",
    mode: "rolling",
    schedule: "releases",
    perRefresh: LIVING_CAP,
    cover: { style: "rays", colours: { lead: { h: 0.48, s: 0.7 }, second: { h: 0.52, s: 0.6 } } },
    build: newReleaseTracks,
  },
  "this-month": {
    id: "this-month",
    name: "This month in past years",
    about: (ctx) => `What you played most in ${monthName(ctx)} in earlier years`,
    mode: "replace",
    schedule: "monthly",
    cover: { style: "tiles", colours: { lead: { h: 0.3, s: 0.55 }, second: { h: 0.36, s: 0.6 } } },
    build: thisMonthTracks,
  },
  "this-year": {
    id: "this-year",
    name: "This year so far",
    about: (ctx) => `The songs that defined ${new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: ctx.timezone }).format(ctx.now)} so far`,
    mode: "replace",
    schedule: "yearly-weekly",
    cover: { style: "tiles", colours: { lead: { h: 0.02, s: 0.7 }, second: { h: 0.98, s: 0.6 } } },
    build: (db, ctx) => thisYearTracks(db, ctx, LIVING_CAP),
    waitForSongs: true,
  },
};

export const LIVING_ORDER: LivingKind[] = [...LIVING_KINDS];

export const isLivingKind = (value: string): value is LivingKind => (LIVING_KINDS as readonly string[]).includes(value);
