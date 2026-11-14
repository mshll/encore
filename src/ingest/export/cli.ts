import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../../config";
import { openDb } from "../../db/client";
import { SettingsStore } from "../../settings/store";
import { exportFileKind } from "./parse";
import { importExport } from "./import";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: bun run import <export-directory>");
  process.exit(1);
}

const config = loadConfig();
const names = (await readdir(dir)).filter((name) => exportFileKind(name));
const files = await Promise.all(names.map(async (name) => ({ name, content: await Bun.file(join(dir, name)).text() })));
const db = openDb(config.databasePath);
const result = importExport(db, files, new SettingsStore(db, config).get().timezone);
console.log(JSON.stringify(result, null, 2));
