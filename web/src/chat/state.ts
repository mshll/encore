import { createContext, useContext, type RefObject } from "react";
import type { PageContext } from "../api/types";
import type { ClaudeGate } from "../ui/ClaudeNotice";
import type { RunState } from "../lib/useRun";

/** The three jobs of the one chat: answer a question, make a set, clean up the library. */
export type ChatMode = "ask" | "set" | "tidy";

/** A stored conversation: an Ask thread, a set's conversation, or a library planning conversation. */
export type ChatThread = { kind: "ask"; id: number } | { kind: "set"; id: number } | { kind: "plan"; threadId: number };

export const modeOf = (thread: ChatThread): ChatMode => (thread.kind === "ask" ? "ask" : thread.kind === "set" ? "set" : "tidy");

export const threadKey = (thread: ChatThread | null) => (thread ? `${thread.kind}:${thread.kind === "plan" ? thread.threadId : thread.id}` : "new");

export const sameThread = (a: ChatThread | null, b: ChatThread | null) => threadKey(a) === threadKey(b);

export type ShowOptions = {
  /** Open this conversation; null starts a new one. Leave out to keep the current one. */
  thread?: ChatThread | null;
  /** The job of a new conversation. */
  mode?: ChatMode;
  /** Sent as the owner's message once shown: the owner already pressed send (Home, the palette). */
  send?: string;
  /** Open the panel (default). False only selects the conversation (the Ask page shows it itself). */
  open?: boolean;
};

export type Chat = {
  open: boolean;
  mode: ChatMode;
  thread: ChatThread | null;
  /** The page the next message is about, unless the owner removed it. */
  context: PageContext | null;
  removeContext: () => void;
  draft: string;
  setDraft: (text: string) => void;
  /** The message on its way, shown as the owner's turn until the thread holds it. */
  pending: string | null;
  stopped: boolean;
  /** The steps of the run that wrote the newest turn of `thread`, folded away under it. */
  finished: { thread: string; steps: string[]; seconds: number | null } | null;
  run: RunState;
  gate: ClaudeGate;
  composer: RefObject<HTMLTextAreaElement | null>;
  show: (options?: ShowOptions) => void;
  setMode: (mode: ChatMode) => void;
  send: (text: string) => void;
  stop: () => void;
  close: () => void;
  toggle: () => void;
  /** Follows a link out of the conversation: on a phone the sheet closes so the page shows. */
  leave: () => void;
  /** Ask in full width (`/ask`), and back to the page it came from with the panel open. */
  expand: () => void;
  collapse: () => void;
  /** True while a run for this conversation is going. */
  runningFor: (thread: ChatThread) => boolean;
};

export const ChatContext = createContext<Chat | null>(null);

export function useChat(): Chat {
  const chat = useContext(ChatContext);
  if (!chat) throw new Error("useChat outside ChatProvider");
  return chat;
}
