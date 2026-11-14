import { useMutation, useQueryClient } from "@tanstack/react-query";
import { request } from "../../api/client";
import { useNote } from "../../api/queries";
import type { Note } from "../../api/types";
import { assistantProblem } from "../../lib/assistant";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { ArrowUpRightIcon } from "../../ui/icons";
import { Section } from "../../ui/Page";
import { Skeleton } from "../../ui/Skeleton";
import { Notice } from "../../ui/Notice";
import { ErrorState } from "../../ui/States";

/** The cached liner note for a song, or a button to write one. Writing is a paid Claude call, so only a click starts it. */
export function LinerNotes({ songKey }: { songKey: string }) {
  const q = useNote(songKey);
  const queryClient = useQueryClient();
  const write = useMutation({
    mutationFn: () => request<Note>("/api/notes", { json: { songKey } }),
    onSuccess: (note) => queryClient.setQueryData(["note", songKey], note),
  });
  const note = q.data;
  return (
    <Section
      title="Liner notes"
      actions={
        q.data === null && (
          <Button busy={write.isPending} busyLabel="Writing" onClick={() => write.mutate()}>
            Write liner notes
          </Button>
        )
      }
    >
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} title="Could not load the notes" />
      ) : q.isPending ? (
        <div aria-hidden className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : note ? (
        <div className="flex max-w-2xl flex-col gap-4">
          {note.text
            .split(/\n{2,}/)
            .filter(Boolean)
            .map((p, i) => (
              <p key={i} className="text-body text-pretty">
                {p}
              </p>
            ))}
          {note.sources.length > 0 && (
            <ul className="flex flex-col">
              {note.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex min-h-7 max-w-full items-center gap-1 text-caption text-secondary hover:text-primary phone:min-h-11">
                    <span className="truncate">{s.title}</span>
                    <Icon icon={ArrowUpRightIcon} className="shrink-0" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex max-w-2xl flex-col gap-2">
          <p className="text-secondary text-pretty">Samples, where it sits in the artist’s work, and how it fits your listening.</p>
          {write.isError && (
            <Notice tone="danger" onRetry={() => write.mutate()}>
              {assistantProblem(write.error)}
            </Notice>
          )}
        </div>
      )}
    </Section>
  );
}
