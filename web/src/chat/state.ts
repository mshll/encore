import { createContext, useContext, type RefObject } from "react";
import type { ChatSubject, PageContext } from "../api/types";
import type { ClaudeGate } from "../ui/ClaudeNotice";
import type { RunState } from "../lib/useRun";

export const threadKey = (conversation: number | null) => (conversation === null ? "new" : String(conversation));

export type ShowOptions = {
  /** Open this conversation; null starts a new one. Leave out to keep the current one. */
  conversation?: number | null;
  /** Sent as the owner's message once shown: the owner already pressed send (Home, the palette, a starter). */
  send?: string;
  /** Open the panel (default). False only selects the conversation (the full page shows it itself). */
  open?: boolean;
};

export type Chat = {
  open: boolean;
  /** The open conversation, null while it is new. */
  conversation: number | null;
  /** The page the next message is about, unless the owner removed it. */
  context: PageContext | null;
  removeContext: () => void;
  draft: string;
  setDraft: (text: string) => void;
  /** The message on its way, shown as the owner's turn until the conversation holds it. */
  pending: string | null;
  stopped: boolean;
  /** The steps of the run that wrote the newest turn of `conversation`, folded away under it. */
  finished: { conversation: string; steps: string[]; seconds: number | null } | null;
  run: RunState;
  gate: ClaudeGate;
  composer: RefObject<HTMLTextAreaElement | null>;
  show: (options?: ShowOptions) => void;
  /** Opens the conversation that changes this set or plan (made for it when it has none). */
  attach: (subject: Pick<ChatSubject, "kind" | "id">) => Promise<void>;
  send: (text: string) => void;
  stop: () => void;
  close: () => void;
  toggle: () => void;
  /** Follows a link out of the conversation: on a phone the sheet closes so the page shows. */
  leave: () => void;
  /** The conversation at full width (`/chat`), and back to the page it came from with the panel open. */
  expand: () => void;
  collapse: () => void;
  /** True while a run for this conversation is going. */
  runningFor: (conversation: number) => boolean;
};

export const ChatContext = createContext<Chat | null>(null);

export function useChat(): Chat {
  const chat = useContext(ChatContext);
  if (!chat) throw new Error("useChat outside ChatProvider");
  return chat;
}
