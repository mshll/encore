import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { request } from "../../api/client";
import { useShares, useTimezone } from "../../api/queries";
import type { Digest, ShareLink } from "../../api/types";
import { assistantProblem } from "../../lib/assistant";
import { fmtDate } from "../../lib/format";
import { showToast } from "../../lib/toast";
import { Button, buttonClass } from "../../ui/Button";
import { CopyField } from "../../ui/CopyField";
import { Confirm, Dialog, DialogClose } from "../../ui/Dialog";
import { Select } from "../../ui/Select";
import { Skeleton } from "../../ui/Skeleton";

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

/** The recap's card to download, and public links to a frozen copy of the page: made, listed and revoked here. */
export function ShareRecap({ recap }: { recap: Digest }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [expiry, setExpiry] = useState<Expiry>("never");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ShareLink | null>(null);
  const links = useShares(recap.id);
  const active = links.data?.items.filter((l) => l.status === "active") ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["shares", recap.id] });

  const make = async () => {
    setBusy(true);
    try {
      const res = await request<{ url: string }>("/api/shares", { json: { kind: "recap", ref: recap.id, expiresInDays: expiry === "never" ? null : Number(expiry) } });
      setMade(res.url);
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
  const card = `/api/digests/${recap.id}/card`;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Share
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setMade(null);
        }}
        title={`Share ${recap.label}`}
        width={560}
        footer={<DialogClose render={<Button variant="ghost">Done</Button>} />}
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <img src={card} alt={`Share card: ${recap.page.headline}`} width={1200} height={630} className="aspect-[1200/630] h-auto w-full rounded-md bg-sunken" />
            <div className="flex flex-wrap gap-2">
              <a className={buttonClass({ size: "sm" })} href={card} download>
                Download card
              </a>
              <a className={buttonClass({ size: "sm", variant: "ghost" })} href={`${card}?format=square`} download>
                Download square
              </a>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="font-medium">Public link</h3>
            {made ? (
              <div className="flex flex-col gap-2">
                <CopyField value={made} label="Copy link" />
                <p className="text-secondary text-pretty">Copy it now: encore shows it only this once.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-secondary text-pretty">Anyone with the link sees this recap as it is today, without your name or account.</p>
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
          </div>
        </div>
      </Dialog>
      <Confirm open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)} title="Revoke this link?" action="Revoke" danger onConfirm={() => revoking && void revoke(revoking)}>
        Anyone who opens it from now on finds nothing.
      </Confirm>
    </>
  );
}
