import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { artistPage, trackPage } from "../src/analytics/entities";
import { history } from "../src/analytics/history";
import { overview } from "../src/analytics/overview";
import { eras, topAlbums, topArtists, topTracks } from "../src/analytics/top";
import { addAlias, AliasError, listAliases, removeAlias } from "../src/artists/aliases";
import { createSession } from "../src/auth/sessions";
import type { Db } from "../src/db/client";
import { recapFacts } from "../src/digest/facts";
import { importExport } from "../src/ingest/export/import";
import { coveredByLive, recordLivePlays } from "../src/ingest/live/reconcile";
import { insertPlays, upsertTracks } from "../src/plays/store";
import { emptyTrash, restorePlays, songPlayIds, trashPlays } from "../src/plays/trash";
import { buildTasteProfile } from "../src/taste/profile";
import { play, seed, testApp, testDb, track, TZ, uri, WEEKEND } from "./helpers";

const all = { range: {} };
const ids = (db: Db) => db.all<{ id: number }>(sql`select id from plays order by ts`).map((r) => r.id);
const songOf = (db: Db, name: string) => topTracks(db, { ...all, limit: 50 }).find((s) => s.name === name);

const exportFile = (id: string, timestamps: string[], msPlayed = 200_000) => ({
  name: "Streaming_History_Audio_2026.json",
  content: JSON.stringify(
    timestamps.map((ts) => ({ ts, platform: "ios", ms_played: msPlayed, master_metadata_track_name: `Song ${id}`, master_metadata_album_artist_name: "Artist X", spotify_track_uri: uri(id), reason_start: "clickrow", reason_end: "trackdone" })),
  ),
});

const isoTimes = (db: Db, table: "plays" | "play_trash") => db.all<{ ts: number }>(sql`select ts from ${sql.raw(table)} order by ts`).map((r) => new Date(r.ts).toISOString());

function library(db: Db) {
  seed(
    db,
    [track("a", "Song A", "Artist X", "Album 1", { durationMs: 200_000 }), track("b", "Song B", "Artist Y", "Album 2", { durationMs: 200_000 })],
    [
      play("2026-01-05T10:00:00Z", uri("a"), 200_000),
      play("2026-01-05T11:00:00Z", uri("a"), 200_000),
      play("2026-01-06T10:00:00Z", uri("a"), 200_000),
      play("2026-01-06T11:00:00Z", uri("b"), 200_000),
    ],
  );
}

