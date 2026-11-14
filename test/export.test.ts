import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { openDb } from "../src/db/client";
import { importExport } from "../src/ingest/export/import";
import { ExportFormatError, parseExportFile } from "../src/ingest/export/parse";
import { play, seed, track, TZ, uri } from "./helpers";

const IP = "203.0.113.77";

function row(overrides: Record<string, unknown> = {}) {
  return {
    ts: "2026-01-05T10:00:00Z",
    platform: "ios",
    ms_played: 200000,
    conn_country: "KW",
    ip_addr: IP,
    master_metadata_track_name: "Song A",
    master_metadata_album_artist_name: "Artist X",
    master_metadata_album_album_name: "Album 1",
    spotify_track_uri: uri("a1"),
    episode_name: null,
    episode_show_name: null,
    spotify_episode_uri: null,
    audiobook_title: null,
    audiobook_uri: null,
    audiobook_chapter_uri: null,
    audiobook_chapter_title: null,
    reason_start: "clickrow",
    reason_end: "trackdone",
    shuffle: false,
    skipped: false,
    offline: false,
    offline_timestamp: 1767607200,
    incognito_mode: false,
    ...overrides,
  };
}

const episode = row({
  ts: "2026-01-06T10:00:00Z",
  master_metadata_track_name: null,
  master_metadata_album_artist_name: null,
  master_metadata_album_album_name: null,
  spotify_track_uri: null,
  episode_name: "Ep 1",
  episode_show_name: "Show",
  spotify_episode_uri: "spotify:episode:" + "e".repeat(22),
});

const file = (name: string, rows: unknown[]) => ({ name, content: JSON.stringify(rows) });

describe("export parsing", () => {
  test("validates rows, counts invalid ones and classifies kinds", () => {
    const parsed = parseExportFile("Streaming_History_Audio_2026.json", JSON.stringify([row(), episode, row({ ms_played: "x" }), row({ spotify_track_uri: "nope" }), 42]));
    expect(parsed.kind).toBe("audio");
    expect(parsed.entries.map((e) => e.play.kind)).toEqual(["track", "episode"]);
    expect(parsed.invalid).toBe(3);
    expect(parseExportFile("Streaming_History_Video_2026.json", JSON.stringify([row()])).entries[0]!.play.kind).toBe("video");
  });

  test("rejects files that are not JSON arrays or not export files", () => {
    expect(() => parseExportFile("Streaming_History_Audio_1.json", "{}")).toThrow(ExportFormatError);
    expect(() => parseExportFile("Streaming_History_Audio_1.json", "not json")).toThrow(ExportFormatError);
    expect(() => parseExportFile("evil.json", "[]")).toThrow(ExportFormatError);
  });

  test("never persists ip_addr anywhere in the database", () => {
    const path = join(mkdtempSync(join(tmpdir(), "encore-")), "test.db");
    const db = openDb(path);
    importExport(db, [file("Streaming_History_Audio_2026.json", [row(), episode])], TZ);
    const dump = new Database(path)
      .query("select * from plays")
      .all()
      .concat(new Database(path).query("select * from tracks").all(), new Database(path).query("select * from job_state").all());
    expect(JSON.stringify(dump)).not.toContain(IP);
    const columns = new Database(path).query("select name from pragma_table_info('plays')").all() as { name: string }[];
    expect(columns.map((c) => c.name)).not.toContain("ip_addr");
  });
});

describe("export import", () => {
  test("re-importing the same export inserts nothing new", () => {
    const db = openDb(":memory:");
    const files = [file("Streaming_History_Audio_2026.json", [row(), row({ ts: "2026-01-07T10:00:00Z" }), episode])];
    const first = importExport(db, files, TZ);
    const second = importExport(db, files, TZ);
    expect(first.inserted).toBe(3);
    expect(second.inserted).toBe(0);
    expect(second.alreadyPresent).toBe(3);
    expect(db.all<{ n: number }>(sql`select count(*) as n from plays`)[0]!.n).toBe(3);
  });

  test("keeps identical rows inside one export as separate plays, idempotently", () => {
    const db = openDb(":memory:");
    const files = [file("Streaming_History_Audio_2021.json", [row(), row()])];
    expect(importExport(db, files, TZ).inserted).toBe(2);
    expect(importExport(db, files, TZ).inserted).toBe(0);
  });

  test("a newer, larger export adds only the new rows", () => {
    const db = openDb(":memory:");
    importExport(db, [file("Streaming_History_Audio_2026.json", [row()])], TZ);
    const result = importExport(db, [file("Streaming_History_Audio_2026.json", [row(), row({ ts: "2026-03-01T10:00:00Z" })])], TZ);
    expect(result.inserted).toBe(1);
  });

  test("export rows supersede api plays inside the export's time range only", () => {
    const db = openDb(":memory:");
    seed(
      db,
      [track("a1", "Song A", "Artist X", "Album 1")],
      [play("2026-01-06T10:00:00Z", uri("a1"), null), play("2026-01-07T10:00:00.400Z", uri("a1"), null), play("2026-01-08T10:00:00Z", uri("a1"), null)],
    );
    const result = importExport(db, [file("Streaming_History_Audio_2026.json", [row(), row({ ts: "2026-01-07T10:00:00Z" })])], TZ);
    expect(result.apiPlaysRemoved).toBe(2);
    const left = db.all<{ source: string; ts: number }>(sql`select source, ts from plays order by ts`);
    expect(left.map((p) => p.source)).toEqual(["export", "export", "api"]);
    expect(left[2]!.ts).toBe(Date.parse("2026-01-08T10:00:00Z"));
  });

  test("stores local Kuwait day, hour and weekday", () => {
    const db = openDb(":memory:");
    importExport(db, [file("Streaming_History_Audio_2026.json", [row({ ts: "2026-01-04T22:30:00Z" })])], TZ);
    expect(db.all(sql`select day, hour, weekday from plays`)).toEqual([{ day: "2026-01-05", hour: 1, weekday: 1 }]);
  });
});
