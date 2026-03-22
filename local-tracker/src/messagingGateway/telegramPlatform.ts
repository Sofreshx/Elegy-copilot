import crypto from 'node:crypto';

import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';

import type { MessagingGatewayConfig } from './config';
import type {
	MessagePlatform,
	PlatformCommandHandler,
	PlatformCommandInteraction,
	PlatformCommandSpec,
	PlatformMessageHandle,
	PlatformScopeContext,
} from './platform';
import type { PlatformPermissionPromptCapability } from './platformCapabilities';
import { getGatewaySecret } from './secrets';
import { buildInlineKeyboard, truncateForTelegram } from './telegramFormatting';

type TelegramConfig = NonNullable<MessagingGatewayConfig['telegram']>;

interface TelegramUpdate {
	update_id: number;
	message?: {
		message_id: number;
		from?: { id: number; first_name?: string; username?: string };
		chat: { id: number };
		text?: string;
	};
	callback_query?: {
		id: string;
		from: { id: number; first_name?: string; username?: string };
		data?: string;
		message?: { message_id: number; chat: { id: number } };
	};
}

interface PendingConfirmation {
	userId: string;
	chatId: number;
	messageId: number;
	command: string;
	args: unknown;
	context: PlatformScopeContext;
	timer: ReturnType<typeof setTimeout>;
}

interface PendingPermissionPrompt {
	chatId: number;
	messageId: number;
}

const TELEGRAM_MVP_ROUTED_COMMANDS: ReadonlySet<string> = new Set(['/status', '/sessions']);
const TELEGRAM_MVP_COMMANDS: ReadonlySet<string> = new Set(['/start', '/help', ...TELEGRAM_MVP_ROUTED_COMMANDS]);
const TELEGRAM_MVP_UNSUPPORTED_GUIDANCE = 'Unsupported command for Telegram MVP. Supported commands: /start, /help, /status, /sessions.';
const TELEGRAM_MVP_HELP_TEXT = [
	'Telegram MVP commands:',
	'/start — show this quick start guidance',
	'/help — show supported commands',
	'/status — show gateway status',
	'/sessions [limit=...] [statuses=...] — list recent sessions',
].join('\n');

const CONFIRMATION_TTL_MS = 120_000;

function parseTelegramCommandArgs(commandName: string, rawArgs: string): unknown {
	switch (commandName) {
		case '/status':
			return {};
		case '/sessions': {
			const trimmed = rawArgs.trim();
			if (!trimmed) return {};
			// Support "limit=N statuses=active,paused" or just a bare number as limit
			const result: { limit?: number; statuses?: string } = {};
			const limitMatch = trimmed.match(/\blimit=(\d+)/);
			const statusesMatch = trimmed.match(/\bstatuses=(\S+)/);
			if (limitMatch) {
				result.limit = parseInt(limitMatch[1], 10);
			} else if (/^\d+$/.test(trimmed)) {
				result.limit = parseInt(trimmed, 10);
			}
			if (statusesMatch) {
				result.statuses = statusesMatch[1];
			}
			return result;
		}
		default:
			return {};
	}
}

export class TelegramPlatform implements MessagePlatform, PlatformPermissionPromptCapability {
	kind: 'telegram' = 'telegram';
	private readonly config: TelegramConfig;
	private bot: Bot | undefined;
	private commandHandler: PlatformCommandHandler | undefined;
	private started = false;

	private readonly pendingConfirmations = new Map<string, PendingConfirmation>();
	private readonly pendingPermissionPrompts = new Map<string, PendingPermissionPrompt>();

	constructor(config: TelegramConfig) {
		this.config = config;
	}

	setCommandHandler(handler: PlatformCommandHandler): void {
		this.commandHandler = handler;
	}

	async start(): Promise<void> {
		if (this.started) return;

		const secret = await getGatewaySecret('telegramBotToken');
		if (!secret.value) {
			throw new Error('[Gateway] Missing required secret: telegramBotToken');
		}

		this.bot = new Bot(secret.value);
		const me: UserFromGetMe = await this.bot.api.getMe();
		this.bot.botInfo = me;
		console.log(`[Gateway] Telegram bot ready as @${me.username ?? '(unknown)'}`);

		this.started = true;
	}

	async stop(): Promise<void> {
		if (!this.started) return;
		// Clear all pending confirmation timers
		for (const pending of this.pendingConfirmations.values()) {
			clearTimeout(pending.timer);
		}
		this.pendingConfirmations.clear();
		this.pendingPermissionPrompts.clear();
		this.started = false;
		this.bot = undefined;
	}

	async registerCommands(_commands: ReadonlyArray<PlatformCommandSpec>): Promise<void> {
		if (!this.bot) {
			throw new Error('[Gateway] Telegram bot is not started; call start() first');
		}

		const botCommands = [
			{ command: 'start', description: 'Show Telegram MVP quick start' },
			{ command: 'help', description: 'Show supported Telegram MVP commands' },
			{ command: 'status', description: 'Show gateway status' },
			{ command: 'sessions', description: 'List recent sessions' },
		];

		await this.bot.api.setMyCommands(botCommands);
		console.log(`[Gateway] Telegram commands registered: ${botCommands.length}`);
	}