describe("deleted plays", () => {
  test("vanish from totals, top lists, entity pages, history, recaps and the taste profile", () => {
    const db = testDb();
    library(db);
    const profile = () => buildTasteProfile(db, { timezone: TZ, weekendDays: WEEKEND }, Date.parse("2026-02-01T00:00:00Z"));
    const fullProfile = profile();
    const [first, second] = ids(db) as [number, number];

    expect(trashPlays(db, [first, second], 1)).toBe(2);

    expect(overview(db, all).plays).toBe(2);
    expect(songOf(db, "Song A")!.plays).toBe(1);
    expect(topArtists(db, { ...all, limit: 10 }).find((a) => a.artist === "Artist X")!.plays).toBe(1);
    expect(topAlbums(db, { ...all, limit: 10 }).find((a) => a.album === "Album 1")!.plays).toBe(1);
    expect(artistPage(db, { artist: "Artist X", range: {}, period: "month", weekendDays: WEEKEND })!.totals.plays).toBe(1);
    expect(trackPage(db, { songKey: songOf(db, "Song A")!.songKey, range: {}, period: "month", weekendDays: WEEKEND })!.totals.plays).toBe(1);
    expect(history(db, { range: {}, limit: 10, offset: 0 }).total).toBe(2);
    const recap = recapFacts(db, "monthly", { from: "2026-01-01", to: "2026-01-31", inProgress: false }, null);
    expect(recap.totals.listens).toBe(2);
    expect(recap.songs.find((s) => s.name === "Song A")!.listens).toBe(1);
    expect(profile()).not.toBe(fullProfile);

    const trash = history(db, { range: {}, limit: 10, offset: 0, trash: true });
    expect(trash.items.map((i) => i.id).sort()).toEqual([first, second].sort());
    expect(trash.items[0]!.trashedAt).toBe(new Date(1).toISOString());
    restorePlays(db, [first, second]);
    expect(profile()).toBe(fullProfile);
  });

  test("restore brings them back with their ids", () => {
    const db = testDb();
    library(db);
    const before = ids(db);
    trashPlays(db, [before[0]!], 1);
    expect(restorePlays(db, [before[0]!])).toBe(1);
    expect(ids(db)).toEqual(before);
    expect(overview(db, all).plays).toBe(4);
    expect(history(db, { range: {}, limit: 10, offset: 0, trash: true }).total).toBe(0);
  });

  test("every play of a song in a range", () => {
    const db = testDb();
    library(db);
    const key = songOf(db, "Song A")!.songKey;
    const found = songPlayIds(db, key, { from: "2026-01-06", to: "2026-01-06" });
    expect(found).toHaveLength(1);
    trashPlays(db, found);
    expect(songOf(db, "Song A")!.plays).toBe(2);
  });

  test("a stored play arriving again stays deleted, also after the trash is emptied", () => {
    const db = testDb();
    upsertTracks(db, [track("a", "Song A", "Artist X", null)]);
    const p = play("2026-01-05T10:00:00Z", uri("a"), 200_000);
    insertPlays(db, [p], { timezone: TZ });
    trashPlays(db, ids(db));
    expect(insertPlays(db, [p], { timezone: TZ })).toBe(0);
    expect(emptyTrash(db)).toBe(1);
    expect(insertPlays(db, [p], { timezone: TZ })).toBe(0);
    expect(overview(db, all).plays).toBe(0);
  });

  test("re-importing the export does not bring a deleted play back", () => {
    const db = testDb();
    const file = {
      name: "Streaming_History_Audio_2026.json",
      content: JSON.stringify(
        ["2026-01-05T10:00:00Z", "2026-01-05T11:00:00Z"].map((ts) => ({
          ts,
          platform: "ios",
          ms_played: 200000,
          conn_country: "KW",
          master_metadata_track_name: "Song A",
          master_metadata_album_artist_name: "Artist X",
          master_metadata_album_album_name: "Album 1",
          spotify_track_uri: uri("a"),
          reason_start: "clickrow",
          reason_end: "trackdone",
          shuffle: false,
          skipped: false,
        })),
      ),
    };
    importExport(db, [file], { timezone: TZ });
    trashPlays(db, [ids(db)[0]!]);
    const again = importExport(db, [file], { timezone: TZ });
    expect(again).toMatchObject({ inserted: 0, deleted: 1, alreadyPresent: 1 });
    expect(overview(db, all).plays).toBe(1);
  });

  test("an export row of a deleted live play takes its place in the trash", () => {
    const db = testDb();
    upsertTracks(db, [track("a", "Song A", "Artist X", null)]);
    recordLivePlays(
      db,
      [{ trackUri: uri("a"), startedAt: Date.parse("2026-01-05T09:56:40Z"), endedAt: Date.parse("2026-01-05T10:00:00Z"), msPlayed: 200_000, durationMs: 200_000, reasonStart: null, reasonEnd: "trackdone", skipped: false, shuffle: false, deviceType: "Smartphone", deviceName: "iPhone", contextUri: null }],
      { timezone: TZ },
    );
    const [live] = ids(db) as [number];
    trashPlays(db, [live]);
    expect(coveredByLive(db, uri("a"), Date.parse("2026-01-05T10:00:05Z"))).toBe(true);

    const result = importExport(
      db,
      [
        {
          name: "Streaming_History_Audio_2026.json",
          content: JSON.stringify([
            { ts: "2026-01-05T10:00:01Z", platform: "ios", ms_played: 200000, master_metadata_track_name: "Song A", master_metadata_album_artist_name: "Artist X", spotify_track_uri: uri("a"), reason_start: "clickrow", reason_end: "trackdone" },
          ]),
        },
      ],
      { timezone: TZ },
    );
    expect(result).toMatchObject({ inserted: 0, deleted: 1 });
    expect(overview(db, all).plays).toBe(0);
    const trashed = history(db, { range: {}, limit: 10, offset: 0, trash: true }).items;
    expect(trashed).toHaveLength(1);
    expect(trashed[0]).toMatchObject({ id: live, source: "export" });
    restorePlays(db, [live]);
    expect(history(db, { range: {}, limit: 10, offset: 0 }).items[0]).toMatchObject({ id: live, source: "export" });
  });

  test("re-importing a stored export row leaves a deleted api play of the same listen in the trash", () => {
    const db = testDb();
    upsertTracks(db, [track("a", "Song A", "Artist X", null)]);
    importExport(db, [exportFile("a", ["2026-01-05T10:00:00Z"])], { timezone: TZ });
    insertPlays(db, [play("2026-01-05T10:00:10Z", uri("a"), null)], { timezone: TZ });
    const api = db.all<{ id: number }>(sql`select id from plays where source = 'api'`)[0]!.id;
    trashPlays(db, [api]);

    const again = importExport(db, [exportFile("a", ["2026-01-05T10:00:00Z"])], { timezone: TZ });

    expect(again).toMatchObject({ inserted: 0, deleted: 0, alreadyPresent: 1 });
    expect(restorePlays(db, [api])).toBe(1);
    expect(trashPlays(db, ids(db))).toBe(2);
  });

  test("a deleted repeat listen takes the export row nearest to it, not the first one in its window", () => {
    const db = testDb();
    upsertTracks(db, [track("a", "Song A", "Artist X", null)]);
    insertPlays(db, [play("2026-01-05T10:00:00Z", uri("a"), 200_000, { source: "live" }), play("2026-01-05T10:03:20Z", uri("a"), 200_000, { source: "live" })], { timezone: TZ });
    trashPlays(db, [ids(db)[1]!]);

    importExport(db, [exportFile("a", ["2026-01-05T10:00:00Z", "2026-01-05T10:03:20Z"])], { timezone: TZ });

    expect({ kept: isoTimes(db, "plays"), trashed: isoTimes(db, "play_trash") }).toEqual({ kept: ["2026-01-05T10:00:00.000Z"], trashed: ["2026-01-05T10:03:20.000Z"] });
  });

  describe("an export row of a deleted api play, stamped at the start of the listen", () => {
    function deletedApiPlay(durationMs: number) {
      const db = testDb();
      upsertTracks(db, [track("a", "Song A", "Artist X", null, { durationMs })]);
      insertPlays(db, [play("2026-01-05T10:00:00Z", uri("a"), null)], { timezone: TZ });
      trashPlays(db, ids(db));
      return db;
    }

    test("of a 5-minute song stays deleted", () => {
      const db = deletedApiPlay(300_000);

      const result = importExport(db, [exportFile("a", ["2026-01-05T10:05:00Z"], 300_000)], { timezone: TZ });

      expect({ result, trashed: isoTimes(db, "play_trash") }).toMatchObject({ result: { inserted: 0, deleted: 1 }, trashed: ["2026-01-05T10:05:00.000Z"] });
    });

    test("of a 30-second song stays deleted, and the next listen is kept", () => {
      const db = deletedApiPlay(30_000);

      const result = importExport(db, [exportFile("a", ["2026-01-05T10:00:30Z", "2026-01-05T10:01:30Z"], 30_000)], { timezone: TZ });

      expect({ result, kept: isoTimes(db, "plays") }).toMatchObject({ result: { inserted: 1, deleted: 1 }, kept: ["2026-01-05T10:01:30.000Z"] });
    });
  });

  test("routes trash, list, restore and empty", async () => {
    const app = testApp();
    library(app.db);
    const cookie = `encore_session=${createSession(app.db)}`;
    const [first] = ids(app.db) as [number];
    const res = await app.request("/api/plays/trash", { json: { ids: [first] }, headers: { cookie } });
    expect(await res.json()).toEqual({ trashed: 1 });
    const listed = (await (await app.request("/api/history?trash=true", { headers: { cookie } })).json()) as { total: number };
    expect(listed.total).toBe(1);
    expect(await (await app.request("/api/plays/restore", { json: { ids: [first] }, headers: { cookie } })).json()).toEqual({ restored: 1 });
    const key = songOf(app.db, "Song A")!.songKey;
    const song = (await (await app.request("/api/plays/trash/song", { json: { songKey: key }, headers: { cookie } })).json()) as { trashed: number };
    expect(song.trashed).toBe(3);
    expect(await (await app.request("/api/plays/trash", { headers: { cookie } })).json()).toEqual({ plays: 3 });
    expect(await (await app.request("/api/plays/trash", { method: "DELETE", headers: { cookie } })).json()).toEqual({ deleted: 3 });
  });
});

