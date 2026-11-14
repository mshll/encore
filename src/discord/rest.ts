import type { CommandDefinition, Message } from "./types";

const apiUrl = "https://discord.com/api/v10";

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`Discord API ${status}: ${message}`);
  }
}

export class DiscordRest {
  constructor(
    private readonly applicationId: string,
    private readonly botToken: string | undefined,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  postMessage(channelId: string, message: Message) {
    return this.send<{ id: string }>("POST", `/channels/${channelId}/messages`, safe(message), true);
  }

  editMessage(channelId: string, messageId: string, message: Message) {
    return this.send<{ id: string }>("PATCH", `/channels/${channelId}/messages/${messageId}`, safe(message), true);
  }

  editOriginal(interactionToken: string, message: Message) {
    return this.send<{ id: string }>("PATCH", `/webhooks/${this.applicationId}/${interactionToken}/messages/@original`, safe(message), false);
  }

  registerGuildCommands(guildId: string, commands: CommandDefinition[]) {
    return this.send<{ id: string; name: string }[]>("PUT", `/applications/${this.applicationId}/guilds/${guildId}/commands`, commands, true);
  }

  listGuildCommands(guildId: string) {
    return this.send<{ id: string; name: string; description: string }[]>("GET", `/applications/${this.applicationId}/guilds/${guildId}/commands`, undefined, true);
  }

  private async send<T>(method: string, path: string, body: unknown, bot: boolean): Promise<T> {
    if (bot && !this.botToken) throw new DiscordApiError(0, "DISCORD_BOT_TOKEN is not set");
    const headers: Record<string, string> = { "user-agent": "DiscordBot (encore, 1)" };
    if (bot) headers.authorization = `Bot ${this.botToken}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await this.fetchFn(`${apiUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new DiscordApiError(res.status, text.slice(0, 300));
    return (text ? JSON.parse(text) : null) as T;
  }
}

export function safe(message: Message): Message {
  return { ...message, allowed_mentions: { parse: [] } };
}
