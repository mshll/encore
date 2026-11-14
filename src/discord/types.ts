export const InteractionType = { Ping: 1, Command: 2, Component: 3 } as const;
export const ResponseType = { Pong: 1, Message: 4, DeferredMessage: 5 } as const;
export const EPHEMERAL = 64;

export type Embed = {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  thumbnail?: { url: string };
  image?: { url: string };
  author?: { name: string };
  footer?: { text: string };
  fields?: { name: string; value: string; inline?: boolean }[];
};

export type Button = { type: 2; style: 1 | 2 | 5; label: string; custom_id?: string; url?: string };
export type ActionRow = { type: 1; components: Button[] };

export type Message = { content?: string; embeds?: Embed[]; components?: ActionRow[]; flags?: number; allowed_mentions?: { parse: string[] }; attachments?: { id: number; filename: string }[] };
/** A file sent with a message; an embed shows it with `attachment://<name>`. */
export type MessageFile = { name: string; bytes: Uint8Array; contentType: string };

export type CommandOption = { type: 3 | 4; name: string; description: string; required?: boolean; choices?: { name: string; value: string }[] };
export type CommandDefinition = { name: string; description: string; options?: CommandOption[] };

export type Interaction = {
  id: string;
  type: number;
  token: string;
  application_id: string;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: { id: string } };
  user?: { id: string };
  data?: { name?: string; options?: { name: string; value: string | number }[]; custom_id?: string };
};

const MARKDOWN = /([\\*_~`|>[\]()])/g;
const LINE_START = /^([#-])/gm;

export function plain(value: string, max = 256): string {
  const escaped = value.replace(MARKDOWN, "\\$1").replace(LINE_START, "\\$1").replace(/@/g, "@\u200b");
  return escaped.length > max ? `${escaped.slice(0, max - 1)}…` : escaped;
}

export function label(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
