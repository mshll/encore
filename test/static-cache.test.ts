import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testApp } from "./helpers";

const dist = mkdtempSync(join(tmpdir(), "encore-dist-"));
mkdirSync(join(dist, "assets"));
writeFileSync(join(dist, "index.html"), "<!doctype html><title>encore</title>");
writeFileSync(join(dist, "assets", "Plays-abc123.js"), "export {}");
writeFileSync(join(dist, "logo.svg"), "<svg/>");
afterAll(() => rmSync(dist, { recursive: true, force: true }));

const get = (path: string) => testApp({ WEB_DIST: dist }).request(path);

describe("cache rules for the built UI", () => {
  test("a hashed asset is cached for a year and never revalidated", async () => {
    const res = await get("/assets/Plays-abc123.js");

    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "public, max-age=31536000, immutable"]);
  });

  test("a missing asset is a 404 nobody may cache, not the page", async () => {
    const res = await get("/assets/Table-gone99.js");

    expect([res.status, res.headers.get("cache-control"), res.headers.get("content-type")?.includes("html")]).toEqual([404, "no-store", false]);
  });

  test("the page itself is revalidated on every load, so a deploy is picked up at once", async () => {
    const statuses = await Promise.all(["/", "/plays"].map(async (path) => (await get(path)).headers.get("cache-control")));

    expect(statuses).toEqual(["no-cache", "no-cache"]);
  });

  test("other public files are revalidated", async () => {
    const res = await get("/logo.svg");

    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-cache"]);
  });
});
