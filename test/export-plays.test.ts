import { describe, expect, test } from "bun:test";
import { csvField, exportStream, playBatches } from "../src/export/plays";
import { insertPlays } from "../src/plays/store";
import { play, seed, testDb, track, TZ, uri } from "./helpers";

const A = uri("a");

function withPlays() {
  const db = testDb();
  seed(
    db,
    [track("a", 'Say "Hi", Then\nLeave', "Artist, The", "Album", { durationMs: 200_000 })],
    [play("2026-01-05T10:00:00Z", A, 200_000, { reasonEnd: "trackdone" }), play("2026-01-05T09:00:00Z", A, 10_000, { reasonEnd: "fwdbtn", skipped: true })],
  );
  insertPlays(
    db,
    [{ ...play("2026-01-06T10:00:00Z", A, 60_000), kind: "episode", trackUri: null, episodeUri: "spotify:episode:1", episodeName: "Ep 1", showName: "Show" }],
    { timezone: TZ },
  );
  return db;
}

const text = (stream: ReadableStream<Uint8Array>) => new Response(stream).text();

describe("csv fields", () => {
  test("quotes commas, quotes and line breaks and doubles quotes", () => {
    expect([csvField("plain"), csvField("a,b"), csvField('say "hi"'), csvField("two\nlines"), csvField(null), csvField(42)]).toEqual([
      "plain",
      '"a,b"',
      '"say ""hi"""',
      '"two\nlines"',
      "",
      "42",
    ]);
  });

  test("prefixes text that a spreadsheet would read as a formula with a quote", () => {
    const fields = ["=SUM(A1)", "+1", "-cmd", "@x", "\tlead", "\rlead", "=a,b"].map(csvField);

    expect(fields).toEqual(["'=SUM(A1)", "'+1", "'-cmd", "'@x", "'\tlead", "\"'\rlead\"", "\"'=a,b\""]);
  });

  test("leaves numbers and text with a formula character later on alone", () => {
    const fields = [csvField(-3), csvField("a=b"), csvField("AC/DC - Live")];

    expect(fields).toEqual(["-3", "a=b", "AC/DC - Live"]);
  });
});

describe("plays export", () => {
  test("rows come oldest first with local day, outcome and the episode's show", () => {
    const db = withPlays();

    const rows = [...playBatches(db, 2)].flat();

    expect(rows.map((r) => [r.timestamp, r.day, r.hour, r.kind, r.artist, r.outcome])).toEqual([
      ["2026-01-05T09:00:00.000Z", "2026-01-05", 12, "track", "Artist, The", "early"],
      ["2026-01-05T10:00:00.000Z", "2026-01-05", 13, "track", "Artist, The", "through"],
      ["2026-01-06T10:00:00.000Z", "2026-01-06", 13, "episode", "Show", null],
    ]);
  });

  test("never carries an ip address column", () => {
    const db = withPlays();

    const row = [...playBatches(db)].flat()[0]!;

    expect(Object.keys(row).some((k) => k.toLowerCase().includes("ip"))).toBe(false);
  });

  test("CSV has a header and escapes names", async () => {
    const db = withPlays();

    const lines = (await text(exportStream(db, "csv"))).split("\r\n");

    expect(lines[0]).toBe("timestamp,day,hour,kind,name,artist,album,uri,msPlayed,outcome,device,source");
    expect(lines[1]).toBe(`2026-01-05T09:00:00.000Z,2026-01-05,12,track,"Say ""Hi"", Then\nLeave","Artist, The",Album,${A},10000,early,ios,export`);
  });

  test("JSON parses back to every play", async () => {
    const db = withPlays();

    const parsed = JSON.parse(await text(exportStream(db, "json"))) as unknown[];

    expect(parsed).toHaveLength(3);
  });

  test("JSON keeps a name that starts with a formula character as it is", async () => {
    const db = testDb();
    seed(db, [track("f", "=Formula", "-Artist", "Album")], [play("2026-01-05T10:00:00Z", uri("f"), 200_000)]);

    const [row] = JSON.parse(await text(exportStream(db, "json"))) as { name: string; artist: string }[];

    expect([row!.name, row!.artist]).toEqual(["=Formula", "-Artist"]);
  });

  test("JSON of no plays is an empty array", async () => {
    expect(JSON.parse(await text(exportStream(testDb(), "json")))).toEqual([]);
  });
});
