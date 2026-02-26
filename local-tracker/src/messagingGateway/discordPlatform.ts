import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	Client,
	GatewayIntentBits,
	REST,
	Routes,
	type BaseGuildTextChannel,
	type ButtonInteraction,
	type ChatInputCommandInteraction,
	type Message,
} from 'discord.js';

import type { MessagingGatewayConfig } from './config';
import { getDefaultGatewayCommandSpecs } from './commandSpecs';
import { getGatewaySecret } from './secrets';
import { sanitizeOutboundText } from './sanitizer';
import type {
	MessagePlatform,
	PlatformCommandHandler,
	PlatformCommandInteraction,
	PlatformCommandSpec,
	PlatformMessageHandle,
	PlatformThreadHandle,
	PlatformScopeContext,
} from './platform';

type DiscordConfig = NonNullable<MessagingGatewayConfig['discord']>;

const PERMISSION_BUTTON_PREFIX = 'gw:perm:';

function normalizeCommandNameForRouter(commandName: string): string {
	const trimmed = commandName.trim();
	if (!trimmed) return '';
	return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function stripUnsafeThreadNameChars(input: string): string {
	// Thread names are user-visible and should avoid mention-like patterns.
	let t = input;
	t = t.replace(/<@&?\d+>/g, '');
	t = t.replace(/<#\d+>/g, '');
	t = t.replace(/@everyone/g, '');
	t = t.replace(/@here/g, '');
	// Drop control chars
	t = t.replace(/[\u0000-\u001F\u007F]/g, '');
	// Collapse whitespace
	t = t.replace(/\s+/g, ' ').trim();
	return t;
}

function makeSafeDiscordThreadName(input: string, maxLen = 80): string {
	const cleaned = stripUnsafeThreadNameChars(input);
	const fallback = cleaned.length > 0 ? cleaned : 'session';
	const capped = fallback.length > maxLen ? fallback.slice(0, maxLen).trim() : fallback;
	return capped.length > 0 ? capped : 'session';
}

function discordAllowedMentions() {
	return { parse: [] as const };
}

function toDiscordCommandRegistrationData(spec: PlatformCommandSpec) {
	const name = spec.name.startsWith('/') ? spec.name.slice(1) : spec.name;
	const options = (spec.options ?? []).map((opt) => {
		const type =
			opt.type === 'string'
				? ApplicationCommandOptionType.String
				: opt.type === 'integer'
					? ApplicationCommandOptionType.Integer
					: ApplicationCommandOptionType.Boolean;
		return {
			name: opt.name,
			description: opt.description,
			type,
			required: Boolean(opt.required),
		};
	});

	return {
		name,
		description: spec.description,
		options: options.length > 0 ? options : undefined,
	};
}

function toScopeContext(interaction: ChatInputCommandInteraction): PlatformScopeContext {
	return {
		userId: interaction.user.id,
		userDisplayName: interaction.user.username,
		guildId: interaction.guildId ?? undefined,
		channelId: interaction.channelId ?? undefined,
	};
}

function toScopeContextFromButton(interaction: ButtonInteraction): PlatformScopeContext {
	return {
		userId: interaction.user.id,
		userDisplayName: interaction.user.username,
		guildId: interaction.guildId ?? undefined,
		channelId: interaction.channelId ?? undefined,
	};
}

async function replyUnauthorized(interaction: ChatInputCommandInteraction): Promise<void> {
	try {
		if (interaction.deferred || interaction.replied) {
			await interaction.followUp({ content: 'Unauthorized.', ephemeral: true, allowedMentions: discordAllowedMentions() });
			return;
		}
		await interaction.reply({ content: 'Unauthorized.', ephemeral: true, allowedMentions: discordAllowedMentions() });
	} catch {
		// Fail closed: do nothing else.
	}
}

function parseSlashCommandArgs(interaction: ChatInputCommandInteraction): unknown {
	// Only commands in the PLANPACK command set are supported here.
	switch (interaction.commandName) {
		case 'status':
		case 'git':
		case 'workspaces':
			return {};
		case 'sessions': {
			const limit = interaction.options.getInteger('limit') ?? undefined;
			const statuses = interaction.options.getString('statuses') ?? undefined;
			return { limit, statuses };
		}
		case 'task':
		case 'plan': {
			const prompt = interaction.options.getString('prompt', true);
			return { prompt };
		}
		case 'stop': {
			const sessionId = interaction.options.getString('sessionid', true);
			return { sessionId };
		}
		case 'switch': {
			const workspaceRoot = interaction.options.getString('workspaceroot', true);
			return { workspaceRoot };
		}
		default:
			return {};
	}
}

export class DiscordPlatform implements MessagePlatform {
	kind: 'discord' = 'discord';
	private readonly config: DiscordConfig;
	private readonly client: Client;
	private readonly rest: REST;
	private commandHandler: PlatformCommandHandler | undefined;
	private listenersAttached = false;
	private started = false;
	private readonly permissionPromptByCallbackId = new Map<string, { threadId: string; messageId: string }>();
	private sessionsSummaryTimer: NodeJS.Timeout | null = null;
	private sessionsSummaryMessage: Message | null = null;
	private sessionsSummaryLastContent: string | null = null;

	constructor(config: DiscordConfig) {
		this.config = config;
		this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
		this.rest = new REST({ version: '10' });
	}

	setCommandHandler(handler: PlatformCommandHandler): void {
		this.commandHandler = handler;
	}

	async start(): Promise<void> {
		if (this.started) return;

		const secret = await getGatewaySecret('discordBotToken');
		if (!secret.value) {
			throw new Error('[Gateway] Missing required secret: discordBotToken');
		}

		this.rest.setToken(secret.value);
		if (!this.listenersAttached) {
			this.listenersAttached = true;
			this.client.on('interactionCreate', (interaction) => {
				void this.handleInteraction(interaction).catch(() => {
					// Do not throw; do not leak secrets.
				});
			});
		}

		this.client.once('ready', () => {
			console.log(`[Gateway] Discord logged in as ${this.client.user?.tag ?? '(unknown)'}`);
		});

		await this.client.login(secret.value);
		if (!this.client.isReady()) {
			await new Promise<void>((resolve) => {
				this.client.once('ready', () => resolve());
			});
		}

		await this.registerCommands(getDefaultGatewayCommandSpecs());
		this.started = true;
	}

	async stop(): Promise<void> {
		if (!this.started) return;
		this.stopSessionsSummary();
		this.started = false;
		await this.client.destroy();
	}

	startSessionsSummary(params: { buildContent: () => string | Promise<string>; intervalMs?: number }): { stop: () => void } {
		const intervalMs = params.intervalMs ?? 30_000;
		this.stopSessionsSummary();

		const stop = () => this.stopSessionsSummary();

		void (async () => {
			if (!this.client.isReady()) return;
			const channel = await this.client.channels.fetch(this.config.channelId).catch(() => null);
			if (!channel) return;
			const target = channel as any;
			if (typeof target.send !== 'function') return;

			// Best-effort: re-use an existing summary message from this bot to avoid channel spam on restarts.
			let existing: Message | null = null;
			try {
				if (target.messages?.fetch && this.client.user?.id) {
					const recent = await target.messages.fetch({ limit: 20 });
					for (const msg of recent.values()) {
						if (msg.author?.id !== this.client.user.id) continue;
						const content = typeof msg.content === 'string' ? msg.content : '';
						if (content.startsWith('Sessions summary')) {
							existing = msg;
							break;
						}
					}
				}
			} catch {
				// ignore (missing history perms, etc)
			}

			let initialContent: string;
			try {
				initialContent = await params.buildContent();
			} catch {
				initialContent = 'Sessions summary\n(error generating content)';
			}

			const sanitized = sanitizeOutboundText(initialContent, { maxLength: 1800 });
			try {
				this.sessionsSummaryMessage =
					existing ??
					((await target.send({
						content: sanitized,
						allowedMentions: discordAllowedMentions(),
					})) as Message);
				this.sessionsSummaryLastContent = sanitized;
			} catch {
				// If we can't post/edit (missing perms / rate limit), silently disable.
				this.stopSessionsSummary();
				return;
			}

			this.sessionsSummaryTimer = setInterval(() => {
				void this.refreshSessionsSummary(params.buildContent);
			}, intervalMs);
		})();

		return { stop };
	}

	private stopSessionsSummary(): void {
		if (this.sessionsSummaryTimer) {
			clearInterval(this.sessionsSummaryTimer);
			this.sessionsSummaryTimer = null;
		}
		this.sessionsSummaryMessage = null;
		this.sessionsSummaryLastContent = null;
	}

	private async refreshSessionsSummary(buildContent: () => string | Promise<string>): Promise<void> {
		const msg = this.sessionsSummaryMessage;
		if (!msg) return;

		let nextRaw: string;
		try {
			nextRaw = await buildContent();
		} catch {
			return;
		}

		const next = sanitizeOutboundText(nextRaw, { maxLength: 1800 });
		if (this.sessionsSummaryLastContent === next) return;

		try {
			await msg.edit({ content: next, allowedMentions: discordAllowedMentions() });
			this.sessionsSummaryLastContent = next;
		} catch {
			// If we can't edit anymore (archived channel, perms, rate limit), silently stop.
			this.stopSessionsSummary();
		}
	}

	async registerCommands(commands: ReadonlyArray<PlatformCommandSpec> = getDefaultGatewayCommandSpecs()): Promise<void> {
		if (!this.client.isReady()) {
			// Registration needs application id which is available after login.
			throw new Error('[Gateway] Discord client is not ready; call start() first');
		}

		const appId = this.client.application?.id ?? this.client.user?.id;
		if (!appId) throw new Error('[Gateway] Discord application id unavailable');

		const body = commands.map(toDiscordCommandRegistrationData);
		await this.rest.put(Routes.applicationGuildCommands(appId, this.config.guildId), { body });
		console.log(`[Gateway] Discord commands registered in guild ${this.config.guildId}`);
	}

	private async isAuthorizedInteractionScope(params: {
		userId: string;
		guildId?: string;
		channelId?: string;
		channel?: unknown;
	}): Promise<boolean> {
		if (!this.config.allowlistedUserIds.includes(params.userId)) return false;
		if (!params.guildId || params.guildId !== this.config.guildId) return false;
		if (!params.channelId) return false;

		// Allow the main channel, the optional permissions channel, or any thread whose parent is either.
		const allowedParentIds = new Set([this.config.channelId]);
		if (this.config.permissionsChannelId) allowedParentIds.add(this.config.permissionsChannelId);

		if (allowedParentIds.has(params.channelId)) return true;

		const channel =
			(params.channel as any) ?? (await this.client.channels.fetch(params.channelId).catch(() => null));
		if (!channel) return false;
		const isThreadFn = (channel as any).isThread;
		if (typeof isThreadFn === 'function' && isThreadFn.call(channel) === true) {
			const parentId = (channel as any).parentId;
			return typeof parentId === 'string' && allowedParentIds.has(parentId);
		}
		return false;
	}

	private async handleInteraction(interaction: unknown): Promise<void> {
		if (!this.commandHandler) return;
		if (!this.client.isReady()) return;

		if (typeof interaction !== 'object' || interaction === null) return;
		const anyInteraction = interaction as {
			isChatInputCommand?: () => boolean;
			isButton?: () => boolean;
		};

		if (anyInteraction.isChatInputCommand?.() === true) {
			const chat = interaction as ChatInputCommandInteraction;
			const ctxRaw = toScopeContext(chat);
			const authorized = await this.isAuthorizedInteractionScope({
				userId: ctxRaw.userId,
				guildId: ctxRaw.guildId,
				channelId: ctxRaw.channelId,
				channel: chat.channel,
			});
			if (!authorized) {
				await replyUnauthorized(chat);
				return;
			}

			const command = normalizeCommandNameForRouter(chat.commandName);
			const args = parseSlashCommandArgs(chat);

			// For policy checks in the core router, treat thread interactions as scoped to the configured parent channel.
			const ctx: PlatformScopeContext = {
				...ctxRaw,
				channelId: this.config.channelId,
			};

			const platformInteraction: PlatformCommandInteraction = {
				platform: 'discord',
				command,
				args,
				context: ctx,
				replyInitial: async (content, options) => await this.replyInitial(chat, content, options),
				sendMessage: async (content) => await this.sendInChannel(chat, content),
				createThread: async (name) => await this.createSessionThread(name),
			};

			await this.commandHandler(platformInteraction);
			return;
		}

		if (anyInteraction.isButton?.() === true) {
			const button = interaction as ButtonInteraction;
			await this.handlePermissionButton(button);
		}
	}

	private async handlePermissionButton(button: ButtonInteraction): Promise<void> {
		if (!this.commandHandler) return;
		if (!button.customId || !button.customId.startsWith(PERMISSION_BUTTON_PREFIX)) return;

		const parts = button.customId.split(':');
		// expected: gw:perm:approve:<callbackId> OR gw:perm:deny:<callbackId>
		if (parts.length < 4) return;
		const action = parts[2];
		const callbackId = parts.slice(3).join(':').trim();
		if (!callbackId) return;
		if (action !== 'approve' && action !== 'deny') return;

		const ctxRaw = toScopeContextFromButton(button);
		const authorized = await this.isAuthorizedInteractionScope({
			userId: ctxRaw.userId,
			guildId: ctxRaw.guildId,
			channelId: ctxRaw.channelId,
			channel: button.channel,
		});
		if (!authorized) {
			try {
				await button.reply({
					content: 'Unauthorized.',
					ephemeral: true,
					allowedMentions: discordAllowedMentions(),
				});
			} catch {
				// ignore
			}
			return;
		}

		try {
			if (!button.deferred && !button.replied) {
				await button.deferReply({ ephemeral: true });
			}
		} catch {
			// ignore
		}

		const command = action === 'approve' ? '/approve' : '/deny';
		const args = { callbackId };

		const ctx: PlatformScopeContext = {
			...ctxRaw,
			channelId: this.config.channelId,
		};

		const platformInteraction: PlatformCommandInteraction = {
			platform: 'discord',
			command,
			args,
			context: ctx,
			replyInitial: async (content) => {
				await button.editReply({ content, allowedMentions: discordAllowedMentions() });
				return {
					edit: async (nextContent) => {
						await button.editReply({ content: nextContent, allowedMentions: discordAllowedMentions() });
					},
				};
			},
			sendMessage: async (content) => {
				const msg = (await button.followUp({
					content,
					ephemeral: false,
					allowedMentions: discordAllowedMentions(),
				})) as Message;
				return {
					edit: async (nextContent) => {
						await msg.edit({ content: nextContent, allowedMentions: discordAllowedMentions() });
					},
				};
			},
			createThread: async (name) => await this.createSessionThread(name),
		};

		try {
			await this.commandHandler(platformInteraction);
		} catch {
			// If handler throws, keep UI as-is.
			return;
		}

		// Best-effort: mark the prompt message as resolved and remove buttons.
		try {
			const existing = typeof button.message.content === 'string' ? button.message.content : 'Permission request';
			const marker = action === 'approve' ? '✅ Approved' : '⛔ Denied';
			const updated = sanitizeOutboundText(`${existing}\n\n${marker}`);
			await button.message.edit({ content: updated, components: [], allowedMentions: discordAllowedMentions() });
		} catch {
			// ignore
		}
	}

	async sendPermissionPrompt(params: { threadId: string; callbackId: string; summary: string }): Promise<void> {
		if (!this.client.isReady()) throw new Error('[Gateway] Discord client not ready');

		// Use the dedicated permissions channel when configured; otherwise fall back to the session thread.
		const targetChannelId = this.config.permissionsChannelId ?? params.threadId;

		const channel = await this.client.channels.fetch(targetChannelId);
		if (!channel) throw new Error('[Gateway] Discord channel/thread not found');
		const target = channel as any;
		if (typeof target.send !== 'function') throw new Error('[Gateway] Channel is not message-capable');

		const approve = new ButtonBuilder()
			.setCustomId(`${PERMISSION_BUTTON_PREFIX}approve:${params.callbackId}`)
			.setLabel('Approve')
			.setStyle(ButtonStyle.Success);
		const deny = new ButtonBuilder()
			.setCustomId(`${PERMISSION_BUTTON_PREFIX}deny:${params.callbackId}`)
			.setLabel('Deny')
			.setStyle(ButtonStyle.Danger);
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approve, deny);

		const content = sanitizeOutboundText(`Permission requested: ${params.summary}\ncallbackId=${params.callbackId}`, {
			maxLength: 1800,
		});

		const sent = (await target.send({
			content,
			components: [row],
			allowedMentions: discordAllowedMentions(),
		})) as Message;
		this.permissionPromptByCallbackId.set(params.callbackId, { threadId: targetChannelId, messageId: sent.id });
	}

	async markPermissionPromptResolved(params: {
		callbackId: string;
		approved: boolean;
		resolvedBy?: string;
		timedOut?: boolean;
	}): Promise<void> {
		if (!this.client.isReady()) return;
		const record = this.permissionPromptByCallbackId.get(params.callbackId);
		if (!record) return;

		try {
			const channel = await this.client.channels.fetch(record.threadId);
			if (!channel) return;
			const thread = channel as any;
			const msg = await thread.messages.fetch(record.messageId);
			if (!msg) return;
			const marker = params.approved ? '✅ Approved' : '⛔ Denied';
			const suffix = params.timedOut ? ' (timeout)' : '';
			const by = params.resolvedBy ? ` by ${params.resolvedBy}` : '';
			const updated = sanitizeOutboundText(`${msg.content}\n\n${marker}${suffix}${by}`);
			await msg.edit({ content: updated, components: [], allowedMentions: discordAllowedMentions() });
		} catch {
			// ignore
		} finally {
			this.permissionPromptByCallbackId.delete(params.callbackId);
		}
	}

	private async replyInitial(
		interaction: ChatInputCommandInteraction,
		content: string,
		options?: { ephemeral?: boolean },
	): Promise<PlatformMessageHandle> {
		if (!interaction.deferred && !interaction.replied) {
			await interaction.reply({
				content,
				ephemeral: Boolean(options?.ephemeral),
				allowedMentions: discordAllowedMentions(),
			});
		} else {
			await interaction.editReply({ content, allowedMentions: discordAllowedMentions() });
		}

		return {
			edit: async (nextContent) => {
				await interaction.editReply({ content: nextContent, allowedMentions: discordAllowedMentions() });
			},
		};
	}

	private async sendInChannel(interaction: ChatInputCommandInteraction, content: string): Promise<PlatformMessageHandle> {
		const msg = (await interaction.followUp({
			content,
			ephemeral: false,
			allowedMentions: discordAllowedMentions(),
		})) as Message;
		return {
			edit: async (nextContent) => {
				await msg.edit({ content: nextContent, allowedMentions: discordAllowedMentions() });
			},
		};
	}

	/**
	 * Creates a thread under the configured channel (guild-only) with safe/truncated name.
	 */
	async createSessionThread(rawName: string): Promise<PlatformThreadHandle> {
		if (!this.client.isReady()) {
			throw new Error('[Gateway] Discord client not ready');
		}
		const channel = await this.client.channels.fetch(this.config.channelId);
		if (!channel) throw new Error('[Gateway] Discord channel not found');
		if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
			throw new Error('[Gateway] Configured Discord channel does not support threads');
		}

		const safeName = makeSafeDiscordThreadName(rawName);
		const parent = channel as BaseGuildTextChannel;
		const thread = await parent.threads.create({
			name: safeName,
			autoArchiveDuration: 60,
		});

		return {
			id: String(thread.id),
			name: String(thread.name),
			sendMessage: async (content: string) => {
				const sent = await thread.send({ content, allowedMentions: discordAllowedMentions() });
				return {
					edit: async (nextContent: string) => {
						await sent.edit({ content: nextContent, allowedMentions: discordAllowedMentions() });
					},
				};
			},
		};
	}
}
