import { useState } from "react";
import { Button } from "../ui/Button";
import { Dialog, DialogClose } from "../ui/Dialog";
import { MenuItem, MenuLinkItem, MenuPopup, MenuRoot, MenuSeparator, MoreTrigger } from "../ui/Menu";
import { PublicLinks } from "../ui/PublicLinks";

/** The share menu on a stored answer: its card to download, wide or square, and public links to a frozen copy. */
export function ShareAnswer({ threadId, turn }: { threadId: number; turn: number }) {
  const [open, setOpen] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const card = `/api/ask/threads/${threadId}/turns/${turn}/card`;

  return (
    <>
      <MenuRoot>
        <MoreTrigger label="Share this answer" />
        <MenuPopup>
          <MenuLinkItem href={card} download>
            Download card
          </MenuLinkItem>
          <MenuLinkItem href={`${card}?format=square`} download>
            Download square card
          </MenuLinkItem>
          <MenuSeparator />
          <MenuItem onClick={() => setOpen(true)}>Public link…</MenuItem>
        </MenuPopup>
      </MenuRoot>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setMade(null);
        }}
        title="Share this answer"
        width={560}
        footer={<DialogClose render={<Button variant="ghost">Done</Button>} />}
      >
        <div className="flex flex-col gap-6">
          {open && <img src={card} alt="Share card of this answer" width={1200} height={630} className="aspect-[1200/630] h-auto w-full rounded-md bg-sunken" />}
          <PublicLinks
            target={{ kind: "answer", ref: threadId, turn }}
            description="Anyone with the link sees your question and this answer as they are today, without your name or account."
            made={made}
            onMade={setMade}
          />
        </div>
      </Dialog>
    </>
  );
}
