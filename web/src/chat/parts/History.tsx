/*
 * The list of past conversations, adapted from the chat list in Beautiful UI's Sidebar Nav (MIT, see ./LICENSE):
 * one compact row per conversation, its title truncated, the open one filled.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { request } from "../../api/client";
import { useConversations } from "../../api/queries";
import type { ChatListItem, ChatOutcomeKind } from "../../api/types";
import { assistantProblem } from "../../lib/assistant";
import { fmtAgo } from "../../lib/format";
import { showToast } from "../../lib/toast";
import { AppLink } from "../../ui/AppLink";
import { Button } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { Confirm, Dialog } from "../../ui/Dialog";
import { Input } from "../../ui/Field";
import { Icon } from "../../ui/Icon";
import { BroomIcon, ChatCircleTextIcon, ListBulletsIcon, PlayIcon, PlaylistIcon, type IconGlyph } from "../../ui/icons";
import { MenuItem, MenuPopup, MenuRoot, MoreTrigger } from "../../ui/Menu";
import { RowSkeleton } from "../../ui/Rows";
import { SearchField } from "../../ui/SearchField";
import { ErrorState } from "../../ui/States";
import { groupHistory } from "../history";
import { useChat } from "../state";

/** What a conversation made last, as the glyph its row starts with. */
const PRODUCED: Record<ChatOutcomeKind, { icon: IconGlyph; label: string }> = {
  answer: { icon: ChatCircleTextIcon, label: "Answer" },
  set: { icon: PlaylistIcon, label: "Set" },
  plan: { icon: BroomIcon, label: "Cleanup plan" },
  rule: { icon: ListBulletsIcon, label: "Playlist rule" },
  play: { icon: PlayIcon, label: "Songs to play" },
};

const ROW = "press flex min-h-8 min-w-0 flex-1 items-center gap-2.5 rounded-md py-1.5 pr-9 pl-2 text-left transition-colors duration-150 can-hover:pr-2 phone:min-h-11";

/** With a mouse the menu takes the time's place while the row is hovered or focused; on touch it always shows. */
const HIDE_ON_HOVER = "transition-opacity duration-150 can-hover:group-hover:opacity-0 can-hover:group-focus-within:opacity-0 can-hover:group-has-[[data-open]]:opacity-0";
const SHOW_ON_HOVER = "transition-opacity duration-150 can-hover:opacity-0 can-hover:group-hover:opacity-100 can-hover:group-focus-within:opacity-100 can-hover:group-has-[[data-open]]:opacity-100";

function Rename({ item, onClose }: { item: ChatListItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(item.title);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await request(`/api/chat/${item.id}`, { method: "PATCH", json: { title: title.trim() } });
      await queryClient.invalidateQueries({ queryKey: ["chat"] });
      onClose();
    } catch (error) {
      showToast(assistantProblem(error), "problem");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Rename conversation"
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} busyLabel="Saving" disabled={!title.trim()} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input aria-label="Name" value={title} maxLength={120} autoFocus enterKeyHint="done" onChange={(e) => setTitle(e.target.value)} />
      </form>
    </Dialog>
  );
}

function Delete({ item, onClose }: { item: ChatListItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const chat = useChat();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await request(`/api/chat/${item.id}`, { method: "DELETE" });
      queryClient.removeQueries({ queryKey: ["chat", "conversation", item.id] });
      await queryClient.invalidateQueries({ queryKey: ["chat", "list"] });
      if (chat.conversation === item.id) chat.show({ conversation: null, open: false });
      onClose();
    } catch (error) {
      showToast(assistantProblem(error), "problem");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Confirm open onOpenChange={(open) => !open && onClose()} title={`Delete “${item.title}”?`} action="Delete" danger busy={busy} onConfirm={() => void remove()}>
      Its answers go with it. Sets, plans and playlists it made stay.
    </Confirm>
  );
}

/**
 * Every conversation, newest first, grouped by when it last changed, with search. A row opens the conversation (in the
 * panel) or links to it (on the full page); its menu renames or deletes it.
 */
export function HistoryList({ onPick, hrefFor }: { onPick?: (id: number) => void; hrefFor?: (id: number) => string }) {
  const chat = useChat();
  const [q, setQ] = useState("");
  const list = useConversations(q);
  const [acting, setActing] = useState<{ item: ChatListItem; what: "rename" | "delete" } | null>(null);
  const items = list.data?.items;
  const body = (() => {
    if (list.isError) return <ErrorState size="inline" error={list.error} onRetry={() => void list.refetch()} title="Could not load your conversations" />;
    if (!items) return <RowSkeleton rows={4} />;
    if (items.length === 0) return <p className="px-2 text-secondary">{q ? `Nothing matches “${q}”.` : "Conversations you have stay here."}</p>;
    return groupHistory(items, new Date()).map(({ group, items: rows }) => (
      <section key={group} aria-label={group} className="flex flex-col gap-px">
        <h3 className="px-2 pt-2 pb-1 text-caption text-secondary">{group}</h3>
        <ul className="flex flex-col gap-px">
          {rows.map((item) => {
            const current = item.id === chat.conversation;
            const produced = item.produced ? PRODUCED[item.produced] : null;
            const className = cx(ROW, current ? "bg-fill-active text-primary" : "text-secondary hover:bg-fill hover:text-primary");
            const content = (
              <>
                {produced ? <Icon icon={produced.icon} className="text-tertiary" /> : <span aria-hidden className="size-4 shrink-0" />}
                <span className="min-w-0 flex-1 truncate font-medium" title={item.title}>
                  {produced && <span className="sr-only">{produced.label}: </span>}
                  {item.title}
                </span>
                <time dateTime={item.updatedAt} className={cx("shrink-0 text-caption text-tertiary", HIDE_ON_HOVER)}>
                  {fmtAgo(item.updatedAt)}
                </time>
              </>
            );
            return (
              <li key={item.id} className="group relative flex items-center">
                {hrefFor ? (
                  <AppLink to={hrefFor(item.id)} aria-current={current ? "page" : undefined} className={className}>
                    {content}
                  </AppLink>
                ) : (
                  <button type="button" aria-current={current ? "true" : undefined} onClick={() => onPick?.(item.id)} className={className}>
                    {content}
                  </button>
                )}
                <div className={cx("absolute right-0.5", SHOW_ON_HOVER)}>
                  <MenuRoot>
                    <MoreTrigger label={`More for ${item.title}`} />
                    <MenuPopup>
                      <MenuItem onClick={() => setActing({ item, what: "rename" })}>Rename</MenuItem>
                      <MenuItem danger onClick={() => setActing({ item, what: "delete" })}>
                        Delete
                      </MenuItem>
                    </MenuPopup>
                  </MenuRoot>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    ));
  })();
  return (
    <div className="flex flex-col gap-1">
      <div className="px-2 pb-1">
        <SearchField value={q} onChange={setQ} label="Search conversations" placeholder="Search" fill />
      </div>
      {body}
      {acting?.what === "rename" && <Rename item={acting.item} onClose={() => setActing(null)} />}
      {acting?.what === "delete" && <Delete item={acting.item} onClose={() => setActing(null)} />}
    </div>
  );
}
