import { z } from "zod";
import type { PlayKind } from "../../db/schema";
import { deviceFromPlatform } from "../../plays/device";
import type { PlayInput, TrackInput } from "../../plays/store";

const text = z.string().max(1000).nullable().optional();
const flag = z.boolean().nullable().optional();
const uri = (type: string) =>
  z
    .string()
    .regex(new RegExp(`^spotify:${type}:[A-Za-z0-9]{22}$`))
    .nullable()
    .optional();

const rowSchema = z.object({
  ts: z.iso.datetime(),
  platform: text,
  ms_played: z.number().int().min(0).max(86_400_000),
  conn_country: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
  master_metadata_track_name: text,
  master_metadata_album_artist_name: text,
  master_metadata_album_album_name: text,
  spotify_track_uri: uri("track"),
  episode_name: text,
  episode_show_name: text,
  spotify_episode_uri: uri("episode"),
  audiobook_title: text,
  audiobook_uri: uri("audiobook"),
  audiobook_chapter_uri: uri("chapter"),
  audiobook_chapter_title: text,
  reason_start: text,
  reason_end: text,
  shuffle: flag,
  skipped: flag,
  offline: flag,
  incognito_mode: flag,
});

export type ExportRow = z.infer<typeof rowSchema>;
export type ExportFileKind = "audio" | "video";
export type ParsedEntry = { play: Omit<PlayInput, "dedupeKey">; identity: string; track?: TrackInput };
export type ParsedFile = { kind: ExportFileKind; entries: ParsedEntry[]; invalid: number };

export class ExportFormatError extends Error {}

const filePattern = /^Streaming_History_(Audio|Video)_[\w-]*\.json$/;

export function exportFileKind(name: string): ExportFileKind | null {
  const match = filePattern.exec(name);
  if (!match) return null;
  return match[1] === "Video" ? "video" : "audio";
}

function toEntry(row: ExportRow, fileKind: ExportFileKind): ParsedEntry | null {
  const itemUri = row.spotify_track_uri ?? row.spotify_episode_uri ?? row.audiobook_chapter_uri ?? row.audiobook_uri;
  if (!itemUri) return null;
  const isTrack = Boolean(row.spotify_track_uri);
  if (isTrack && (!row.master_metadata_track_name || !row.master_metadata_album_artist_name)) return null;
  const kind: PlayKind = fileKind === "video" ? "video" : isTrack ? "track" : row.spotify_episode_uri ? "episode" : "audiobook";
  const ts = Date.parse(row.ts);
  const play: ParsedEntry["play"] = {
    ts,
    kind,
    trackUri: row.spotify_track_uri ?? null,
    episodeUri: isTrack ? null : itemUri,
    episodeName: row.episode_name ?? row.audiobook_chapter_title ?? null,
    showName: row.episode_show_name ?? row.audiobook_title ?? null,
    msPlayed: row.ms_played,
    reasonStart: row.reason_start ?? null,
    reasonEnd: row.reason_end ?? null,
    skipped: row.skipped ?? null,
    shuffle: row.shuffle ?? null,
    offline: row.offline ?? null,
    incognito: row.incognito_mode ?? null,
    device: deviceFromPlatform(row.platform),
    platformRaw: row.platform ?? null,
    connCountry: row.conn_country ?? null,
    source: "export",
  };
  const identity = JSON.stringify([row.ts, itemUri, row.ms_played, row.reason_start ?? null, row.reason_end ?? null]);
  const track = isTrack
    ? {
        uri: row.spotify_track_uri!,
        name: row.master_metadata_track_name!,
        artist: row.master_metadata_album_artist_name!,
        album: row.master_metadata_album_album_name ?? null,
      }
    : undefined;
  return { play, identity, track };
}

export function parseExportFile(name: string, content: string): ParsedFile {
  const kind = exportFileKind(name);
  if (!kind) throw new ExportFormatError(`${name}: not a Streaming_History_Audio/Video file`);
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new ExportFormatError(`${name}: not valid JSON`);
  }
  if (!Array.isArray(data)) throw new ExportFormatError(`${name}: expected a JSON array`);
  const entries: ParsedEntry[] = [];
  let invalid = 0;
  for (const raw of data) {
    const parsed = rowSchema.safeParse(raw);
    const entry = parsed.success ? toEntry(parsed.data, kind) : null;
    if (entry) entries.push(entry);
    else invalid++;
  }
  return { kind, entries, invalid };
}
