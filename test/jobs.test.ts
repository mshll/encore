import { describe, expect, test } from "bun:test";
import { runJob } from "../src/jobs/scheduler";
import { getJobState } from "../src/jobs/state";
import { testDb } from "./helpers";

describe("jobs", () => {
  test("persist last run, success, result and error", async () => {
    const db = testDb();
    await runJob(db, { name: "x", intervalMs: 1000, run: async () => ({ inserted: 2 }) }, () => 5);
    expect(getJobState(db, "x")).toEqual({ name: "x", lastRunAt: 5, lastSuccessAt: 5, lastError: null, data: { inserted: 2 } });
    await runJob(db, { name: "x", intervalMs: 1000, run: async () => Promise.reject(new Error("boom")) }, () => 9);
    expect(getJobState(db, "x")).toEqual({ name: "x", lastRunAt: 9, lastSuccessAt: 5, lastError: "boom", data: { inserted: 2 } });
  });
});
