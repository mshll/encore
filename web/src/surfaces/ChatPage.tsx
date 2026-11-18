import { useEffect } from "react";
import { Redirect } from "wouter";
import { useConversation, useLifetime } from "../api/queries";
import { Chat, SubjectChip, useSubject } from "../chat/Chat";
import { ChatPanel } from "../chat/ChatPanel";
import { HistoryList } from "../chat/parts/History";
import { useChat } from "../chat/state";
import { useAi } from "../lib/ai";
import { useMedia } from "../lib/useMedia";
import { AppLink } from "../ui/AppLink";
import { buttonClass } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { PlusIcon, WaveformIcon } from "../ui/icons";
import { Page, PageHeader } from "../ui/Page";
import { FirstUseState } from "../ui/States";

const chatPath = (id: number) => `/chat/${id}`;

/**
 * A conversation at full width, with every conversation beside it so answers and charts get room. The panel's Expand
 * opens it here; Collapse goes back to the page it came from with the panel open.
 */
export function ChatPage({ id }: { id?: string }) {
  const conversationId = id ? Number(id) : null;
  const chat = useChat();
  const { show } = chat;
  const wide = useMedia("(min-width: 1024px)");
  const lifetime = useLifetime();
  const conversation = useConversation(conversationId);
  const ai = useAi();
  const subject = useSubject();

  useEffect(() => {
    show({ conversation: conversationId, open: false });
  }, [conversationId, show]);
  const synced = chat.conversation === conversationId;

  if (ai.known && !ai.configured) return <Redirect to="/" replace />;

  if (lifetime.data !== undefined && !lifetime.data.firstPlayed)
    return (
      <Page>
        <PageHeader title="Chat" />
        <FirstUseState icon={WaveformIcon} description="Answers come from your history. Import it or connect Spotify first." />
      </Page>
    );

  const header = (
    <PageHeader
      title="Chat"
      actions={
        conversationId !== null && (
          <AppLink to="/chat" className={buttonClass()}>
            <Icon icon={PlusIcon} />
            New chat
          </AppLink>
        )
      }
    />
  );
  const list = (
    <nav aria-label="Your conversations" className="-mx-2 flex min-w-0 flex-col">
      <HistoryList hrefFor={chatPath} />
    </nav>
  );
  const crumb = conversationId === null ? undefined : (conversation.data?.title ?? (conversation.isError ? null : undefined));

  if (wide)
    return (
      <div className="grid h-full grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <Page crumb={crumb} fill className="overflow-y-auto overscroll-contain pb-8">
          {header}
          {list}
        </Page>
        {synced && <ChatPanel place="pane" />}
      </div>
    );

  return (
    <Page crumb={crumb} fill>
      {header}
      {subject && synced && (
        <div className="-mx-2 -mt-4 mb-2">
          <SubjectChip subject={subject} />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">{synced && <Chat variant="page" empty={<div className="mb-8">{list}</div>} />}</div>
    </Page>
  );
}
