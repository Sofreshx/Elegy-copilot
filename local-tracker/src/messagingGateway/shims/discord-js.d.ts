export declare enum ApplicationCommandOptionType {
  String = 3,
  Integer = 4,
  Boolean = 5
}

export declare enum ButtonStyle {
  Success = 3,
  Danger = 4
}

export declare enum ChannelType {
  GuildText = 0,
  GuildAnnouncement = 5
}

export declare enum GatewayIntentBits {
  Guilds = 1
}

export interface Message {
  id: string;
  content?: string;
  author?: { id?: string };
  edit(options: { content?: string; components?: unknown[]; allowedMentions?: unknown }): Promise<unknown>;
}

export interface ChatInputCommandInteraction {
  commandName: string;
  user: { id: string; username: string };
  guildId?: string | null;
  channelId?: string | null;
  channel?: unknown;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getInteger(name: string): number | null;
    getString(name: string, required?: boolean): string | null;
  };
  reply(options: { content: string; ephemeral?: boolean; allowedMentions?: unknown }): Promise<unknown>;
  followUp(options: { content: string; ephemeral?: boolean; allowedMentions?: unknown }): Promise<Message>;
  editReply(options: { content: string; allowedMentions?: unknown }): Promise<unknown>;
}

export interface ButtonInteraction {
  customId?: string;
  deferred?: boolean;
  replied?: boolean;
  user: { id: string; username: string };
  guildId?: string | null;
  channelId?: string | null;
  channel?: unknown;
  message: Message;
  reply(options: { content: string; ephemeral?: boolean; allowedMentions?: unknown }): Promise<unknown>;
  deferReply(options?: { ephemeral?: boolean }): Promise<unknown>;
  editReply(options: { content: string; allowedMentions?: unknown }): Promise<unknown>;
  followUp(options: { content: string; ephemeral?: boolean; allowedMentions?: unknown }): Promise<Message>;
}

export interface BaseGuildTextChannel {
  threads: {
    create(options: { name: string; autoArchiveDuration: number }): Promise<{
      id: string;
      name: string;
      send(options: { content: string; allowedMentions?: unknown }): Promise<Message>;
    }>;
  };
}

export declare class ActionRowBuilder<T = unknown> {
  addComponents(...components: T[]): this;
}

export declare class ButtonBuilder {
  setCustomId(customId: string): this;
  setLabel(label: string): this;
  setStyle(style: ButtonStyle): this;
}

export declare class REST {
  constructor(options?: { version?: string });
  setToken(token: string): this;
  put(route: string, options: { body?: unknown }): Promise<unknown>;
}

export declare const Routes: {
  applicationGuildCommands(appId: string, guildId: string): string;
};

export declare class Client {
  constructor(options?: { intents?: unknown[] });
  user?: { id?: string; tag?: string };
  application?: { id?: string };
  channels: {
    fetch(channelId: string): Promise<any>;
  };
  on(event: string, listener: (...args: unknown[]) => void): this;
  once(event: string, listener: (...args: unknown[]) => void): this;
  login(token: string): Promise<unknown>;
  isReady(): boolean;
  destroy(): Promise<void>;
}
