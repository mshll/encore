import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().min(0).max(100_000);
const year = z.number().int().min(1900).max(2100);

/** A point in time a filter compares with: a number of days before the refresh, or a local day. */
const when = z.union([z.strictObject({ daysAgo: z.number().int().min(0).max(36_500) }), z.strictObject({ day })]);
const bounds = <T extends z.ZodType>(value: T) =>
  z.strictObject({ min: value.optional(), max: value.optional() });
const span = z.strictObject({ before: when.optional(), after: when.optional() });
const artistNames = z.array(z.string().trim().min(1).max(200)).max(50);

/** Which plays count, for a source built from history. Local days in the owner's time zone. */
const windowSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("all") }),
  /** The last `days` local days, today included. */
  z.strictObject({ type: z.literal("days"), days: z.number().int().min(1).max(36_500) }),
  z.strictObject({ type: z.literal("range"), from: day, to: day.optional() }),
  z.strictObject({ type: z.literal("year-to-date") }),
  /** This calendar month in every earlier year. */
  z.strictObject({ type: z.literal("month-in-past-years") }),
]);

const hours = z
  .strictObject({ from: z.number().int().min(0).max(23), to: z.number().int().min(1).max(24) })
  .refine((h) => h.from < h.to, { message: "from must be before to" });

const sourceSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("history"), window: windowSchema }),
  /** Plays on these ISO weekdays (1 is Monday) within these local hours, over all history. */
  z.strictObject({ type: z.literal("moment"), weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7), hours }),
  /** The stored tracks of new releases from the radar of the last `days` days, without re-releases. */
  z.strictObject({ type: z.literal("releases"), days: z.number().int().min(1).max(365) }),
  /** This week's picks, without the ones marked never. */
  z.strictObject({ type: z.literal("picks") }),
  z.strictObject({ type: z.literal("liked") }),
]);

export const RULE_SORTS = ["source", "listens", "recent", "first-played", "keepers", "shuffle"] as const;
export const USER_SCHEDULES = ["daily", "weekly", "monthly"] as const;
export const RULE_LIMIT = 100;

export const ruleSchema = z.strictObject({
  source: sourceSchema,
  filters: z
    .strictObject({
      /** Listens (plays of 30 s or more) in the source's plays: its window, else all history. */
      listens: bounds(count).optional(),
      lastPlayed: span.optional(),
      firstPlayed: span.optional(),
      artists: z.strictObject({ include: artistNames.optional(), exclude: artistNames.optional() }).optional(),
      releaseYears: bounds(year).optional(),
      /** Share of plays with a known outcome that were played through. A song with no known outcome passes. */
      keepers: z.strictObject({ minPlayedThrough: z.number().min(0).max(1) }).optional(),
    })
    .default({}),
  sort: z.enum(RULE_SORTS).default("source"),
  limit: z.number().int().min(1).max(RULE_LIMIT).default(50),
  perArtist: z.number().int().min(1).max(RULE_LIMIT).optional(),
  /** New songs go on top and the oldest fall off at the limit, never adding a song twice; without it the list is rebuilt. */
  rolling: z.strictObject({ perRefresh: z.number().int().min(1).max(RULE_LIMIT) }).optional(),
  schedule: z.enum(USER_SCHEDULES),
});

export type UserRule = z.infer<typeof ruleSchema>;
export type RuleFilters = UserRule["filters"];
export type RuleSort = UserRule["sort"];
export type RuleWindow = z.infer<typeof windowSchema>;
export type When = z.infer<typeof when>;

/** Refreshed once per local day, week (from Monday), month or three-hour window, or when the source changes. `yearly-weekly`: each week, and when the year turns. */
export type LivingSchedule = (typeof USER_SCHEDULES)[number] | "yearly-weekly" | "picks" | "releases" | "window";

/** The weekday and three-hour window the refresh falls in. Built-in only. */
export type CurrentMoment = { type: "moment"; weekdays: "today"; hours: "now" };
export type RuleSource = z.infer<typeof sourceSchema> | CurrentMoment;

/** Most listens, then the song key: the older tie-break two built-ins keep. */
export type BuiltinSort = RuleSort | "listens-by-key";

/** A built-in rule may use schedules, sources and a sort that follow the clock or other jobs. */
export type Rule = Omit<UserRule, "schedule" | "source" | "sort"> & { schedule: LivingSchedule; source: RuleSource; sort: BuiltinSort };
