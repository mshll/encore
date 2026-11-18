import { S3Client } from "bun";
import type { S3Settings } from "../settings/settings";
import { BACKUP_PREFIX } from "./snapshot";

export type RemoteObject = { name: string; size: number; at: number | null };

/** Where backups are copied off the server. Only scheduled backups (`BACKUP_PREFIX`) are listed. */
export interface RemoteStore {
  upload(name: string, path: string): Promise<void>;
  list(): Promise<RemoteObject[]>;
  remove(name: string): Promise<void>;
  exists(name: string): Promise<boolean>;
  stream(name: string): ReadableStream<Uint8Array>;
}

const MAX_PAGES = 50;

export function s3Store(settings: S3Settings): RemoteStore {
  const client = new S3Client({
    endpoint: settings.endpoint,
    bucket: settings.bucket,
    region: settings.region,
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
  });
  return {
    upload: async (name, path) => {
      await client.write(name, Bun.file(path), { type: "application/vnd.sqlite3" });
    },
    list: async () => {
      const objects: RemoteObject[] = [];
      let startAfter: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await client.list({ prefix: BACKUP_PREFIX, ...(startAfter ? { startAfter } : {}) });
        const contents = res.contents ?? [];
        for (const item of contents) {
          const at = item.lastModified ? Date.parse(item.lastModified) : Number.NaN;
          objects.push({ name: item.key, size: item.size ?? 0, at: Number.isNaN(at) ? null : at });
        }
        if (!res.isTruncated || contents.length === 0) break;
        startAfter = contents.at(-1)!.key;
      }
      return objects;
    },
    remove: (name) => client.delete(name),
    exists: (name) => client.exists(name),
    stream: (name) => client.file(name).stream(),
  };
}
