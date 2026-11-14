import { describe, expect, test } from "bun:test";
import { createSession } from "../src/auth/sessions";
import type { Db } from "../src/db/client";
import { appPlaylists, llmThreads, ownedPlaylists, playlistItems, savedTracks, sets } from "../src/db/schema";
import { groupEntries, libraryAnalysis, loadLibrary, plainReason, playClass } from "../src/library/analysis";
import { appOwnedPlaylistIds } from "../src/library/owned";
import { play, seed, testApp, testDb, track, TZ, uri } from "./helpers";

const NOW = Date.parse("2026-11-14T09:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const listen = (id: string, days: number) => play(ago(days), uri(id), 200_000);
const shortPlay = (id: string, days: number) => play(ago(days), uri(id), 4_000, { skipped: true });

function save(db: Db, ids: string[], addedDaysAgo = 400) {
  db.insert(savedTracks).values(ids.map((id) => ({ uri: uri(id), addedAt: NOW - addedDaysAgo * DAY, syncedAt: NOW }))).run();
}

function playlist(db: Db, id: string, items: string[]) {
  db.insert(ownedPlaylists).values({ id, name: `List ${id}`, snapshotId: "s1", itemCount: items.length, syncedAt: NOW }).run();
  if (items.length) db.insert(playlistItems).values(items.map((t, position) => ({ playlistId: id, position, uri: uri(t), addedAt: null }))).run();
}

const snapshot = (db: Db, historyStart?: string) => loadLibrary(db, NOW, { timezone: TZ, historyStart });

describe("play classes", () => {
  test("rest on the days since the last listen: under 90 active, under 180 fading, else dormant, none never", () => {
    const at = (days: number) => playClass(NOW - days * DAY, NOW);

    const classes = [at(0), at(89.9), at(90), at(179.9), at(180), at(700), playClass(null, NOW)];

    expect(classes).toEqual(["active", "active", "fading", "fading", "dormant", "dormant", "never"]);
  });

  test("skips alone never condemn a song: heavy skipping does not change the class its last listen gives", () => {
    const db = testDb();
    const skippedOften = [listen("a", 20), ...Array.from({ length: 40 }, (_, i) => shortPlay("a", i + 1))];
    seed(db, [track("a", "Often skipped", "X", "A"), track("b", "Never skipped", "Y", "B")], [...skippedOften, listen("b", 20)]);
    save(db, ["a", "b"]);

    const liked = snapshot(db).liked;

    expect(liked.map((e) => e.class)).toEqual(["active", "active"]);
  });

  test("short plays do not count as a listen, and the reason says the song was started but never played through", () => {
    const db = testDb();
    seed(db, [track("a", "Started", "X", "A")], [shortPlay("a", 3), shortPlay("a", 5)]);
    save(db, ["a"], 6);
    const snap = snapshot(db, "2024-11-01");

    const [entry] = snap.liked;

    expect([entry!.class, plainReason(snap, entry!)]).toEqual(["never", "Never played, started 2 times but never past 30 seconds"]);
  });

  test("a song saved before history starts is never played only since then, and says so", () => {
    const db = testDb();
    seed(db, [track("a", "Old save", "X", "A"), track("z", "Other", "Y", "B")], [listen("z", 1)]);
    save(db, ["a"], 900);
    const snap = snapshot(db, "2024-11-01");

    expect(plainReason(snap, snap.liked[0]!)).toBe("Never played since Nov 2024");
  });
});

describe("library analysis", () => {
  function library() {
    const db = testDb();
    seed(
      db,
      ["a", "b", "c", "d", "e", "f"].map((id) => track(id, `Song ${id}`, id === "c" || id === "d" ? "Dormant Artist" : "Artist", "Album", { durationMs: 200_000 })),
      [listen("a", 2), listen("b", 120), listen("c", 300), listen("d", 400), ...Array.from({ length: 12 }, (_, i) => listen("f", i + 1))],
    );
    save(db, ["a", "b", "c", "d", "e"]);
    playlist(db, "p1", ["a", "c", "a", "e"]);
    playlist(db, "p2", ["a", "c"]);
    playlist(db, "app", ["c"]);
    playlist(db, "set", ["d"]);
    db.insert(appPlaylists).values({ purpose: "archive", playlistId: "app", createdAt: NOW }).run();
    const threadId = db.insert(llmThreads).values({ feature: "sets", system: "[]", messages: [], createdAt: NOW, updatedAt: NOW }).returning().get().id;
    db.insert(sets).values({ threadId, request: "r", title: "t", description: "", version: 1, playlistId: "set", createdAt: NOW, updatedAt: NOW }).run();
    return db;
  }

  test("counts liked songs per class", () => {
    const analysis = libraryAnalysis(snapshot(library()));

    expect(analysis.liked).toEqual({ total: 5, classes: { active: 1, fading: 1, dormant: 2, never: 1 } });
  });

  test("leaves out playlists encore owns: app playlists and saved sets", () => {
    const db = library();

    const ids = libraryAnalysis(snapshot(db)).playlists.map((p) => p.id);

    expect([ids, appOwnedPlaylistIds(db).sort()]).toEqual([["p1", "p2"], ["app", "set"]]);
  });

  test("describes each playlist: items, extra copies, classes, last play of any song in it, biggest overlap", () => {
    const [p1] = libraryAnalysis(snapshot(library())).playlists;

    expect(p1).toEqual({
      id: "p1",
      name: "List p1",
      items: 4,
      songs: 3,
      duplicates: 1,
      classes: { active: 1, fading: 0, dormant: 1, never: 1 },
      lastPlayed: ago(2),
      overlap: { id: "p2", name: "List p2", shared: 2 },
    });
  });

  test("ranks artists by dormant and never-played liked songs", () => {
    const artists = libraryAnalysis(snapshot(library())).artists;

    expect(artists.map((a) => [a.artist, a.dormant + a.never])).toEqual([
      ["Dormant Artist", 2],
      ["Artist", 1],
    ]);
  });

  test("finds songs listened to 10 or more times that are not liked", () => {
    const unsaved = libraryAnalysis(snapshot(library())).unsaved;

    expect([unsaved.total, unsaved.songs.map((s) => s.name)]).toEqual([1, ["Song f"]]);
  });

  test("every figure resolves to its songs: an artist's dormant liked songs, a playlist's duplicates", () => {
    const snap = snapshot(library());

    const dormant = groupEntries(snap, { kind: "songs", where: "liked", classes: ["dormant"], artist: "Dormant Artist" }).map((e) => e.name);
    const duplicates = groupEntries(snap, { kind: "duplicates", where: "p1" }).map((e) => [e.name, e.positions]);

    expect([dormant, duplicates]).toEqual([["Song d", "Song c"], [["Song a", [0, 2]]]]);
  });

  test("an app-owned playlist resolves to no songs", () => {
    expect(groupEntries(snapshot(library()), { kind: "songs", where: "app" })).toEqual([]);
  });

  test("the analysis and song routes need a session and answer with the groups", async () => {
    const app = testApp();
    const cookie = `encore_session=${createSession(app.db)}`;

    const anonymous = await app.request("/api/library/analysis");
    const songs = await app.request("/api/library/songs?where=liked&classes=dormant,never", { headers: { cookie } });

    expect([anonymous.status, songs.status, await songs.json()]).toEqual([
      401,
      200,
      { group: { kind: "songs", where: "liked", classes: ["dormant", "never"] }, total: 0, limit: 100, offset: 0, items: [] },
    ]);
  });
});
