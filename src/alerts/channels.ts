import { postToChannel, type DiscordSource } from "../discord";
import { DiscordApiError } from "../discord/rest";
import type { AlertsConfig } from "../settings/settings";

export type Alert = { title: string; body: string; kind: "incident" | "recovery" | "test" };

export const CHANNEL_NAMES = ["ntfy", "discord_webhook", "discord_channel"] as const;
export type ChannelName = (typeof CHANNEL_NAMES)[number];

export type AlertChannel = { name: ChannelName; send(alert: Alert): Promise<void> };

/** A channel failure in words that never echo a URL, topic or token. */
export class ChannelError extends Error {}

const TAGS: Record<Alert["kind"], string> = { incident: "warning", recovery: "white_check_mark", test: "bell" };
const DISCORD_LIMIT = 1900;

async function deliver(name: string, send: () => Promise<Response>) {
  let res: Response;
  try {
    res = await send();
  } catch {
    throw new ChannelError(`${name} could not be reached`);
  }
  if (!res.ok) throw new ChannelError(`${name} answered ${res.status}`);
}

const discordText = (alert: Alert) => `**${alert.title}**\n${alert.body}`.slice(0, DISCORD_LIMIT);

/** The channels the current settings turn on. */
export function alertChannels(config: AlertsConfig, discord: DiscordSource, fetchFn: typeof fetch = fetch): AlertChannel[] {
  const channels: AlertChannel[] = [];
  const { ntfy, discordWebhookUrl } = config;
  if (ntfy)
    channels.push({
      name: "ntfy",
      send: (alert) =>
        deliver("ntfy", () =>
          fetchFn(`${ntfy.url}/${encodeURIComponent(ntfy.topic)}`, {
            method: "POST",
            headers: {
              title: alert.title,
              tags: TAGS[alert.kind],
              priority: alert.kind === "incident" ? "high" : "default",
              ...(ntfy.token ? { authorization: `Bearer ${ntfy.token}` } : {}),
            },
            body: alert.body,
          }),
        ),
    });
  if (discordWebhookUrl)
    channels.push({
      name: "discord_webhook",
      send: (alert) =>
        deliver("Discord webhook", () =>
          fetchFn(discordWebhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ content: discordText(alert), allowed_mentions: { parse: [] } }),
          }),
        ),
    });
  if (config.discordChannel)
    channels.push({
      name: "discord_channel",
      send: async (alert) => {
        const current = discord.current();
        if (!current?.config.botToken || !current.config.channelId) throw new ChannelError("Discord channel needs the bot token and channel ID");
        try {
          await postToChannel(current, { content: discordText(alert), allowed_mentions: { parse: [] } });
        } catch (error) {
          if (error instanceof DiscordApiError) throw new ChannelError(`Discord channel answered ${error.status}`);
          throw new ChannelError("Discord channel could not be reached");
        }
      },
    });
  return channels;
}
