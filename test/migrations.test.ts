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
    for (const t of ["plays", "artists", "track_artists", "llm_calls", "sets", "set_items", "picks", "blocks", "track_notes", "digests", "llm_threads", "spotify_lookups", "set_covers", "living_playlists", "living_refreshes", "release_tracks", "library_plans", "library_standing"]) expect(names).toContain(t);
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
    expect(tables(db.$client)).toContain("settings");
    expect(db.$client.query("select count(*) as n from __drizzle_migrations").get()).toEqual({ n: JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8")).entries.length });
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

  test("a database at 0009 gains library plans and keeps its cleanup proposals and batches", () => {
    const dir = mkdtempSync(join(tmpdir(), "encore-mig-"));
    const partial = join(dir, "drizzle");
    cpSync(folder, partial, { recursive: true });
    const journal = JSON.parse(readFileSync(join(partial, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 10);
    writeFileSync(join(partial, "meta/_journal.json"), JSON.stringify(journal));

    const path = join(dir, "dev.db");
    const old = new Database(path, { create: true });
    migrate(drizzle(old), { migrationsFolder: partial });
    expect(tables(old)).toContain("living_playlists");
    expect(tables(old)).not.toContain("library_plans");
    old.run("insert into living_playlists (kind, enabled, playlist_id, created_at, updated_at) values ('picks', 1, 'lp', 0, 0)");
    old.run("insert into cleanup_proposals (key, kind, playlist_id, uri, evidence, status, created_at, updated_at) values ('k1', 'saved_never_played', null, 'spotify:track:a', '{}', 'open', 0, 0)");
    old.run("insert into cleanup_batches (proposal_ids, undo, applied_at) values ('[1]', '[]', 5)");
    old.close();

    const db = openDb(path);
    expect(tables(db.$client)).toContain("library_plans");
    expect(tables(db.$client)).toContain("library_standing");
    expect(db.$client.query("select uri, plan_id, action, included, reason from cleanup_proposals").all()).toEqual([{ uri: "spotify:track:a", plan_id: null, action: null, included: 1, reason: null }]);
    expect(db.$client.query("select proposal_ids, selected_ids, skipped, status, calls, applied_at from cleanup_batches").all()).toEqual([
      { proposal_ids: "[1]", selected_ids: "[]", skipped: "[]", status: "done", calls: 0, applied_at: 5 },
    ]);
    expect(db.$client.query("select playlist_id from living_playlists").all()).toEqual([{ playlist_id: "lp" }]);
  });
  test("a database at 0013 drops releases stored under an artist who does not lead them, so the radar checks that artist again", () => {
    const dir = mkdtempSync(join(tmpdir(), "encore-mig-"));
    const partial = join(dir, "drizzle");
    cpSync(folder, partial, { recursive: true });
    const journal = JSON.parse(readFileSync(join(partial, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 14);
    writeFileSync(join(partial, "meta/_journal.json"), JSON.stringify(journal));

    const path = join(dir, "dev.db");
    const old = new Database(path, { create: true });
    migrate(drizzle(old), { migrationsFolder: partial });
    old.run("insert into artists (id, name) values ('wayne', 'Lil Wayne'), ('passenger', 'Passenger')");
    const release = (id: string, artistId: string, artistName: string) =>
      old.run(`insert into releases (id, uri, artist_id, artist_name, name, album_type, release_date, first_seen_at, is_new) values ('${id}', 'spotify:album:${id}', '${artistId}', '${artistName}', '${id}', 'single', '2026-10-16', 0, 1)`);
    release("holy", "wayne", "DJ CEO");
    release("special", "wayne", "Lil Wayne");
    release("wild", "passenger", "Passenger");
    old.run("insert into release_tracks (release_id, position, uri, song_key, name, artist) values ('holy', 0, 'spotify:track:h', 'k', 'Holy Ghost', 'DJ CEO'), ('wild', 0, 'spotify:track:w', 'w', 'Wild Love', 'Passenger')");
    old.run("insert into radar_artists (artist_id, last_checked_at) values ('wayne', 5), ('passenger', 5)");
    old.close();

    const db = openDb(path);
    expect(db.$client.query("select id from releases order by id").all()).toEqual([{ id: "special" }, { id: "wild" }]);
    expect(db.$client.query("select release_id from release_tracks").all()).toEqual([{ release_id: "wild" }]);
    expect(db.$client.query("select artist_id from radar_artists").all()).toEqual([{ artist_id: "passenger" }]);
  });

  test("a database at 0014 keeps its living playlists and their refreshes, unfrozen and without a rule", () => {
    const dir = mkdtempSync(join(tmpdir(), "encore-mig-"));
    const partial = join(dir, "drizzle");
    cpSync(folder, partial, { recursive: true });
    const journal = JSON.parse(readFileSync(join(partial, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 15);
    writeFileSync(join(partial, "meta/_journal.json"), JSON.stringify(journal));

    const path = join(dir, "dev.db");
    const old = new Database(path, { create: true });
    migrate(drizzle(old), { migrationsFolder: partial });
    old.run("insert into living_playlists (kind, enabled, playlist_id, playlist_url, created_at, cover_upload_key, updated_at) values ('most-played', 1, 'lp', 'u', 0, 'key', 0)");
    old.run("insert into living_refreshes (kind, playlist_id, trigger, items, added, removed, calls, at) values ('most-played', 'lp', 'schedule', '[]', '[]', '[]', 2, 5)");
    old.close();

    const db = openDb(path);
    expect(db.$client.query("select kind, playlist_id, cover_upload_key, frozen, rule, defined_at from living_playlists").all()).toEqual([
      { kind: "most-played", playlist_id: "lp", cover_upload_key: "key", frozen: 0, rule: null, defined_at: null },
    ]);
    expect(db.$client.query("select kind, calls from living_refreshes").all()).toEqual([{ kind: "most-played", calls: 2 }]);
  });
});
