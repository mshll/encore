import { useMutation, useQueryClient } from "@tanstack/react-query";
import { request } from "../api/client";
import { useNote } from "../api/queries";
import type { Note } from "../api/types";
import { assistantProblem } from "../lib/assistant";
import { ArrowUpRight01Icon, Icon } from "./Icon";
import { Section } from "./Page";
import { Skeleton } from "./states";

/** The cached liner note for a song, or a button to write one. Writing one is a paid call, so it never happens on its own. */
export function LinerNotes({ songKey }: { songKey: string }) {
  const q = useNote(songKey);
  const queryClient = useQueryClient();
  const write = useMutation({
    mutationFn: () => request<Note>("/api/notes", { json: { songKey } }),
    onSuccess: (note) => queryClient.setQueryData(["note", songKey], note),
  });
  const note = q.data;
  return (
    <Section title="Notes">
      {q.isPending ? (
        <Skeleton className="h-20 w-full max-w-2xl" />
      ) : note ? (
        <div className="flex max-w-2xl flex-col gap-4">
          {note.text
            .split(/\n{2,}/)
            .filter(Boolean)
            .map((p, i) => (
              <p key={i} className="text-body-lg text-pretty">
                {p}
              </p>
            ))}
          {note.sources.length > 0 && (
            <ul className="flex flex-col gap-1">
              {note.sources.map((s) => (
                <li key={s.url}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex max-w-full items-center gap-1 text-body-sm text-secondary hover-fine:text-primary"
                  >
                    <span className="truncate">{s.title}</span>
                    <Icon icon={ArrowUpRight01Icon} size={16} />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : write.isPending ? (
        <p role="status" className="flex items-center gap-2.5 text-secondary">
          <span aria-hidden className="size-2 animate-pulse rounded-full bg-accent" />
          Reading about this song
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-secondary">No notes for this song yet: samples, where it sits in the artist’s work, and how it fits your listening.</p>
          <button type="button" className="btn btn-secondary self-start" onClick={() => write.mutate()}>
            Generate
          </button>
          {write.isError && (
            <p role="alert" className="text-danger">
              {assistantProblem(write.error)}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
