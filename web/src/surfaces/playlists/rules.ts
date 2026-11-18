import type { LivingKind, LivingRule, LivingSchedule, RuleInput, RuleSort, RuleSource, RuleWhen } from "../../api/types";
import { fmtDay, fmtHour, fmtInt, WEEKDAYS } from "../../lib/format";

/** How each built-in fills, in one line for the list. */
export const BUILTIN_FILL: Record<LivingKind, string> = {
  picks: "Refreshes weekly from your picks",
  forgotten: "Songs you loved, then left. Refreshes weekly",
  "most-played": "Your most played of the last four weeks. Refreshes daily",
  "new-releases": "Refreshes when an artist you play releases something",
  "this-month": "This month in earlier years. Refreshes monthly",
  "this-year": "The songs of this year so far. Refreshes weekly",
  "right-now": "What you play on this weekday at this hour. Refreshes every three hours",
};

const SCHEDULE: Record<LivingSchedule, string> = {
  daily: "Refreshes every day",
  weekly: "Refreshes every Monday",
  monthly: "Refreshes on the 1st of each month",
  "yearly-weekly": "Refreshes every Monday, and when the year turns",
  window: "Refreshes every three hours",
  picks: "Refreshes after each picks run",
  releases: "Refreshes when an artist you play releases something",
};

