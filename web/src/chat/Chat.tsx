import type { ReactNode } from "react";
import { useConversation } from "../api/queries";
import type { ChatSubject } from "../api/types";
import { contextLabel } from "../app/pageContext";
import { AppLink } from "../ui/AppLink";
import { Composer, ComposerChip } from "../ui/Composer";
import { Conversation } from "../ui/Conversation";
import { Icon } from "../ui/Icon";
import { BroomIcon, PlaylistIcon } from "../ui/icons";
import { Notice } from "../ui/Notice";
import { useMessages } from "./Messages";
import { MAKES, useStarters } from "./starters";
import { threadKey, useChat } from "./state";

const subjectPath = (s: ChatSubject) => (s.kind === "set" ? `/playlists/set-${s.id}` : `/library/plans/${s.id}`);

/** The set or plan this conversation changes, pinned over the thread. A message that asks for a change goes to it. */
export function SubjectChip({ subject }: { subject: ChatSubject }) {
  const { leave } = useChat();
  return (
    <AppLink
      to={subjectPath(subject)}
      onClick={leave}
      className="press flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 text-caption text-secondary transition-colors duration-150 hover:bg-fill hover:text-primary phone:min-h-11"
    >
      <Icon icon={subject.kind === "set" ? PlaylistIcon : BroomIcon} className="text-tertiary" />
      <span className="min-w-0 truncate">
        Changing <span className="font-medium text-primary">{subject.title}</span>
      </span>
    </AppLink>
  );
}

export function useSubject(): ChatSubject | null {
  const { conversation } = useChat();
  return useConversation(conversation).data?.subject ?? null;
}

/** Starting points while the conversation is empty, about the page first, each naming what it makes. A tap sends it: picking one is the owner's action. */
function Starters() {
  const { context, gate, send } = useChat();
  const starters = useStarters(context);
  if (gate.blocked || starters.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col">
      {starters.map((s, i) => (
        <li key={s.text} className="animate-[fade-up_350ms_var(--ease-out)_both]" style={{ animationDelay: `${i * 90}ms` }}>
          <button
            type="button"
            onClick={() => send(s.text)}
            className="press -mx-2 flex min-h-(--control-h) w-[calc(100%+16px)] flex-col items-start rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-fill"
          >
            <span className="text-pretty">{s.text}</span>
            <span className="text-caption text-secondary">{MAKES[s.makes]}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function usePrompt(subject: ChatSubject | null): { label: string; placeholder: string } {
  const { conversation } = useChat();
  if (subject) return { label: `Change ${subject.title}`, placeholder: subject.kind === "set" ? "Less sad, more like track 3, a slower start" : "Keep anything by…, only playlists, leave out…" };
  if (conversation !== null) return { label: "Message", placeholder: "Ask a follow-up, or ask for something new" };
  return { label: "Message", placeholder: "Ask anything, or describe a set, a playlist or a cleanup" };
}

/**
 * The one conversation. It has its own scroll box with the composer at the foot; in the panel it is inset off the
 * panel's edges, on the full page the page gutter does that.
 */
export function Chat({ variant, empty }: { variant: "panel" | "page"; empty?: ReactNode }) {
  const chat = useChat();
  const { conversation, draft, run, gate, pending, stopped, context } = chat;
  const messages = useMessages();
  const subject = useSubject();
  const prompt = usePrompt(subject);
  const running = Boolean(pending) || run.running;
  const composer = (
    <>
      {run.problem && !running && (
        <Notice tone="danger" onRetry={gate.blocked || !draft.trim() ? undefined : () => chat.send(draft)}>
          {run.problem}
        </Notice>
      )}
      {stopped && <p className="text-secondary">Stopped.</p>}
      <Composer
        inputRef={chat.composer}
        label={prompt.label}
        placeholder={prompt.placeholder}
        value={draft}
        onChange={chat.setDraft}
        onSubmit={() => chat.send(draft)}
        onStop={chat.stop}
        running={running}
        maxLength={2000}
        disabled={Boolean(gate.blocked)}
        notice={gate.blocked}
        chips={context && <ComposerChip label="About:" value={contextLabel(context)} onRemove={chat.removeContext} />}
        footer={conversation !== null && gate.spend && <span className="truncate pl-1">{gate.spend}</span>}
      />
    </>
  );
  return (
    <Conversation
      messages={messages}
      composer={composer}
      empty={
        <>
          {empty}
          <Starters />
        </>
      }
      follow={`${threadKey(conversation)}|${pending ?? ""}|${chat.finished?.conversation ?? ""}`}
      startAtEnd
      thread={threadKey(conversation)}
      contained
      inset={variant === "panel"}
    />
  );
}
