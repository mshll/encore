import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { request } from "../../api/client";
import { useBackups, useTimezone } from "../../api/queries";
import type { BackupFile, BackupRun, OpsJob } from "../../api/types";
import { fmtAgo, fmtBytes, fmtTimestamp } from "../../lib/format";
import { showToast } from "../../lib/toast";
import { Button, buttonClass } from "../../ui/Button";
import { Notice } from "../../ui/Notice";
import { Section } from "../../ui/Page";
import { SettingRow, SettingRows } from "../../ui/SettingRow";
import { Skeleton } from "../../ui/Skeleton";
import { describeError, ErrorState } from "../../ui/States";
import { SettingsBlock, useSettingsForm } from "./form";

const SCHEDULE_KEYS = ["backupIntervalHours", "backupKeep"];
const BUCKET_KEYS = ["backupS3Endpoint", "backupS3Bucket", "backupS3Region", "backupS3AccessKeyId", "backupS3SecretAccessKey"];

function lastRun(job: OpsJob): { text: string; problem: boolean } {
  if (job.lastError) return { text: `Failed ${job.lastRunAt ? fmtAgo(job.lastRunAt) : ""}: ${job.lastError}`, problem: true };
  if (job.lastSuccessAt) return { text: `Last backup ${fmtAgo(job.lastSuccessAt)}`, problem: false };
  return { text: "No backup yet", problem: false };
}

function BackupList({ files, from }: { files: BackupFile[]; from: "local" | "remote" }) {
  const timezone = useTimezone();
  return (
    <ul className="flex flex-col">
      {files.map((file) => (
        <li key={file.name} className="flex min-h-(--row-h) items-center justify-between gap-4">
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-primary tabular" title={file.name}>
              {file.createdAt ? fmtTimestamp(file.createdAt, timezone) : file.name}
            </span>
            {!file.name.startsWith("encore-backup-") && <span className="text-caption text-secondary">Taken before old plays were deleted</span>}
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <span className="text-secondary tabular">{fmtBytes(file.size)}</span>
            <a
              href={`/api/backups/${encodeURIComponent(file.name)}/download${from === "remote" ? "?from=remote" : ""}`}
              download={file.name}
              className={buttonClass({ variant: "ghost", size: "sm" })}
              aria-label={`Download the backup from ${file.createdAt ? fmtTimestamp(file.createdAt, timezone) : file.name}`}
            >
              Download
            </a>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Backups() {
  const queryClient = useQueryClient();
  const backups = useBackups();
  const [problem, setProblem] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => request<BackupRun>("/api/backups", { method: "POST" }),
    onSuccess: () => {
      setProblem(null);
      showToast("Backed up");
    },
    onError: (e) => setProblem(describeError(e)),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["backups"] }),
  });
  const data = backups.data;
  const line = data && lastRun(data.job);
  return (
    <Section
      title="Backups"
      description={line && !problem && <span className={line.problem ? "text-danger" : undefined}>{line.text}</span>}
      actions={
        <Button size="sm" busy={run.isPending || data?.running} busyLabel="Backing up" disabled={!data} onClick={() => run.mutate()}>
          Back up now
        </Button>
      }
    >
      {problem && <Notice tone="danger">{problem}</Notice>}
      {backups.error ? (
        <ErrorState error={backups.error} onRetry={() => void backups.refetch()} size="inline" />
      ) : !data ? (
        <div aria-busy className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      ) : (
        <>
          {data.local.length > 0 && <BackupList files={data.local} from="local" />}
          {data.remote !== null && (
            <div className="flex flex-col gap-2">
              <h3 className="text-body-sm font-medium text-primary">In the bucket</h3>
              {data.remoteError ? (
                <p className="text-danger">Could not list the bucket: {data.remoteError}</p>
              ) : data.remote.length > 0 ? (
                <BackupList files={data.remote} from="remote" />
              ) : (
                <p className="text-secondary">Nothing uploaded yet.</p>
              )}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function Export() {
  return (
    <Section title="Export">
      <SettingRows>
        <SettingRow label="Every play">
          {() => (
            <div className="flex gap-2 md:justify-end">
              <a href="/api/export/plays?format=csv" download className={buttonClass()}>
                Download CSV
              </a>
              <a href="/api/export/plays?format=json" download className={buttonClass()}>
                Download JSON
              </a>
            </div>
          )}
        </SettingRow>
      </SettingRows>
    </Section>
  );
}

export function DataTab() {
  const schedule = useSettingsForm(SCHEDULE_KEYS);
  const bucket = useSettingsForm(BUCKET_KEYS);
  const storage = bucket.settings.data?.secretStorage.available ?? true;
  return (
    <>
      <Backups />
      <SettingsBlock title="Schedule" keys={SCHEDULE_KEYS} form={schedule} />
      <SettingsBlock title="Copy to a bucket" keys={BUCKET_KEYS} form={bucket} storage={storage} />
      <Export />
    </>
  );
}
