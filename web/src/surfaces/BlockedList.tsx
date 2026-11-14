import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { request } from "../api/client";
import { useBlocks } from "../api/queries";
import type { Block } from "../api/types";
import { showToast } from "../lib/toast";
import { Button } from "../ui/Button";
import { Section } from "../ui/Page";
import { describeError } from "../ui/States";

/** Artists and songs kept out of picks and sets, each with Allow. Nothing renders while the list is empty. */
export function BlockedList(): ReactNode {
  const q = useBlocks();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<number | null>(null);
  const allow = async (b: Block) => {
    setPending(b.id);
    try {
      await request(`/api/blocks/${b.id}`, { method: "DELETE" });
      showToast(`${b.label} can be picked again`);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["blocks"] }), queryClient.invalidateQueries({ queryKey: ["picks"] })]);
    } catch (error) {
      showToast(describeError(error), "problem");
    } finally {
      setPending(null);
    }
  };
  if (!q.data || q.data.items.length === 0) return null;
  return (
    <Section title="Kept out of picks and sets">
      <ul className="flex flex-col">
        {q.data.items.map((b) => (
          <li key={b.id} className="flex min-h-(--row-h) items-center justify-between gap-3">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-primary" title={b.label}>
                {b.label}
              </span>
              <span className="truncate text-caption text-secondary">{b.kind === "artist" ? "Artist" : "Song"}</span>
            </span>
            <Button size="sm" variant="ghost" busy={pending === b.id} busyLabel="Allowing" onClick={() => void allow(b)}>
              Allow
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
