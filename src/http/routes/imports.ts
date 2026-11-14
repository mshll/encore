import { Hono } from "hono";
import { EmptyImportError, importExport } from "../../ingest/export/import";
import { ExportFormatError } from "../../ingest/export/parse";
import type { Env } from "../context";
import { ApiError } from "../errors";

export const MAX_IMPORT_FILES = 30;
export const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024;

export const importRoutes = new Hono<Env>().post("/", async (c) => {
  const { db, config, now } = c.var.deps;
  if (!c.req.header("content-type")?.startsWith("multipart/form-data")) {
    throw new ApiError(415, "multipart_required", "Upload the export files as multipart/form-data in the 'files' field");
  }
  const body = await c.req.parseBody({ all: true });
  const files = [body.files].flat().filter((f): f is File => f instanceof File);
  if (files.length === 0) throw new ApiError(400, "no_files", "No files in the 'files' field");
  if (files.length > MAX_IMPORT_FILES) throw new ApiError(400, "too_many_files", `At most ${MAX_IMPORT_FILES} files per upload`);
  const tooLarge = files.find((f) => f.size > MAX_IMPORT_FILE_BYTES);
  if (tooLarge) throw new ApiError(413, "file_too_large", `${tooLarge.name} exceeds ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB`);
  const contents = await Promise.all(files.map(async (f) => ({ name: f.name, content: await f.text() })));
  try {
    return c.json(importExport(db, contents, config.timezone, now()));
  } catch (error) {
    if (error instanceof ExportFormatError || error instanceof EmptyImportError) throw new ApiError(400, "invalid_export", error.message);
    throw error;
  }
});