	async handleUpdate(update: unknown): Promise<void> {
		if (!this.bot || !this.started) return;

		const u = update as TelegramUpdate;

		if (u.callback_query) {
			await this.handleCallbackQuery(u.callback_query);
			return;
		}

		if (!u.message?.text || !u.message.from?.id) return;

		const text = u.message.text;
		if (!text.startsWith('/')) return;

		const chatId = u.message.chat.id;
		const userId = String(u.message.from.id);
		const userDisplayName = u.message.from.first_name ?? u.message.from.username;

		const spaceIdx = text.indexOf(' ');
		// Strip @botname suffix from command (e.g. /status@MyBot → /status)
		const rawCommand = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
		const commandName = rawCommand.replace(/@\S+$/, '');
		const rawArgs = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1);

		if (!TELEGRAM_MVP_COMMANDS.has(commandName)) {
			await this.bot.api.sendMessage(chatId, TELEGRAM_MVP_UNSUPPORTED_GUIDANCE);
			return;
		}

		if (commandName === '/start' || commandName === '/help') {
			await this.bot.api.sendMessage(chatId, TELEGRAM_MVP_HELP_TEXT);
			return;
		}

		const args = parseTelegramCommandArgs(commandName, rawArgs);

		const context: PlatformScopeContext = {
			userId,
			userDisplayName,
			channelId: String(chatId),
		};

		if (!TELEGRAM_MVP_ROUTED_COMMANDS.has(commandName)) {
			await this.bot.api.sendMessage(chatId, TELEGRAM_MVP_UNSUPPORTED_GUIDANCE);
			return;
		}

