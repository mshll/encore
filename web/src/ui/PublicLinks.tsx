import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { request } from "../api/client";
import { shareKey, useShares, useTimezone, type ShareTarget } from "../api/queries";
import type { ShareLink } from "../api/types";
import { assistantProblem } from "../lib/assistant";
import { fmtDate } from "../lib/format";
import { showToast } from "../lib/toast";
import { Button } from "./Button";
import { CopyField } from "./CopyField";
import { Confirm } from "./Dialog";
import { Select } from "./Select";
import { Skeleton } from "./Skeleton";

type Expiry = "never" | "7" | "30";
const EXPIRY: { value: Expiry; label: string }[] = [
  { value: "never", label: "Never expires" },
  { value: "7", label: "Expires in 7 days" },
  { value: "30", label: "Expires in 30 days" },
];

const views = (n: number) => `${n} ${n === 1 ? "view" : "views"}`;

function LinkRow({ link, onRevoke }: { link: ShareLink; onRevoke: () => void }) {
  const timezone = useTimezone();
  return (
    <li className="flex min-h-(--row-h-compact) items-center justify-between gap-3">
      <span className="min-w-0 text-pretty">
        Made {fmtDate(link.createdAt, timezone)} · {views(link.views)}
        {link.expiresAt && <span className="text-secondary"> · ends {fmtDate(link.expiresAt, timezone)}</span>}
      </span>
      <Button size="sm" variant="ghost" onClick={onRevoke}>
        Revoke
      </Button>
    </li>
  );
}

/**
 * Public links to a frozen copy of a recap or an answer: made (the URL shown once), listed and revoked. `made` is
 * owned by the caller so closing its dialog can clear it.
 */
export function PublicLinks({ target, description, made, onMade }: { target: ShareTarget; description: string; made: string | null; onMade: (url: string) => void }) {
  const queryClient = useQueryClient();
  const [expiry, setExpiry] = useState<Expiry>("never");
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<ShareLink | null>(null);
  const links = useShares(target);
  const active = links.data?.items.filter((l) => l.status === "active") ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: shareKey(target) });

  const make = async () => {
    setBusy(true);
    try {
      const res = await request<{ url: string }>("/api/shares", {
        json: {
          ...target,
          expiresInDays: expiry === "never" ? null : Number(expiry),
        },
      });
      onMade(res.url);
      await refresh();
    } catch (error) {
      showToast(assistantProblem(error), "problem");
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (link: ShareLink) => {
    try {
      await request(`/api/shares/${link.id}`, { method: "DELETE" });
      await refresh();
      showToast("Link revoked.");
    } catch (error) {
      showToast(assistantProblem(error), "problem");
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-medium">Public link</h3>
      {made ? (
        <div className="flex flex-col gap-2">
          <CopyField value={made} label="Copy link" />
          <p className="text-secondary text-pretty">Copy it now: encore shows it only this once.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-secondary text-pretty">{description}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Select label="Link expiry" value={expiry} onChange={setExpiry} options={EXPIRY} />
            <Button variant="primary" busy={busy} busyLabel="Making" onClick={() => void make()}>
              Make link
            </Button>
          </div>
        </div>
      )}
      {links.isLoading ? (
        <Skeleton className="h-4 w-48" />
      ) : (
        active.length > 0 && (
          <ul aria-label="Active links" className="flex flex-col">
            {active.map((l) => (
              <LinkRow key={l.id} link={l} onRevoke={() => setRevoking(l)} />
            ))}
          </ul>
        )
      )}
      <Confirm
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke this link?"
        action="Revoke"
        danger
        onConfirm={() => revoking && void revoke(revoking)}
      >
        Anyone who opens it from now on finds nothing.
      </Confirm>
    </div>
  );
}
