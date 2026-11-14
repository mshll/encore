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
    expect(db.$client.query("select count(*) as n from __drizzle_migrations").get()).toEqual({ n: 7 });
    expect(db.$client.query("select name from artists").all()).toEqual([{ name: "Mac Miller" }]);
  });

  test("a database at 0003 gains set changes, pins and re-plan times and keeps its sets and sessions", () => {
    const dir = mkdtempSync(join(tmpdir(), "encore-mig-"));
    const partial = join(dir, "drizzle");
    cpSync(folder, partial, { recursive: true });
    const journal = JSON.parse(readFileSync(join(partial, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 4);
    writeFileSync(join(partial, "meta/_journal.json"), JSON.stringify(journal));

    const path = join(dir, "dev.db");
    const old = new Database(path, { create: true });
    migrate(drizzle(old), { migrationsFolder: partial });
    old.run("insert into llm_threads (id, feature, system, messages, created_at, updated_at) values (1, 'sets', '[]', '[]', 0, 0)");
    old.run("insert into sets (id, thread_id, request, title, description, version, created_at, updated_at) values (1, 1, 'r', 'Late drive', '', 1, 0, 0)");
    old.run("insert into set_items (set_id, position, kind, song_key, uri, name, artist, reason) values (1, 1, 'library', 'woods|mac miller', 'spotify:track:x', 'Woods', 'Mac Miller', 'why')");
    old.run("insert into dj_sessions (playlist_id, status, uris, position, outcomes, started_at, updated_at) values ('p', 'ended', '[]', 0, '[]', 0, 0)");
    old.close();

    const db = openDb(path);
    expect(tables(db.$client)).toContain("set_changes");
    expect(db.$client.query("select title from sets").all()).toEqual([{ title: "Late drive" }]);
    expect(db.$client.query("select pinned from set_items").all()).toEqual([{ pinned: 0 }]);
    expect(db.$client.query("select replanned_at, replan_skips from dj_sessions").all()).toEqual([{ replanned_at: null, replan_skips: null }]);
  });
});
