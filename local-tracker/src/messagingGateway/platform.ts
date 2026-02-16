export type PlatformKind = 'discord';

export type CommandTier = 'read' | 'invoke' | 'admin';

export type PlatformCommandOptionType = 'string' | 'integer' | 'boolean';

export interface PlatformCommandOptionSpec {
	name: string;
	description: string;
	type: PlatformCommandOptionType;
	required?: boolean;
}

export interface PlatformCommandSpec {
	/** Slash-command style name, including leading slash (e.g. `/status`). */
	name: string;
	description: string;
	tier: CommandTier;
	options?: PlatformCommandOptionSpec[];
}

export interface PlatformScopeContext {
	userId: string;
	userDisplayName?: string;
	guildId?: string;
	channelId?: string;
}

export interface PlatformMessageHandle {
	edit: (content: string) => Promise<void>;
}

export interface PlatformThreadHandle {
	id: string;
	name: string;
	sendMessage: (content: string) => Promise<PlatformMessageHandle>;
}

export interface PlatformCommandInteraction {
	platform: PlatformKind;
	command: string;
	args: unknown;
	context: PlatformScopeContext;

	/**
	 * Sends the first response for the interaction and returns a handle that can be edited.
	 * This is intended to support later streaming/edit strategies.
	 */
	replyInitial: (content: string, options?: { ephemeral?: boolean }) => Promise<PlatformMessageHandle>;

	/** Sends a non-ephemeral message in the interaction channel. */
	sendMessage: (content: string) => Promise<PlatformMessageHandle>;

	/** Creates a thread under the configured channel (guild-only). */
	createThread: (name: string) => Promise<PlatformThreadHandle>;
}

export type PlatformCommandHandler = (interaction: PlatformCommandInteraction) => void | Promise<void>;

export interface MessagePlatform {
	kind: PlatformKind;
	start: () => Promise<void>;
	stop: () => Promise<void>;
	registerCommands: (commands: ReadonlyArray<PlatformCommandSpec>) => Promise<void>;
	setCommandHandler: (handler: PlatformCommandHandler) => void;
}
