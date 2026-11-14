import type { Config } from "../config";
import type { Db } from "../db/client";
import type { SettingsSource } from "../settings/settings";
import type { Services } from "../services";
import type { CommandDefinition, Interaction, Message } from "./types";

export type DiscordContext = { db: Db; config: Config; settings: SettingsSource; services: Services; now: () => number };

export type CommandCall = { ctx: DiscordContext; interaction: Interaction; options: Record<string, string | number | undefined> };
export type ComponentCall = { ctx: DiscordContext; interaction: Interaction; arg: string };

export type CommandSpec = {
  definition: CommandDefinition;
  defer: boolean;
  ephemeral?: boolean;
  handle: (call: CommandCall) => Promise<Message> | Message;
};

export type ComponentSpec = {
  prefix: string;
  defer: boolean;
  ephemeral?: boolean;
  handle: (call: ComponentCall) => Promise<Message> | Message;
};

export class DiscordRegistry {
  private readonly commands = new Map<string, CommandSpec>();
  private readonly components = new Map<string, ComponentSpec>();

  addCommand(spec: CommandSpec): this {
    if (this.commands.has(spec.definition.name)) throw new Error(`Discord command /${spec.definition.name} is already registered`);
    this.commands.set(spec.definition.name, spec);
    return this;
  }

  addComponent(spec: ComponentSpec): this {
    if (spec.prefix.includes(":") || this.components.has(spec.prefix)) throw new Error(`Invalid or duplicate component prefix ${spec.prefix}`);
    this.components.set(spec.prefix, spec);
    return this;
  }

  command(name: string): CommandSpec | undefined {
    return this.commands.get(name);
  }

  component(customId: string): { spec: ComponentSpec; arg: string } | undefined {
    const at = customId.indexOf(":");
    const spec = this.components.get(at < 0 ? customId : customId.slice(0, at));
    return spec && { spec, arg: at < 0 ? "" : customId.slice(at + 1) };
  }

  definitions(): CommandDefinition[] {
    return [...this.commands.values()].map((c) => c.definition);
  }
}

export const customId = (prefix: string, arg: string) => `${prefix}:${arg}`;
