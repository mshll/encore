import { useState } from "react";
import type { Digest } from "../../api/types";
import { Button, buttonClass } from "../../ui/Button";
import { Dialog, DialogClose } from "../../ui/Dialog";
import { PublicLinks } from "../../ui/PublicLinks";

/** The recap's card to download, and public links to a frozen copy of the page: made, listed and revoked here. */
export function ShareRecap({ recap, open, onOpenChange }: { recap: Digest; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [made, setMade] = useState<string | null>(null);
  const card = `/api/digests/${recap.id}/card`;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
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
        <PublicLinks
          target={{ kind: "recap", ref: recap.id }}
          description="Anyone with the link sees this recap as it is today, without your name or account."
          made={made}
          onMade={setMade}
        />
      </div>
    </Dialog>
  );
}
