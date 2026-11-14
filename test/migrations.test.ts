import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { openDb } from "../src/db/client";

const folder = join(import.meta.dir, "../drizzle");
const tables = (c: Database) => (c.query("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((r) => r.name);

describe("migrations", () => {
  test("a fresh database migrates from zero", () => {
    const names = tables(openDb(":memory:").$client);
    for (const t of ["plays", "artists", "track_artists", "llm_calls", "sets", "set_items", "picks", "blocks", "track_notes", "digests", "llm_threads", "spotify_lookups"]) expect(names).toContain(t);
  });

  test("a database at 0002 migrates forward and keeps its rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "encore-mig-"));
    const partial = join(dir, "drizzle");
    cpSync(folder, partial, { recursive: true });
    const journal = JSON.parse(readFileSync(join(partial, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 3);
    writeFileSync(join(partial, "meta/_journal.json"), JSON.stringify(journal));

    const path = join(dir, "dev.db");
    const old = new Database(path, { create: true });
    migrate(drizzle(old), { migrationsFolder: partial });
    expect(tables(old)).toContain("dj_sessions");
    expect(tables(old)).not.toContain("sets");
    old.run("insert into artists (id, name) values ('a1', 'Mac Miller')");
    old.close();

    const db = openDb(path);
    expect(tables(db.$client)).toContain("sets");
    expect(db.$client.query("select count(*) as n from __drizzle_migrations").get()).toEqual({ n: 4 });
    expect(db.$client.query("select name from artists").all()).toEqual([{ name: "Mac Miller" }]);
  });
});
