import type { DiscordConfig } from "../config";
import { NoActiveDeviceError, PremiumRequiredError } from "../player/api";
import { SpotifyApiError, SpotifyBlockedError, SpotifyNotConnectedError } from "../spotify/errors";
import type { DiscordContext, DiscordRegistry } from "./registry";
import type { DiscordRest } from "./rest";
import { EPHEMERAL, InteractionType, ResponseType, type Interaction, type Message } from "./types";

export type InteractionReply = { type: number; data?: Message };

export class UserFacingError extends Error {}

const ephemeral = (content: string): InteractionReply => ({ type: ResponseType.Message, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } });

const clock = (ts: number, timezone: string) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(ts);

export function errorMessage(error: unknown, timezone: string): string {
  if (error instanceof UserFacingError) return error.message;
  if (error instanceof NoActiveDeviceError) return "No active Spotify device. Start playback on a device first.";
  if (error instanceof PremiumRequiredError) return "Playback control needs Spotify Premium.";
  if (error instanceof SpotifyNotConnectedError) return "Spotify is not connected.";
  if (error instanceof SpotifyBlockedError) return `Spotify calls are paused until ${clock(error.blockedUntil, timezone)}.`;
  if (error instanceof SpotifyApiError) return "Spotify returned an error. Try again.";
  return "Something went wrong.";
}

export class InteractionHandler {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly registry: DiscordRegistry,
    private readonly ctx: DiscordContext,
    private readonly config: DiscordConfig,
    private readonly rest: DiscordRest,
  ) {}

  async handle(interaction: Interaction): Promise<InteractionReply> {
    if (interaction.type === InteractionType.Ping) return { type: ResponseType.Pong };
    const userId = interaction.member?.user?.id ?? interaction.user?.id;
    if (userId !== this.config.ownerId) return ephemeral("Only the owner can use this bot.");
    if (interaction.type === InteractionType.Command) {
      const spec = this.registry.command(interaction.data?.name ?? "");
      if (!spec) return ephemeral("Unknown command.");
      const options = Object.fromEntries((interaction.data?.options ?? []).map((o) => [o.name, o.value]));
      return this.run(interaction, spec, () => spec.handle({ ctx: this.ctx, interaction, options }));
    }
    if (interaction.type === InteractionType.Component) {
      const match = this.registry.component(interaction.data?.custom_id ?? "");
      if (!match) return ephemeral("This button no longer works.");
      return this.run(interaction, match.spec, () => match.spec.handle({ ctx: this.ctx, interaction, arg: match.arg }));
    }
    return ephemeral("Unsupported interaction.");
  }

  whenIdle(): Promise<void> {
    return Promise.all(this.pending).then(() => undefined);
  }

  private async run(interaction: Interaction, spec: { defer: boolean; ephemeral?: boolean }, work: () => Promise<Message> | Message): Promise<InteractionReply> {
    const flags = spec.ephemeral ? EPHEMERAL : undefined;
    const settle = async (): Promise<Message> => {
      try {
        return { ...(await work()), ...(flags ? { flags } : {}) };
      } catch (error) {
        if (!(error instanceof UserFacingError)) console.error(`[discord] ${interaction.data?.name ?? interaction.data?.custom_id}: ${error instanceof Error ? error.message : error}`);
        return { content: errorMessage(error, this.ctx.config.timezone), flags: EPHEMERAL };
      }
    };
    if (!spec.defer) return { type: ResponseType.Message, data: { ...(await settle()), allowed_mentions: { parse: [] } } };
    const task = settle()
      .then((message) => this.rest.editOriginal(interaction.token, message))
      .then(
        () => undefined,
        (error: unknown) => console.error(`[discord] follow-up failed: ${error instanceof Error ? error.message : error}`),
      );
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
    return { type: ResponseType.DeferredMessage, ...(flags ? { data: { flags } } : {}) };
  }
}
