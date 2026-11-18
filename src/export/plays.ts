import { sql, type SQL } from "drizzle-orm";
import { OUTCOME, type PlayOutcome } from "../analytics/common";
import type { Db } from "../db/client";
import type { Device, PlayKind, PlaySource } from "../db/schema";

export const EXPORT_FORMATS = ["csv", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportedPlay = {
  timestamp: string;
  day: string;
  hour: number;
  kind: PlayKind;
  name: string | null;
  artist: string | null;
  album: string | null;
  uri: string | null;
  msPlayed: number | null;
  outcome: PlayOutcome | null;
  device: Device;
  source: PlaySource;
};

export const EXPORT_COLUMNS = ["timestamp", "day", "hour", "kind", "name", "artist", "album", "uri", "msPlayed", "outcome", "device", "source"] as const satisfies readonly (keyof ExportedPlay)[];

type Row = Omit<ExportedPlay, "timestamp" | "msPlayed"> & { id: number; ts: number; ms_played: number | null };

const BATCH = 1000;

/** Plays oldest first, a batch per call, keyed on (ts, id) so no statement stays open between batches. */
export function* playBatches(db: Db, batch = BATCH): Generator<ExportedPlay[]> {
  let after: { ts: number; id: number } | null = null;
  for (;;) {
    const cursor: SQL = after ? sql`where p.ts > ${after.ts} or (p.ts = ${after.ts} and p.id > ${after.id})` : sql``;
    const rows: Row[] = db.all<Row>(sql`
      select p.id, p.ts, p.day, p.hour, p.kind, coalesce(t.name, p.episode_name) as name, coalesce(t.artist, p.show_name) as artist, t.album,
        coalesce(p.track_uri, p.episode_uri) as uri, p.ms_played, case when p.kind = 'track' then ${OUTCOME} end as outcome, p.device, p.source
      from plays p left join tracks t on t.uri = p.track_uri
      ${cursor}
      order by p.ts, p.id limit ${batch}`);
    if (rows.length === 0) return;
    yield rows.map(({ id: _id, ts, ms_played, ...rest }) => ({ ...rest, timestamp: new Date(ts).toISOString(), msPlayed: ms_played }));
    const last: Row = rows.at(-1)!;
    after = { ts: last.ts, id: last.id };
  }
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV field (RFC 4180): quoted when it holds a comma, quote or line break, with quotes doubled. Text a spreadsheet would run as a formula gets a leading `'`. */
export function csvField(value: string | number | null): string {
  if (value === null) return "";
  const text = typeof value === "string" && FORMULA_START.test(value) ? `'${value}` : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const csvLine = (play: ExportedPlay) => `${EXPORT_COLUMNS.map((c) => csvField(play[c])).join(",")}\r\n`;

/** The whole export as a stream, encoded one batch at a time. */
export function exportStream(db: Db, format: ExportFormat): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const batches = playBatches(db);
  const csv = format === "csv";
  let wrote = false;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(csv ? `${EXPORT_COLUMNS.join(",")}\r\n` : "["));
    },
    pull(controller) {
      const next = batches.next();
      if (next.done) {
        if (!csv) controller.enqueue(encoder.encode(wrote ? "\n]\n" : "]\n"));
        controller.close();
        return;
      }
      const body = csv ? next.value.map(csvLine).join("") : `${wrote ? "," : ""}\n${next.value.map((p) => JSON.stringify(p)).join(",\n")}`;
      controller.enqueue(encoder.encode(body));
      wrote = true;
    },
  });
}
