import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testApp } from "./helpers";

describe("web app fallback", () => {
  test("serves index.html for deep links when WEB_DIST is absolute", async () => {
    const dist = mkdtempSync(join(tmpdir(), "encore-web-"));
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>encore</title>");
    writeFileSync(join(dist, "assets", "app.js"), "console.log(1)");
    const { request } = testApp({ WEB_DIST: dist });
    for (const path of ["/", "/sets/1", "/song/a%7Cb"]) {
      const res = await request(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<title>encore</title>");
    }
    const asset = await request("/assets/app.js");
    expect(await asset.text()).toBe("console.log(1)");
  });
});
