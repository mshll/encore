import type { Config } from "../config";
import type { Db } from "../db/client";
import type { SettingsSource } from "../settings/settings";
import { dayTypeOf, hourBucketOf } from "../library/catalog";
import { localTime, type Locale } from "../plays/localTime";
import type { SpotifyClient } from "../spotify/client";
import type { Llm } from "./client";

export type FeatureContext = { db: Db; config: Config; settings: SettingsSource; llm: Llm; spotify: SpotifyClient; now: () => number };

const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const weekendLabel = (days: readonly number[]) => (days.length ? days.map((d) => WEEKDAYS[d]).join(" and ") : "none");

export function localNow({ timezone, weekendDays }: Locale, now: number): string {
  const t = localTime(now, timezone);
  const minutes = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  return `${WEEKDAYS[t.weekday]} ${t.day} ${minutes} (${hourBucketOf(t.hour)}, ${dayTypeOf(t.weekday, weekendDays)}; weekend days: ${weekendLabel(weekendDays)})`;
}

export const tagged = (tag: string, body: string) => `<${tag}>\n${body}\n</${tag}>`;
