import { describe, expect, test } from "bun:test";
import type { LivingRule } from "../web/src/api/types";
import { describeRule, fromRule, NEW_RULE, ruleSummary, toRule } from "../web/src/surfaces/playlists/rules";

const OLD_MAC = {
  source: { type: "history", window: { type: "days", days: 90 } },
  filters: { listens: { min: 3, max: 40 }, lastPlayed: { before: { daysAgo: 14 } }, artists: { include: ["Mac Miller"] } },
  sort: "listens",
  limit: 50,
  perArtist: 3,
  schedule: "weekly",
} satisfies LivingRule;

describe("a rule in plain words", () => {
  test("a history rule names its window, filters, size and schedule", () => {
    const lines = describeRule(OLD_MAC);

    expect(lines).toEqual([
      "From what you played in the last 90 days",
      "Listened to 3 to 40 times, last played more than 14 days ago, only Mac Miller",
      "At most 50 songs, 3 per artist, most played first",
      "Refreshes every Monday",
    ]);
  });

  test("the list line starts with Rule and keeps it short", () => {
    const line = ruleSummary(OLD_MAC);

    expect(line).toBe("Rule: the last 90 days, listened to 3 to 40 times, last played more than 14 days ago, only Mac Miller, most played first");
  });

  test("a built-in's clock-bound moment reads as this weekday at this hour", () => {
    const line = describeRule({ source: { type: "moment", weekdays: "today", hours: "now" }, filters: {}, sort: "keepers", limit: 50, perArtist: 3, schedule: "window" })[0];

    expect(line).toBe("From what you play on this weekday, at this hour");
  });
});

describe("the rule builder's fields", () => {
  test("a rule read into the form and back is the same rule", () => {
    const form = fromRule("Old Mac", null, OLD_MAC);

    expect(toRule(form)).toEqual({ input: { name: "Old Mac", about: null, rule: OLD_MAC }, errors: {} });
  });

  test("empty optional fields are left out of the rule", () => {
    const { input } = toRule({ ...NEW_RULE, name: "Recent" });

    expect(input?.rule).toEqual({ source: { type: "history", window: { type: "days", days: 90 } }, filters: {}, sort: "source", limit: 50, schedule: "weekly" });
  });

  test("a missing name, a reversed range and an hour window that ends before it starts are each reported on their field", () => {
    const listens = toRule({ ...NEW_RULE, listensMin: "10", listensMax: "2" });
    const hours = toRule({ ...NEW_RULE, name: "Evenings", source: "moment", hourFrom: "21", hourTo: "18" });

    expect([listens.input, Object.keys(listens.errors).sort(), hours.errors]).toEqual([null, ["listensMax", "name"], { hourTo: "Pick an hour after the first" }]);
  });

  test("keepers is a percentage in the form and a share in the rule", () => {
    const { input } = toRule({ ...NEW_RULE, name: "Keepers", keepers: "60", rolling: true, perRefresh: "5" });

    expect([input?.rule.filters?.keepers, input?.rule.rolling]).toEqual([{ minPlayedThrough: 0.6 }, { perRefresh: 5 }]);
  });
});