describe("artist aliases", () => {
  function aliased() {
    const db = testDb();
    seed(
      db,
      [track("a", "Song A", "Artist X", "Album 1"), track("b", "Song B", "Artist Y", "Album 2"), track("c", "Song C", "Artist  Y", "Album 3"), track("d", "Song D", "Artist Z", null)],
      [
        play("2026-01-05T10:00:00Z", uri("a"), 200_000),
        play("2026-01-05T11:00:00Z", uri("b"), 200_000),
        play("2026-01-05T12:00:00Z", uri("c"), 200_000),
        play("2026-01-06T12:00:00Z", uri("c"), 200_000),
        play("2026-01-06T13:00:00Z", uri("d"), 200_000),
      ],
    );
    return db;
  }
  const artists = (db: Db) => Object.fromEntries(topArtists(db, { ...all, limit: 10 }).map((a) => [a.artist, a.plays]));

  test("an alias moves its plays to the canonical artist, and removing it moves them back", () => {
    const db = aliased();
    const key = songOf(db, "Song C")!.songKey;
    addAlias(db, "Artist  Y", "Artist Y", 5);
    expect(artists(db)).toEqual({ "Artist X": 1, "Artist Y": 3, "Artist Z": 1 });
    const page = artistPage(db, { artist: "Artist Y", range: {}, period: "month", weekendDays: WEEKEND })!;
    expect(page.totals.plays).toBe(3);
    expect(page.alsoCounts).toEqual(["Artist  Y"]);
    expect(page.albums.map((a) => a.album).sort()).toEqual(["Album 2", "Album 3"]);
    expect(artistPage(db, { artist: "Artist  Y", range: {}, period: "month", weekendDays: WEEKEND })).toBeNull();
    expect(eras(db, { range: {}, limit: 5 }).artists.map((a) => a.artist)).not.toContain("Artist  Y");
    expect(songOf(db, "Song C")!.songKey).toBe(key);
    expect(history(db, { range: {}, artist: "Artist Y", limit: 10, offset: 0 }).total).toBe(3);

    removeAlias(db, "Artist  Y");
    expect(artists(db)).toEqual({ "Artist X": 1, "Artist Y": 1, "Artist  Y": 2, "Artist Z": 1 });
    expect(listAliases(db)).toEqual([]);
  });

  test("tracks that arrive later with the alias credit count as the canonical artist", () => {
    const db = aliased();
    addAlias(db, "Artist Z", "Artist X");
    seed(db, [track("e", "Song E", "Artist Z", null)], [play("2026-01-07T10:00:00Z", uri("e"), 200_000)]);
    expect(artists(db)).toEqual({ "Artist X": 3, "Artist Y": 1, "Artist  Y": 2 });
  });

  test("refuses itself, unknown artists, chains and cycles", () => {
    const db = aliased();
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return error instanceof AliasError ? error.code : String(error);
      }
      return null;
    };
    expect(code(() => addAlias(db, "Artist X", "Artist X"))).toBe("same_artist");
    expect(code(() => addAlias(db, "Nobody", "Artist X"))).toBe("unknown_artist");
    expect(code(() => addAlias(db, "Artist X", "Nobody"))).toBe("unknown_artist");
    addAlias(db, "Artist Z", "Artist X");
    expect(code(() => addAlias(db, "Artist Z", "Artist Y"))).toBe("already_alias");
    expect(code(() => addAlias(db, "Artist Y", "Artist Z"))).toBe("alias_chain");
    expect(code(() => addAlias(db, "Artist X", "Artist Z"))).toBe("alias_chain");
    expect(code(() => addAlias(db, "Artist X", "Artist Y"))).toBe("alias_chain");
    expect(code(() => removeAlias(db, "Artist Y"))).toBe("not_alias");
  });

  test("routes add, list and remove; an alias's page names where it went", async () => {
    const app = testApp();
    seed(app.db, [track("a", "Song A", "Artist X", null), track("b", "Song B", "Artist Y", null)], [play("2026-01-05T10:00:00Z", uri("a"), 1000), play("2026-01-05T11:00:00Z", uri("b"), 1000)]);
    const cookie = `encore_session=${createSession(app.db)}`;
    const added = await app.request("/api/artists/aliases", { json: { alias: "Artist Y", canonical: "Artist X" }, headers: { cookie } });
    expect(added.status).toBe(201);
    expect(await (await app.request("/api/artists/aliases", { json: { alias: "Artist X", canonical: "Artist Y" }, headers: { cookie } })).json()).toMatchObject({ error: { code: "alias_chain" } });
    const page = await app.request("/api/entities/artist?name=Artist%20Y", { headers: { cookie } });
    expect(page.status).toBe(404);
    expect(await page.json()).toMatchObject({ error: { code: "artist_alias", details: { canonical: "Artist X" } } });
    const list = (await (await app.request("/api/artists/aliases", { headers: { cookie } })).json()) as { items: { alias: string }[] };
    expect(list.items.map((i) => i.alias)).toEqual(["Artist Y"]);
    expect((await app.request("/api/artists/aliases?alias=Artist%20Y", { method: "DELETE", headers: { cookie } })).status).toBe(200);
    expect((await app.request("/api/entities/artist?name=Artist%20Y", { headers: { cookie } })).status).toBe(200);
  });
});
