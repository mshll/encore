import type { ReactNode } from "react";
import { useSet, usePlanConversation } from "../api/queries";
import { contextLabel } from "../app/pageContext";
import { Composer, ComposerChip } from "../ui/Composer";
import { Conversation } from "../ui/Conversation";
import { Icon } from "../ui/Icon";
import { CaretDownIcon, CheckIcon } from "../ui/icons";
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from "../ui/Menu";
import { Notice } from "../ui/Notice";
import { useMessages } from "./Messages";
import { useStarters } from "./starters";
import { threadKey, useChat, type ChatMode } from "./state";

export const MODE_LABELS: Record<ChatMode, string> = { ask: "Ask", set: "Make a set", tidy: "Clean up" };

const NEW_PROMPT: Record<ChatMode, { label: string; placeholder: string }> = {
  ask: { label: "Ask about your listening", placeholder: "Why did I stop playing…, what do I play when…" },
  set: { label: "Describe a set", placeholder: "A late drive home, songs I finished at night, a few I’ve never heard" },
  tidy: { label: "Tell Claude what to tidy", placeholder: "Archive what I stopped playing, clear duplicates in…" },
};

/** The job of a new conversation, where Beautiful UI's Prompt Bar keeps its model picker. */
function ModePicker() {
  const { mode, setMode } = useChat();
  return (
    <MenuRoot>
      <MenuTrigger className="press -ml-0.5 flex h-7 items-center gap-1 rounded-md px-1.5 text-caption font-medium text-secondary transition-colors duration-150 hover:bg-fill hover:text-primary data-[open]:bg-fill data-[open]:text-primary phone:-my-2 phone:h-11">
        {MODE_LABELS[mode]}
        <Icon icon={CaretDownIcon} className="text-tertiary" />
      </MenuTrigger>
      <MenuPopup side="top" align="start" className="min-w-44">
        {(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => (
          <MenuItem key={m} onClick={() => setMode(m)} hint={m === mode ? <Icon icon={CheckIcon} className="text-primary" /> : undefined}>
            {MODE_LABELS[m]}
          </MenuItem>
        ))}
      </MenuPopup>
    </MenuRoot>
  );
}

/** What the composer says inside a stored conversation: a set or plan still waiting on Claude's question is answered. */
function useThreadPrompt(): { label: string; placeholder: string } {
  const { thread } = useChat();
  const set = useSet(thread?.kind === "set" ? thread.id : 0);
  const plan = usePlanConversation(thread?.kind === "plan" ? thread.threadId : 0);
  if (thread?.kind === "ask") return { label: "Ask a follow-up", placeholder: "Ask a follow-up" };
  if (thread?.kind === "set")
    return set.data?.version === 0 ? { label: "Answer", placeholder: "Your answer" } : { label: "Change the set", placeholder: "Less sad, more like track 3, a slower start" };
  if (thread?.kind === "plan")
    return plan.data && !plan.data.planId ? { label: "Answer", placeholder: "Your answer" } : { label: "Change the plan", placeholder: "Keep anything by…, only playlists, leave out…" };
  return { label: "", placeholder: "" };
}

/** Starting points while the conversation is empty, about the page first. They send at once: picking one is the user's action. */
function Starters() {
  const { mode, context, gate, send } = useChat();
  const starters = useStarters(mode, context);
  if (gate.blocked || starters.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col">
      {starters.map((s, i) => (
        <li key={s} className="animate-[fade-up_350ms_var(--ease-out)_both]" style={{ animationDelay: `${i * 90}ms` }}>
          <button
            type="button"
            onClick={() => send(s)}
            className="press -mx-2 flex min-h-(--control-h) w-[calc(100%+16px)] items-center rounded-md px-2 py-1.5 text-left text-pretty transition-colors duration-150 hover:bg-fill"
          >
            {s}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The one conversation: Ask, Make a set and Clean up are modes of the same composer. It has its own scroll box with the
 * composer at the foot; in the panel it is inset off the panel's edges, on the Ask page the page gutter does that.
 */
export function Chat({ variant, empty }: { variant: "panel" | "page"; empty?: ReactNode }) {
  const chat = useChat();
  const { thread, mode, draft, run, gate, pending, stopped, context } = chat;
  const messages = useMessages();
  const threadPrompt = useThreadPrompt();
  const prompt = thread ? threadPrompt : NEW_PROMPT[mode];
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
        maxLength={mode === "ask" ? 1000 : 2000}
        disabled={Boolean(gate.blocked)}
        notice={gate.blocked ?? (mode === "set" ? gate.warning : null)}
        chips={context && <ComposerChip label="About:" value={contextLabel(context)} onRemove={chat.removeContext} />}
        footer={thread ? gate.spend && <span className="truncate pl-1">{gate.spend}</span> : <ModePicker />}
      />
    </>
  );
  return (
    <Conversation
      messages={messages}
      composer={composer}
      empty={
        <>
          <Starters />
          {empty}
        </>
      }
      follow={`${threadKey(thread)}|${pending ?? ""}|${chat.finished?.thread ?? ""}`}
      startAtEnd
      thread={threadKey(thread)}
      contained
      inset={variant === "panel"}
    />
  );
}