		await this.dispatchCommand(chatId, commandName, args, context);
	}

	// ── Permission prompt capability ──────────────────────────────────

	async sendPermissionPrompt(params: { threadId: string; callbackId: string; summary: string }): Promise<void> {
		if (!this.bot) throw new Error('[Gateway] Telegram bot is not started');

		const chatId = Number(params.threadId);
		const keyboard = buildInlineKeyboard([
			{ text: '✅ Approve', callbackData: `tg:perm:approve:${params.callbackId}` },
			{ text: '⛔ Deny', callbackData: `tg:perm:deny:${params.callbackId}` },
		]);

		const sent = await this.bot.api.sendMessage(
			chatId,
			truncateForTelegram(`🔐 Permission requested: ${params.summary}`),
			{ reply_markup: keyboard },
		);

		this.pendingPermissionPrompts.set(params.callbackId, { chatId, messageId: sent.message_id });
	}

	async markPermissionPromptResolved(params: {
		callbackId: string;
		approved: boolean;
		resolvedBy?: string;
		timedOut?: boolean;
	}): Promise<void> {
		if (!this.bot) return;
		const record = this.pendingPermissionPrompts.get(params.callbackId);
		if (!record) return;

		try {
			const marker = params.approved ? '✅ Approved' : '⛔ Denied';
			const suffix = params.timedOut ? ' (timeout)' : '';
			const by = params.resolvedBy ? ` by ${params.resolvedBy}` : '';
			await this.bot.api.editMessageText(
				record.chatId,
				record.messageId,
				`🔐 ${marker}${suffix}${by}`,
				{ reply_markup: { inline_keyboard: [] } },
			);
		} catch {
			// ignore
		} finally {
			this.pendingPermissionPrompts.delete(params.callbackId);
		}
	}

	// ── Invoke-tier confirmation helpers ─────────────────────────────

	private async sendConfirmation(
		chatId: number,
		userId: string,
		command: string,
		args: unknown,
		context: PlatformScopeContext,
	): Promise<void> {
		if (!this.bot) return;

		const confirmId = crypto.randomUUID();
		const keyboard = buildInlineKeyboard([
			{ text: '✅ Confirm', callbackData: `tg:confirm:${confirmId}` },
			{ text: '❌ Cancel', callbackData: `tg:cancel:${confirmId}` },
		]);

		const sent = await this.bot.api.sendMessage(
			chatId,
			truncateForTelegram(`⚡ **${command}** — Confirm?`),
			{ reply_markup: keyboard },
		);

		const timer = setTimeout(() => {
			this.handleConfirmationTimeout(confirmId);
		}, CONFIRMATION_TTL_MS);

		this.pendingConfirmations.set(confirmId, {
			userId,
			chatId,
			messageId: sent.message_id,
			command,
			args,
			context,
			timer,
		});
	}

	private handleConfirmationTimeout(confirmId: string): void {
		const pending = this.pendingConfirmations.get(confirmId);
		if (!pending) return;
		this.pendingConfirmations.delete(confirmId);

		if (!this.bot) return;
		this.bot.api
			.editMessageText(pending.chatId, pending.messageId, '⏰ Confirmation timed out.', {
				reply_markup: { inline_keyboard: [] },
			})
			.catch((err: unknown) => {
				console.error('[Gateway] Telegram confirmation timeout edit failed:', err);
			});
	}

	// ── Callback query handler ───────────────────────────────────────

	private async handleCallbackQuery(
		cq: NonNullable<TelegramUpdate['callback_query']>,
	): Promise<void> {
		if (!this.bot || !cq.data) return;

		const data = cq.data;

		if (data.startsWith('tg:confirm:') || data.startsWith('tg:cancel:')) {
			await this.handleConfirmationCallback(cq);
		} else if (data.startsWith('tg:perm:')) {
			await this.handlePermissionCallback(cq);
		}

		// Acknowledge the callback query to dismiss the loading indicator
		try {
			await this.bot.api.answerCallbackQuery(cq.id);
		} catch {
			// ignore — best-effort acknowledgement
		}
	}

	private async handleConfirmationCallback(
		cq: NonNullable<TelegramUpdate['callback_query']>,
	): Promise<void> {
		if (!this.bot || !cq.data || !cq.message) return;

		const data = cq.data;
		const isConfirm = data.startsWith('tg:confirm:');
		const confirmId = data.replace(/^tg:(confirm|cancel):/, '');

		const pending = this.pendingConfirmations.get(confirmId);
		if (!pending) return;

		// Only the original command issuer may confirm/cancel
		if (String(cq.from.id) !== pending.userId) {
			try {
				await this.bot.api.answerCallbackQuery(cq.id, { text: 'Not your command' });
			} catch {
				// ignore
			}
			return;
		}

		// Clean up
		clearTimeout(pending.timer);
		this.pendingConfirmations.delete(confirmId);

		if (isConfirm) {
			try {
				await this.bot.api.editMessageText(
					pending.chatId,
					pending.messageId,
					'✅ Confirmed',
					{ reply_markup: { inline_keyboard: [] } },
				);
			} catch {
				// ignore
			}
			await this.dispatchCommand(pending.chatId, pending.command, pending.args, pending.context);
		} else {
			try {
				await this.bot.api.editMessageText(
					pending.chatId,
					pending.messageId,
					'❌ Cancelled',
					{ reply_markup: { inline_keyboard: [] } },
				);
			} catch {
				// ignore
			}
		}
	}

	private async handlePermissionCallback(
		cq: NonNullable<TelegramUpdate['callback_query']>,
	): Promise<void> {
		if (!this.bot || !cq.data || !cq.message) return;

		const data = cq.data;
		// data format: tg:perm:approve:<callbackId> or tg:perm:deny:<callbackId>
		const withoutPrefix = data.replace(/^tg:perm:/, '');
		const colonIdx = withoutPrefix.indexOf(':');
		if (colonIdx === -1) return;

		const action = withoutPrefix.slice(0, colonIdx);
		const callbackId = withoutPrefix.slice(colonIdx + 1);
		const approved = action === 'approve';

		const resolvedBy = cq.from.username ?? cq.from.first_name ?? String(cq.from.id);

		await this.markPermissionPromptResolved({ callbackId, approved, resolvedBy });
	}

	// ── Command dispatch ─────────────────────────────────────────────

	private async dispatchCommand(
		chatId: number,
		commandName: string,
		args: unknown,
		context: PlatformScopeContext,
	): Promise<void> {
		if (!this.bot || !this.commandHandler) return;

		const bot = this.bot;

		const replyInitial = async (content: string): Promise<PlatformMessageHandle> => {
			const sent = await bot.api.sendMessage(chatId, truncateForTelegram(content));
			return {
				edit: async (newContent: string): Promise<void> => {
					try {
						await bot.api.editMessageText(chatId, sent.message_id, truncateForTelegram(newContent));
					} catch (err) {
						console.error('[Gateway] Telegram editMessageText failed:', err);
					}
				},
			};
		};

		const sendMessage = async (content: string): Promise<PlatformMessageHandle> => {
			const sent = await bot.api.sendMessage(chatId, truncateForTelegram(content));
			return {
				edit: async (newContent: string): Promise<void> => {
					try {
						await bot.api.editMessageText(chatId, sent.message_id, truncateForTelegram(newContent));
					} catch (err) {
						console.error('[Gateway] Telegram editMessageText failed:', err);
					}
				},
			};
		};

		const interaction: PlatformCommandInteraction = {
			platform: 'telegram',
			command: commandName,
			args,
			context,
			replyInitial,
			sendMessage,
		};

		try {
			await this.commandHandler(interaction);
		} catch (err) {
			console.error('[Gateway] Telegram command handler error:', err);
			try {
				await bot.api.sendMessage(chatId, 'Command failed. Please try again.');
			} catch (sendErr) {
				console.error('[Gateway] Telegram error reply failed:', sendErr);
			}
		}
	}
}
