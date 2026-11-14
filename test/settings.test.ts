import { describe, expect, test } from "bun:test";
import { settings as settingsTable } from "../src/db/schema";
import { startScheduler, type Job } from "../src/jobs/scheduler";
import { SettingsValidationError } from "../src/settings/store";
import { SpotifyAuth } from "../src/spotify/auth";
import { connectSpotify, testConfig, testDb, testSettings } from "./helpers";

const KEY = "k".repeat(40);
const CLAUDE_KEY = "sk-ant-test-0123456789abcd";

function store(env: Record<string, string> = {}) {
  const db = testDb();
  const settings = testSettings(db, testConfig(env));
  return { db, settings };
}

const issuesOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof SettingsValidationError) return error.issues;
    throw error;
  }
  return [];
};

describe("settings precedence", () => {
  test("an env value overrides a stored value, which overrides the default", () => {
    const { db, settings } = store({ TIMEZONE: "Asia/Kuwait" });
    db.insert(settingsTable).values([{ key: "timezone", value: "Europe/London", updatedAt: 0 }, { key: "homeCountry", value: "GB", updatedAt: 0 }]).run();

    const sources = Object.fromEntries(["timezone", "homeCountry", "monthlyBudgetUsd"].map((key) => [key, settings.entry(key)!.source]));

    expect(sources).toEqual({ timezone: "env", homeCountry: "db", monthlyBudgetUsd: "default" });
    expect(settings.get()).toMatchObject({ timezone: "Asia/Kuwait", homeCountry: "GB", llm: { monthlyBudgetUsd: 100 } });
  });

  test("an env-provided setting cannot be changed from the dashboard", () => {
    const { settings } = store({ TIMEZONE: "Asia/Kuwait" });

    const issues = issuesOf(() => settings.update({ timezone: "Europe/London" }));

    expect(issues).toEqual([{ key: "timezone", reason: "locked", message: "Set by the TIMEZONE environment variable; change it there" }]);
  });

  test("clearing a stored value falls back to the default", () => {
    const { settings } = store();
    settings.update({ picksHour: 7 });

    settings.update({ picksHour: null });

    expect(settings.entry("picksHour")).toMatchObject({ value: 10, source: "default" });
  });

  test("a stored value that no longer validates is ignored in favour of the default", () => {
    const { db, settings } = store();
    db.insert(settingsTable).values({ key: "pollIntervalSeconds", value: 5, updatedAt: 0 }).run();

    expect(settings.entry("pollIntervalSeconds")).toMatchObject({ value: 300, source: "default" });
  });
});

describe("settings validation", () => {
  test("rejects unknown keys and out-of-range values, and writes nothing when any value fails", () => {
    const { settings } = store();

    const issues = issuesOf(() => settings.update({ picksHour: 7, pollIntervalSeconds: 10, bogus: 1, claudeModel: "gpt-5" }));

    expect(issues.map((i) => [i.key, i.reason])).toEqual([
      ["pollIntervalSeconds", "invalid"],
      ["bogus", "unknown"],
      ["claudeModel", "invalid"],
    ]);
    expect(settings.entry("picksHour")!.source).toBe("default");
  });

  test("normalises values: weekend days are sorted, the Discord public key is lower-cased", () => {
    const { settings } = store();

    settings.update({ weekendDays: [7, 6], discordPublicKey: "A".repeat(64) });

    expect([settings.get().weekendDays, settings.entry("discordPublicKey")!.value]).toEqual([[6, 7], "a".repeat(64)]);
  });

  test("returns only the keys whose effective value changed", () => {
    const { settings } = store();
    settings.update({ picksHour: 7 });

    expect(settings.update({ picksHour: 7, digestHour: 8 })).toEqual(["digestHour"]);
  });
});

describe("secrets", () => {
  test("are sealed at rest and opened for services", () => {
    const { db, settings } = store({ SECRETS_KEY: KEY });

    settings.update({ claudeApiKey: CLAUDE_KEY });

    const raw = JSON.stringify(db.select().from(settingsTable).all());
    expect(raw).not.toContain(CLAUDE_KEY);
    expect(settings.get().llm.apiKey).toBe(CLAUDE_KEY);
  });

  test("cannot be stored without SECRETS_KEY, while env-provided secrets keep working", () => {
    const { settings } = store({ MCP_TOKEN: "m".repeat(24) });

    const issues = issuesOf(() => settings.update({ claudeApiKey: CLAUDE_KEY }));

    expect(issues.map((i) => i.reason)).toEqual(["secrets_key_missing"]);
    expect(settings.get().mcpToken).toBe("m".repeat(24));
  });

  test("sealed with another key read as unset and are flagged unreadable", () => {
    const db = testDb();
    testSettings(db, testConfig({ SECRETS_KEY: KEY })).update({ claudeApiKey: CLAUDE_KEY });

    const reopened = testSettings(db, testConfig({ SECRETS_KEY: "x".repeat(40) }));

    expect(reopened.entry("claudeApiKey")).toMatchObject({ value: null, source: "default", unreadable: true });
    expect(reopened.get().llm.apiKey).toBeUndefined();
  });
});

describe("runtime changes", () => {
  test("a new Spotify client id disconnects the grant issued to the old one", () => {
    const db = testDb();
    const config = testConfig({ SPOTIFY_CLIENT_ID: "" });
    const settings = testSettings(db, config);
    const auth = new SpotifyAuth(db, config, settings);
    settings.update({ spotifyClientId: "test-client" });
    connectSpotify(db);
    expect(auth.status().connected).toBe(true);

    settings.update({ spotifyClientId: "another-client" });

    expect(auth.status().connected).toBe(false);
  });

  test("services read the new value on their next use, without a restart", () => {
    const { settings } = store({ SECRETS_KEY: KEY });
    const before = settings.get().llm.apiKey;

    settings.update({ claudeApiKey: CLAUDE_KEY, djReplanner: "llm" });

    expect([before, settings.get().llm.apiKey, settings.get().djReplanner]).toEqual([undefined, CLAUDE_KEY, "llm"]);
  });

  test("listeners hear which keys changed, and rescheduling re-times waiting jobs with the new interval", async () => {
    const { db, settings } = store();
    const runs: string[] = [];
    const job: Job = { name: "poll", intervalMs: () => settings.get().pollIntervalMs, run: async () => void runs.push("poll") };
    const scheduler = startScheduler(db, [job], () => 59_000);
    const heard: string[][] = [];
    settings.subscribe((changed) => {
      heard.push(changed);
      scheduler.reschedule();
    });

    settings.update({ pollIntervalSeconds: 60 });
    await Bun.sleep(1100);
    scheduler.stop();

    expect(heard).toEqual([["pollIntervalSeconds"]]);
    expect(runs).toHaveLength(1);
  });
});