const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`;
const days = (n: number) => plural(n, "day", "days");

function weekdayList(list: number[]): string {
  if (list.length === 7) return "any day";
  if (list.join() === "1,2,3,4,5") return "weekdays";
  if (list.join() === "6,7") return "weekends";
  return list.map((d) => `${WEEKDAYS[d - 1]}s`).join(", ");
}

/** Where the songs come from, short ("the last 90 days") and as a sentence. */
function sourceWords(source: RuleSource): { short: string; long: string } {
  switch (source.type) {
    case "history": {
      const w = source.window;
      if (w.type === "all") return { short: "all your listening", long: "From all your listening" };
      if (w.type === "days") return { short: `the last ${days(w.days)}`, long: `From what you played in the last ${days(w.days)}` };
      if (w.type === "year-to-date") return { short: "this year", long: "From what you played this year" };
      if (w.type === "month-in-past-years") return { short: "this month in earlier years", long: "From what you played this month in earlier years" };
      const range = w.to ? `${fmtDay(w.from)} to ${fmtDay(w.to)}` : `since ${fmtDay(w.from)}`;
      return { short: range, long: `From what you played ${w.to ? `from ${range}` : range}` };
    }
    case "moment": {
      const when = source.weekdays === "today" ? "this weekday" : weekdayList(source.weekdays);
      const hours = source.hours === "now" ? "at this hour" : `${fmtHour(source.hours.from)} to ${fmtHour(source.hours.to % 24)}`;
      return { short: `${when}, ${hours}`, long: `From what you play on ${when}, ${hours}` };
    }
    case "releases":
      return { short: "new releases", long: `From new releases by artists you play, the last ${days(source.days)}` };
    case "picks":
      return { short: "this week’s picks", long: "From this week’s picks" };
    case "liked":
      return { short: "your liked songs", long: "From your liked songs" };
  }
}

function whenWords(w: RuleWhen, past: "before" | "after"): string {
  if ("day" in w) return `${past} ${fmtDay(w.day)}`;
  if (w.daysAgo === 0) return past === "before" ? "before today" : "today";
  return past === "before" ? `more than ${days(w.daysAgo)} ago` : `in the last ${days(w.daysAgo)}`;
}

/** Each filter as a phrase: "listened to 3 to 40 times". */
function filterWords(rule: LivingRule): string[] {
  const f = rule.filters;
  const out: string[] = [];
  const l = f.listens;
  if (l?.min !== undefined && l.max !== undefined) out.push(`listened to ${fmtInt(l.min)} to ${fmtInt(l.max)} times`);
  else if (l?.min !== undefined) out.push(`listened to at least ${plural(l.min, "time", "times")}`);
  else if (l?.max !== undefined) out.push(`listened to at most ${plural(l.max, "time", "times")}`);
  if (f.lastPlayed?.before) out.push(`last played ${whenWords(f.lastPlayed.before, "before")}`);
  if (f.lastPlayed?.after) out.push(`played ${whenWords(f.lastPlayed.after, "after")}`);
  if (f.firstPlayed?.before) out.push(`first played ${whenWords(f.firstPlayed.before, "before")}`);
  if (f.firstPlayed?.after) out.push(`first played ${whenWords(f.firstPlayed.after, "after")}`);
  if (f.artists?.include?.length) out.push(`only ${f.artists.include.join(", ")}`);
  if (f.artists?.exclude?.length) out.push(`without ${f.artists.exclude.join(", ")}`);
  const y = f.releaseYears;
  if (y?.min !== undefined && y.max !== undefined) out.push(y.min === y.max ? `released in ${y.min}` : `released ${y.min} to ${y.max}`);
  else if (y?.min !== undefined) out.push(`released in ${y.min} or later`);
  else if (y?.max !== undefined) out.push(`released in ${y.max} or earlier`);
  if (f.keepers) out.push(`played through at least ${Math.round(f.keepers.minPlayedThrough * 100)}% of the time`);
  return out;
}

function sortWords(sort: RuleSort, source: RuleSource): string {
  switch (sort) {
    case "source":
      if (source.type === "releases") return "newest first";
      if (source.type === "picks") return "in pick order";
      if (source.type === "liked") return "newest liked first";
      return "most played first";
    case "listens":
    case "listens-by-key":
      return "most played first";
    case "recent":
      return "last played first";
    case "first-played":
      return "earliest found first";
    case "keepers":
      return "most played through first";
    case "shuffle":
      return "shuffled at each refresh";
  }
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The rule as a few plain sentences, for its playlist's page. */
export function describeRule(rule: LivingRule): string[] {
  const filters = filterWords(rule);
  const size = [`At most ${plural(rule.limit, "song", "songs")}`, rule.perArtist && `${fmtInt(rule.perArtist)} per artist`, sortWords(rule.sort, rule.source)].filter(Boolean).join(", ");
  return [
    sourceWords(rule.source).long,
    ...(filters.length ? [capital(filters.join(", "))] : []),
    size,
    rule.rolling ? `New songs go on top, ${fmtInt(rule.rolling.perRefresh)} at a time; the oldest leave at the limit` : null,
    SCHEDULE[rule.schedule],
  ].filter((s): s is string => Boolean(s));
}

/** The rule in one line for the list: "Rule: the last 90 days, listened to at least 3 times, most played first". */
export function ruleSummary(rule: LivingRule): string {
  return `Rule: ${[sourceWords(rule.source).short, ...filterWords(rule), sortWords(rule.sort, rule.source)].join(", ")}`;
}

/** What the rule builder edits. Numbers stay text until they are read, so a field can be empty while it is typed. */
export type RuleForm = {
  name: string;
  about: string;
  source: "history" | "moment" | "releases" | "picks" | "liked";
  window: "all" | "days" | "year-to-date" | "month-in-past-years" | "range";
  windowDays: string;
  rangeFrom: string;
  rangeTo: string;
  weekdays: number[];
  hourFrom: string;
  hourTo: string;
  releaseDays: string;
  listensMin: string;
  listensMax: string;
  lastPlayed: "any" | "not-within" | "within";
  lastPlayedDays: string;
  firstPlayed: "any" | "before" | "within";
  firstPlayedDays: string;
  include: string;
  exclude: string;
  yearMin: string;
  yearMax: string;
  keepers: string;
  sort: Exclude<RuleSort, "listens-by-key">;
  limit: string;
  perArtist: string;
  rolling: boolean;
  perRefresh: string;
  schedule: "daily" | "weekly" | "monthly";
};

export type RuleFormErrors = Partial<Record<keyof RuleForm, string>>;

export const NEW_RULE: RuleForm = {
  name: "",
  about: "",
  source: "history",
  window: "days",
  windowDays: "90",
  rangeFrom: "",
  rangeTo: "",
  weekdays: [1, 2, 3, 4, 5],
  hourFrom: "18",
  hourTo: "21",
  releaseDays: "30",
  listensMin: "",
  listensMax: "",
  lastPlayed: "any",
  lastPlayedDays: "30",
  firstPlayed: "any",
  firstPlayedDays: "365",
  include: "",
  exclude: "",
  yearMin: "",
  yearMax: "",
  keepers: "",
  sort: "source",
  limit: "50",
  perArtist: "",
  rolling: false,
  perRefresh: "10",
  schedule: "weekly",
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const names = (text: string) => text.split(",").map((s) => s.trim()).filter(Boolean);
const text = (n: number | undefined) => (n === undefined ? "" : String(n));

/** A rule as the builder shows it. A built-in's clock-bound source or sort has no field, so only owners' rules are edited. */
export function fromRule(name: string, about: string | null, rule: LivingRule): RuleForm {
  const f = rule.filters;
  const s = rule.source;
  const w = s.type === "history" ? s.window : null;
  const lastBefore = f.lastPlayed?.before;
  const lastAfter = f.lastPlayed?.after;
  const firstBefore = f.firstPlayed?.before;
  const firstAfter = f.firstPlayed?.after;
  const ago = (x: RuleWhen | undefined) => (x && "daysAgo" in x ? String(x.daysAgo) : "");
  return {
    ...NEW_RULE,
    name,
    about: about ?? "",
    source: s.type,
    window: w?.type ?? NEW_RULE.window,
    windowDays: w?.type === "days" ? String(w.days) : NEW_RULE.windowDays,
    rangeFrom: w?.type === "range" ? w.from : "",
    rangeTo: w?.type === "range" ? (w.to ?? "") : "",
    weekdays: s.type === "moment" && Array.isArray(s.weekdays) ? s.weekdays : NEW_RULE.weekdays,
    hourFrom: s.type === "moment" && s.hours !== "now" ? String(s.hours.from) : NEW_RULE.hourFrom,
    hourTo: s.type === "moment" && s.hours !== "now" ? String(s.hours.to) : NEW_RULE.hourTo,
    releaseDays: s.type === "releases" ? String(s.days) : NEW_RULE.releaseDays,
    listensMin: text(f.listens?.min),
    listensMax: text(f.listens?.max),
    lastPlayed: lastBefore ? "not-within" : lastAfter ? "within" : "any",
    lastPlayedDays: ago(lastBefore ?? lastAfter) || NEW_RULE.lastPlayedDays,
    firstPlayed: firstBefore ? "before" : firstAfter ? "within" : "any",
    firstPlayedDays: ago(firstBefore ?? firstAfter) || NEW_RULE.firstPlayedDays,
    include: f.artists?.include?.join(", ") ?? "",
    exclude: f.artists?.exclude?.join(", ") ?? "",
    yearMin: text(f.releaseYears?.min),
    yearMax: text(f.releaseYears?.max),
    keepers: f.keepers ? String(Math.round(f.keepers.minPlayedThrough * 100)) : "",
    sort: rule.sort === "listens-by-key" ? "listens" : rule.sort,
    limit: String(rule.limit),
    perArtist: text(rule.perArtist),
    rolling: Boolean(rule.rolling),
    perRefresh: rule.rolling ? String(rule.rolling.perRefresh) : NEW_RULE.perRefresh,
    schedule: rule.schedule === "daily" || rule.schedule === "monthly" ? rule.schedule : "weekly",
  };
}

/** The builder's fields as the body `POST /api/living` takes, or what is wrong with them. Empty optional fields are left out. */
export function toRule(form: RuleForm): { input: RuleInput | null; errors: RuleFormErrors } {
  const errors: RuleFormErrors = {};
  const whole = (key: keyof RuleForm, min: number, max: number, required = false): number | undefined => {
    const raw = String(form[key]).trim();
    if (!raw) {
      if (required) errors[key] = "Enter a number";
      return undefined;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      errors[key] = `Enter a whole number from ${fmtInt(min)} to ${fmtInt(max)}`;
      return undefined;
    }
    return n;
  };
  const day = (key: "rangeFrom" | "rangeTo", required: boolean) => {
    const raw = form[key].trim();
    if (!raw) {
      if (required) errors[key] = "Pick a day";
      return undefined;
    }
    if (!DAY.test(raw)) errors[key] = "Pick a day";
    return raw;
  };

  let source: RuleSource;
  if (form.source === "history") {
    if (form.window === "days") source = { type: "history", window: { type: "days", days: whole("windowDays", 1, 36_500, true) ?? 1 } };
    else if (form.window === "range") {
      const from = day("rangeFrom", true) ?? "";
      const to = day("rangeTo", false);
      if (from && to && to < from) errors.rangeTo = "Pick a day after the first";
      source = { type: "history", window: { type: "range", from, ...(to ? { to } : {}) } };
    } else source = { type: "history", window: { type: form.window } };
  } else if (form.source === "moment") {
    if (form.weekdays.length === 0) errors.weekdays = "Pick at least one day";
    const from = whole("hourFrom", 0, 23, true) ?? 0;
    const to = whole("hourTo", 1, 24, true) ?? 24;
    if (from >= to) errors.hourTo = "Pick an hour after the first";
    source = { type: "moment", weekdays: form.weekdays, hours: { from, to } };
  } else if (form.source === "releases") source = { type: "releases", days: whole("releaseDays", 1, 365, true) ?? 1 };
  else source = { type: form.source };

  const filters: LivingRule["filters"] = {};
  const lMin = whole("listensMin", 0, 100_000);
  const lMax = whole("listensMax", 0, 100_000);
  if (lMin !== undefined && lMax !== undefined && lMin > lMax) errors.listensMax = "Enter at least the smallest count";
  if (lMin !== undefined || lMax !== undefined) filters.listens = { ...(lMin !== undefined && { min: lMin }), ...(lMax !== undefined && { max: lMax }) };
  if (form.lastPlayed !== "any") {
    const n = whole("lastPlayedDays", 0, 36_500, true) ?? 0;
    filters.lastPlayed = form.lastPlayed === "not-within" ? { before: { daysAgo: n } } : { after: { daysAgo: n } };
  }
  if (form.firstPlayed !== "any") {
    const n = whole("firstPlayedDays", 0, 36_500, true) ?? 0;
    filters.firstPlayed = form.firstPlayed === "before" ? { before: { daysAgo: n } } : { after: { daysAgo: n } };
  }
  const include = names(form.include);
  const exclude = names(form.exclude);
  if (include.length > 50) errors.include = "At most 50 artists";
  if (exclude.length > 50) errors.exclude = "At most 50 artists";
  if (include.length || exclude.length) filters.artists = { ...(include.length && { include }), ...(exclude.length && { exclude }) };
  const yMin = whole("yearMin", 1900, 2100);
  const yMax = whole("yearMax", 1900, 2100);
  if (yMin !== undefined && yMax !== undefined && yMin > yMax) errors.yearMax = "Enter a year after the first";
  if (yMin !== undefined || yMax !== undefined) filters.releaseYears = { ...(yMin !== undefined && { min: yMin }), ...(yMax !== undefined && { max: yMax }) };
  const keepers = whole("keepers", 0, 100);
  if (keepers !== undefined) filters.keepers = { minPlayedThrough: keepers / 100 };

  const limit = whole("limit", 1, 100, true) ?? 50;
  const perArtist = whole("perArtist", 1, 100);
  const perRefresh = form.rolling ? whole("perRefresh", 1, 100, true) : undefined;
  const name = form.name.trim();
  if (!name) errors.name = "Name the playlist";
  else if (name.length > 100) errors.name = "At most 100 characters";
  if (form.about.trim().length > 300) errors.about = "At most 300 characters";

  if (Object.keys(errors).length > 0) return { input: null, errors };
  return {
    input: {
      name,
      about: form.about.trim() || null,
      rule: {
        source,
        filters,
        sort: form.sort,
        limit,
        ...(perArtist !== undefined && { perArtist }),
        ...(perRefresh !== undefined && { rolling: { perRefresh } }),
        schedule: form.schedule,
      },
    },
    errors,
  };
}
