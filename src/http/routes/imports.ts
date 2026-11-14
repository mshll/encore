import { Hono } from "hono";
import { EmptyImportError, importExport } from "../../ingest/export/import";
import { ExportFormatError } from "../../ingest/export/parse";
import { limitMultipartParts, PartTooLargeError } from "../bodyLimits";
import type { Env } from "../context";
import { ApiError } from "../errors";

export const MAX_IMPORT_FILES = 30;
export const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024;
const PART_HEADER_BYTES = 16 * 1024;

export const importRoutes = new Hono<Env>().post("/", async (c) => {
  const { db, config, now } = c.var.deps;
  if (!c.req.header("content-type")?.startsWith("multipart/form-data")) {
    throw new ApiError(415, "multipart_required", "Upload the export files as multipart/form-data in the 'files' field");
  }
  const tooLarge = () => new ApiError(413, "file_too_large", `Each file must be at most ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB`);
  const form = await limitMultipartParts(c.req.raw, MAX_IMPORT_FILE_BYTES + PART_HEADER_BYTES)
    .formData()
    .catch((error: unknown) => {
      if (error instanceof PartTooLargeError) throw tooLarge();
      throw new ApiError(400, "invalid_multipart", "Could not read the multipart body");
    });
  const files = form.getAll("files").filter((f) => f instanceof File) as File[];
  if (files.length === 0) throw new ApiError(400, "no_files", "No files in the 'files' field");
  if (files.length > MAX_IMPORT_FILES) throw new ApiError(400, "too_many_files", `At most ${MAX_IMPORT_FILES} files per upload`);
  if (files.some((f) => f.size > MAX_IMPORT_FILE_BYTES)) throw tooLarge();
  const contents: { name: string; content: string }[] = [];
  for (const f of files) contents.push({ name: f.name, content: await f.text() });
  try {
    return c.json(importExport(db, contents, config.timezone, now()));
  } catch (error) {
    if (error instanceof ExportFormatError || error instanceof EmptyImportError) throw new ApiError(400, "invalid_export", error.message);
    throw error;
  }
});
