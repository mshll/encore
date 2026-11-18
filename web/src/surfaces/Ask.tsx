import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Redirect, useLocation } from "wouter";
import { request } from "../api/client";
import { useAskThread, useLifetime } from "../api/queries";
import { Chat } from "../chat/Chat";
import { ChatPanel } from "../chat/ChatPanel";
import { HistoryList } from "../chat/parts/History";
import { sameThread, useChat, type ChatThread } from "../chat/state";
import { useAi } from "../lib/ai";
import { assistantProblem } from "../lib/assistant";
import { useMedia } from "../lib/useMedia";
import { showToast } from "../lib/toast";
import { AppLink } from "../ui/AppLink";
import { buttonClass } from "../ui/Button";
import { Confirm } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { PlusIcon, WaveformIcon } from "../ui/icons";
import { Page, PageHeader, type HeaderAction } from "../ui/Page";
import { FirstUseState } from "../ui/States";

const askPath = (thread: ChatThread) => (thread.kind === "ask" ? `/ask/${thread.id}` : "/ask");

function useDeleteThread(id: number | null) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (id === null) return;
    setBusy(true);
    try {
      await request(`/api/ask/threads/${id}`, { method: "DELETE" });
      queryClient.removeQueries({ queryKey: ["ask", "threads", id] });
      await queryClient.invalidateQueries({ queryKey: ["ask", "threads"], exact: true });
      navigate("/ask");
    } catch (error) {
      showToast(assistantProblem(error), "problem");
    } finally {
      setBusy(false);
    }
  };
  return { busy, remove };
}

/**
 * Ask in full width: the chat panel's frame with every question beside it (on a phone, under the empty conversation).
 * The panel's Expand opens it here; Open in panel goes back to the page it came from with the panel open.
 */
export function Ask({ id }: { id?: string }) {
  const threadId = id ? Number(id) : null;
  const wanted: ChatThread | null = threadId ? { kind: "ask", id: threadId } : null;
  const chat = useChat();
  const { show } = chat;
  const wide = useMedia("(min-width: 1024px)");
  const lifetime = useLifetime();
  const thread = useAskThread(threadId);
  const [confirm, setConfirm] = useState(false);
  const del = useDeleteThread(threadId);
  const ai = useAi();

  useEffect(() => {
    show({ thread: threadId ? { kind: "ask", id: threadId } : null, mode: "ask", open: false });
  }, [threadId, show]);
  const synced = sameThread(chat.thread, wanted) && chat.mode === "ask";

  if (ai.known && !ai.configured) return <Redirect to="/" replace />;

  const firstUse = lifetime.data !== undefined && !lifetime.data.firstPlayed;
  if (firstUse)
    return (
      <Page>
        <PageHeader title="Ask" />
        <FirstUseState icon={WaveformIcon} description="Answers come from your history. Import it or connect Spotify first." />
      </Page>
    );

  const secondary: HeaderAction[] = threadId !== null && thread.data ? [{ label: "Delete question", danger: true, onClick: () => setConfirm(true) }] : [];
  const header = (
    <PageHeader
      title="Ask"
      secondary={secondary}
      actions={
        threadId !== null && (
          <AppLink to="/ask" className={buttonClass()}>
            <Icon icon={PlusIcon} />
            New question
          </AppLink>
        )
      }
    />
  );
  const list = (
    <nav aria-label="Your questions" className="flex min-w-0 flex-col gap-2">
      <h2 className={wide ? "text-caption text-secondary" : "text-heading font-medium"}>Your questions</h2>
      <div className="-mx-2">
        <HistoryList mode="ask" active={wanted} hrefFor={askPath} />
      </div>
    </nav>
  );
  const crumb = threadId === null ? undefined : (thread.data?.title ?? (thread.isError ? null : undefined));

  const confirmDelete = (
    <Confirm open={confirm} onOpenChange={setConfirm} title={`Delete “${thread.data?.title ?? ""}”?`} action="Delete" danger busy={del.busy} onConfirm={() => void del.remove().then(() => setConfirm(false))}>
      The question and its answers are deleted.
    </Confirm>
  );

  if (wide)
    return (
      <div className="grid h-full grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <Page crumb={crumb} fill className="overflow-y-auto overscroll-contain pb-8">
          {header}
          {list}
        </Page>
        {synced && <ChatPanel place="pane" />}
        {confirmDelete}
      </div>
    );

  return (
    <Page crumb={crumb} fill>
      {header}
      <div className="flex min-h-0 flex-1 flex-col">{synced && <Chat variant="page" empty={<div className="mb-8">{list}</div>} />}</div>
      {confirmDelete}
    </Page>
  );
}
