import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../../api/client";
import type { ImportResult, Onboarding } from "../../api/types";
import { DitherMeter } from "../../charts/DitherMeter";
import { fmtDate, fmtInt } from "../../lib/format";
import { uploadForm } from "../../lib/upload";
import { Button, IconButton } from "../../ui/Button";
import { DropZone } from "../../ui/DropZone";
import { Icon } from "../../ui/Icon";
import { FileTextIcon, XIcon } from "../../ui/icons";
import { Notice } from "../../ui/Notice";
import { describeError } from "../../ui/States";

const MAX_FILES = 30;
const MAX_BYTES = 50 * 1024 * 1024;

const plays = (n: number) => `${fmtInt(n)} ${n === 1 ? "play" : "plays"}`;

function size(bytes: number) {
  if (bytes < 1024 * 1024) return `${fmtInt(Math.max(1, Math.round(bytes / 1024)))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function importProblem(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "file_too_large") return "A file is over 50 MB. Upload the Streaming_History files one by one.";
    if (error.code === "too_many_files") return `Upload at most ${MAX_FILES} files at a time.`;
    if (error.code === "invalid_export") return `${error.message}. Nothing was imported.`;
    if (error.code === "no_files") return "Choose at least one file.";
  }
  return describeError(error);
}

function Result({ result, timezone }: { result: ImportResult; timezone: string }) {
  const read = result.files.filter((f) => f.rows > 0).length;
  return (
    <div role="status" className="flex flex-col gap-1">
      <p className="font-medium text-primary">
        {plays(result.inserted)} added from {fmtInt(read)} {read === 1 ? "file" : "files"}
      </p>
      <p className="text-secondary text-pretty">
        {[
          result.range && `${fmtDate(result.range.from, timezone)} to ${fmtDate(result.range.to, timezone)}.`,
          result.alreadyPresent > 0 && `${plays(result.alreadyPresent)} were already stored.`,
          result.invalidRows > 0 && `${fmtInt(result.invalidRows)} ${result.invalidRows === 1 ? "row" : "rows"} could not be read and ${result.invalidRows === 1 ? "was" : "were"} skipped.`,
          result.ignoredFiles.length > 0 && `Not history files, ignored: ${result.ignoredFiles.join(", ")}.`,
        ]
          .filter(Boolean)
          .join(" ")}
      </p>
    </div>
  );
}

/** Upload the Spotify export: drop or choose files, see what goes up, watch the upload, read what was added. */
export function ImportStep({ step, timezone }: { step: Onboarding["steps"]["import"]; timezone: string }) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const add = (picked: File[]) => {
    setProblem(null);
    setResult(null);
    const next = [...files, ...picked.filter((p) => !files.some((f) => f.name === p.name && f.size === p.size))];
    if (next.length > MAX_FILES) setProblem(`Upload at most ${MAX_FILES} files at a time.`);
    setFiles(next.slice(0, MAX_FILES));
  };
  const tooBig = files.filter((f) => f.size > MAX_BYTES);

  const upload = async () => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    setProgress(0);
    setProblem(null);
    try {
      const r = await uploadForm<ImportResult>("/api/import", form, setProgress);
      setResult(r);
      setFiles([]);
      await queryClient.invalidateQueries();
    } catch (error) {
      setProblem(importProblem(error));
    } finally {
      setProgress(null);
    }
  };

  const uploading = progress !== null;
  return (
    <div className="flex flex-col gap-4">
      {step.done && !result && (
        <p className="text-secondary">
          {plays(step.exportPlays)} imported{step.lastImportAt ? `, last on ${fmtDate(step.lastImportAt, timezone)}` : ""}. Plays already stored are skipped when you import again.
        </p>
      )}
      {result && <Result result={result} timezone={timezone} />}
      <DropZone
        onFiles={add}
        accept=".json,application/json"
        disabled={uploading}
        title="Drop your Streaming_History_Audio files here"
        description={
          <>
            Ask for your extended streaming history on{" "}
            <a href="https://www.spotify.com/account/privacy/" target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-2">
              Spotify’s privacy page
            </a>
            . It arrives as a zip; unzip it first.
          </>
        }
      />
      {files.length > 0 && (
        <ul className="flex flex-col" aria-label="Files to import">
          {files.map((f) => (
            <li key={`${f.name}-${f.size}`} className="flex min-h-(--row-h-compact) items-center gap-3">
              <Icon icon={FileTextIcon} className="text-tertiary" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className={f.size > MAX_BYTES ? "shrink-0 text-danger tabular" : "shrink-0 text-secondary tabular"}>{size(f.size)}</span>
              <IconButton icon={XIcon} label={`Remove ${f.name}`} size="sm" disabled={uploading} onClick={() => setFiles(files.filter((x) => x !== f))} />
            </li>
          ))}
        </ul>
      )}
      {uploading && (
        <div className="flex items-center gap-3" role="status" aria-label="Uploading">
          <div className="h-2 flex-1 bg-chart-empty">
            <DitherMeter share={progress} />
          </div>
          <span className="w-24 shrink-0 text-right text-secondary tabular">{progress < 1 ? `${Math.round(progress * 100)}%` : "Reading files"}</span>
        </div>
      )}
      {tooBig.length > 0 && <Notice tone="danger">Files over 50 MB cannot be uploaded: {tooBig.map((f) => f.name).join(", ")}.</Notice>}
      {problem && <Notice tone="danger">{problem}</Notice>}
      {files.length > 0 && !uploading && (
        <Button variant="primary" className="self-end" disabled={tooBig.length > 0} onClick={() => void upload()}>
          Import {fmtInt(files.length)} {files.length === 1 ? "file" : "files"}
        </Button>
      )}
    </div>
  );
}
