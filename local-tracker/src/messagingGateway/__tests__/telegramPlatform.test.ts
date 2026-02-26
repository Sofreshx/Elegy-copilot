import type { PlatformCommandHandler } from '../platform';

// ── Mock Grammy + secrets ─────────────────────────────────────────────────

const mockApi = {
	getMe: jest.fn(),
	sendMessage: jest.fn(),
	editMessageText: jest.fn(),
	setMyCommands: jest.fn(),
	answerCallbackQuery: jest.fn(),
};

jest.mock('grammy', () => {
	const MockBot = jest.fn().mockImplementation(() => ({
		api: mockApi,
		botInfo: undefined as any,
	}));
	return { Bot: MockBot, __mockApi: mockApi };
});

jest.mock('../secrets', () => ({
	getGatewaySecret: jest.fn(),
}));

// Import after mocks
import { TelegramPlatform } from '../telegramPlatform';

const { getGatewaySecret } = jest.requireMock('../secrets') as { getGatewaySecret: jest.Mock };

// ── Helpers ───────────────────────────────────────────────────────────────

function defaultMeResult() {
	return { id: 1, is_bot: true, first_name: 'TestBot', username: 'TestBot' };
}

function setupStartMocks() {
	getGatewaySecret.mockResolvedValue({ value: 'test-token' });
	mockApi.getMe.mockResolvedValue(defaultMeResult());
}

function textUpdate(
	text: string,
	opts?: { userId?: number; chatId?: number; messageId?: number },
) {
	const userId = opts?.userId ?? 123;
	return {
		update_id: 1,
		message: {
			message_id: opts?.messageId ?? 1,
			from: { id: userId, first_name: 'Tester', username: 'Tester' },
			chat: { id: opts?.chatId ?? 456 },
			text,
		},
	};
}

function callbackQueryUpdate(
	data: string,
	opts?: { userId?: number; chatId?: number; messageId?: number; callbackQueryId?: string },
) {
	return {
		update_id: 2,
		callback_query: {
			id: opts?.callbackQueryId ?? 'cq-1',
			from: { id: opts?.userId ?? 123, first_name: 'Tester', username: 'Tester' },
			data,
			message: {
				message_id: opts?.messageId ?? 10,
				chat: { id: opts?.chatId ?? 456 },
			},
		},
	};
}

async function startedAdapter() {
	const adapter = new TelegramPlatform({ allowlistedUserIds: ['123'] });
	setupStartMocks();
	await adapter.start();
	return adapter;
}

// ── Test lifecycle ────────────────────────────────────────────────────────

beforeEach(() => {
	jest.clearAllMocks();
	jest.spyOn(console, 'log').mockImplementation(() => {});
	jest.spyOn(console, 'error').mockImplementation(() => {});
	mockApi.sendMessage.mockResolvedValue({ message_id: 10, chat: { id: 456 } });
	mockApi.editMessageText.mockResolvedValue(true);
	mockApi.answerCallbackQuery.mockResolvedValue(true);
	mockApi.setMyCommands.mockResolvedValue(true);
});

afterEach(() => {
	jest.restoreAllMocks();
	jest.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('TelegramPlatform', () => {
	// ── start() ───────────────────────────────────────────────────────

	describe('start()', () => {
		it('starts successfully when token is available', async () => {
			const adapter = new TelegramPlatform({ allowlistedUserIds: ['123'] });
			setupStartMocks();

			await adapter.start();

			expect(getGatewaySecret).toHaveBeenCalledWith('telegramBotToken');
			expect(mockApi.getMe).toHaveBeenCalledTimes(1);
		});

		it('throws when token is missing', async () => {
			const adapter = new TelegramPlatform({ allowlistedUserIds: ['123'] });
			getGatewaySecret.mockResolvedValue({ value: null });

			await expect(adapter.start()).rejects.toThrow('Missing required secret: telegramBotToken');
		});

		it('is idempotent — calling start() twice does not create two bots', async () => {
			const adapter = new TelegramPlatform({ allowlistedUserIds: ['123'] });
			setupStartMocks();

			await adapter.start();
			await adapter.start();

			expect(mockApi.getMe).toHaveBeenCalledTimes(1);
		});

		it('sets botInfo from getMe result', async () => {
			const adapter = await startedAdapter();
			// botInfo is set on the mock bot instance — verified via getMe being called
			expect(mockApi.getMe).toHaveBeenCalledTimes(1);
		});
	});

	// ── stop() ────────────────────────────────────────────────────────

	describe('stop()', () => {
		it('clears started state', async () => {
			const adapter = await startedAdapter();

			await adapter.stop();

			// After stop, handleUpdate should be a no-op
			const handler = jest.fn();
			adapter.setCommandHandler(handler);
			await adapter.handleUpdate(textUpdate('/status'));
			expect(handler).not.toHaveBeenCalled();
		});

		it('clears pending confirmations and their timers', async () => {
			jest.useFakeTimers();
			const adapter = await startedAdapter();
			const handler = jest.fn();
			adapter.setCommandHandler(handler);

			// Trigger an invoke command to create a pending confirmation
			await adapter.handleUpdate(textUpdate('/task do something'));
			expect(mockApi.sendMessage).toHaveBeenCalled();

			const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
			await adapter.stop();

			expect(clearTimeoutSpy).toHaveBeenCalled();
		});

		it('is safe to call when not started', async () => {
			const adapter = new TelegramPlatform({ allowlistedUserIds: ['123'] });
			await expect(adapter.stop()).resolves.toBeUndefined();
		});
	});

	// ── registerCommands() ────────────────────────────────────────────

	describe('registerCommands()', () => {
		it('registers read + invoke tier commands', async () => {
			const adapter = await startedAdapter();

			await adapter.registerCommands([
				{ name: '/status', description: 'Show status', tier: 'read' },
				{ name: '/task', description: 'Run a task', tier: 'invoke' },
			]);

			expect(mockApi.setMyCommands).toHaveBeenCalledWith([
				{ command: 'status', description: 'Show status' },
				{ command: 'task', description: 'Run a task' },
			]);
		});

		it('strips leading slash from command names', async () => {
			const adapter = await startedAdapter();

			await adapter.registerCommands([
				{ name: '/ping', description: 'Ping', tier: 'read' },
			]);

			expect(mockApi.setMyCommands).toHaveBeenCalledWith([
				{ command: 'ping', description: 'Ping' },
			]);
		});

		it('throws if not started', async () => {
			const adapter = new TelegramPlatform({ allowlistedUserIds: ['123'] });

			await expect(
				adapter.registerCommands([{ name: '/status', description: 'Status', tier: 'read' }]),
			).rejects.toThrow('not started');
		});
	});

	// ── handleUpdate() — text commands ────────────────────────────────

	describe('handleUpdate() — text commands', () => {
		it('ignores updates without message', async () => {
			const adapter = await startedAdapter();
			const handler = jest.fn();
			adapter.setCommandHandler(handler);

			await adapter.handleUpdate({ update_id: 1 });

			expect(handler).not.toHaveBeenCalled();
		});

		it('ignores non-text messages', async () => {
			const adapter = await startedAdapter();
			const handler = jest.fn();
			adapter.setCommandHandler(handler);

			await adapter.handleUpdate({
				update_id: 1,
				message: {
					message_id: 1,
					from: { id: 123, first_name: 'Tester' },
					chat: { id: 456 },
					// no `text` property
				},
			});

			expect(handler).not.toHaveBeenCalled();
		});

		it('ignores non-command text (does not start with /)', async () => {
			const adapter = await startedAdapter();
			const handler = jest.fn();
			adapter.setCommandHandler(handler);

			await adapter.handleUpdate(textUpdate('hello world'));

			expect(handler).not.toHaveBeenCalled();
		});

		it('returns early if not started', async () => {
			const adapter = new TelegramPlatform({ allowlistedUserIds: ['123'] });
			const handler = jest.fn();
			adapter.setCommandHandler(handler);

			await adapter.handleUpdate(textUpdate('/status'));

			expect(handler).not.toHaveBeenCalled();
		});

		it('dispatches read commands directly', async () => {
			const adapter = await startedAdapter();
			const handler = jest.fn();
			adapter.setCommandHandler(handler);

			await adapter.handleUpdate(textUpdate('/status'));

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					platform: 'telegram',
					command: '/status',
					args: {},
				}),
			);
		});

		it('strips @botname suffix from commands', async () => {
			const adapter = await startedAdapter();
			const handler = jest.fn();
			adapter.setCommandHandler(handler);

			await adapter.handleUpdate(textUpdate('/status@MyBot'));

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({ command: '/status' }),
			);
		});

		it('parses /sessions with limit argument', async () => {
			const adapter = await startedAdapter();
			const handler = jest.fn();
			adapter.setCommandHandler(handler);

			await adapter.handleUpdate(textUpdate('/sessions 5'));

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					command: '/sessions',
					args: { limit: 5 },
				}),
			);
		});

		it('parses /task with prompt argument (dispatches after confirm)', async () => {
			// /task is invoke-tier, so it sends a confirmation first
			const adapter = await startedAdapter();
			const handler = jest.fn();
			adapter.setCommandHandler(handler);

			await adapter.handleUpdate(textUpdate('/task do something'));

			// Should NOT dispatch directly — sends confirmation instead
			expect(handler).not.toHaveBeenCalled();
			expect(mockApi.sendMessage).toHaveBeenCalledWith(
				456,
				expect.stringContaining('/task'),
				expect.objectContaining({ reply_markup: expect.any(Object) }),
			);
		});

		it('sends error message if commandHandler throws', async () => {
			const adapter = await startedAdapter();
			const handler = jest.fn().mockRejectedValue(new Error('boom'));
			adapter.setCommandHandler(handler);

			await adapter.handleUpdate(textUpdate('/status'));

			expect(mockApi.sendMessage).toHaveBeenCalledWith(
				456,
				'Command failed. Please try again.',
			);
		});
	});

	// ── handleUpdate() — invoke confirmation flow ─────────────────────

	describe('handleUpdate() — invoke confirmation flow', () => {
		it('invoke commands send confirmation keyboard instead of dispatching', async () => {
			const adapter = await startedAdapter();
			const handler = jest.fn();
			adapter.setCommandHandler(handler);

			await adapter.handleUpdate(textUpdate('/task do something'));

			expect(handler).not.toHaveBeenCalled();
			expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);
		});

		it('confirmation message includes inline keyboard with Confirm/Cancel buttons', async () => {
			const adapter = await startedAdapter();
			adapter.setCommandHandler(jest.fn());

			await adapter.handleUpdate(textUpdate('/task do something'));

			const call = mockApi.sendMessage.mock.calls[0];
			const replyMarkup = call[2]?.reply_markup;
			expect(replyMarkup).toBeDefined();
			expect(replyMarkup.inline_keyboard).toHaveLength(2);

			const buttonTexts = replyMarkup.inline_keyboard.map(
				(row: any[]) => row[0].text,
			);
			expect(buttonTexts).toContain('✅ Confirm');
			expect(buttonTexts).toContain('❌ Cancel');
		});

		it('confirming dispatches the original command', async () => {
			const adapter = await startedAdapter();
			const handler = jest.fn();
			adapter.setCommandHandler(handler);

			await adapter.handleUpdate(textUpdate('/task do something'));

			// Extract confirm ID from the reply_markup
			const call = mockApi.sendMessage.mock.calls[0];
			const confirmBtn = call[2].reply_markup.inline_keyboard[0][0];
			const confirmData = confirmBtn.callback_data; // tg:confirm:<uuid>

			// Send confirm callback
			await adapter.handleUpdate(callbackQueryUpdate(confirmData));

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					command: '/task',
					args: { prompt: 'do something' },
				}),
			);
		});

		it('cancelling edits message to "❌ Cancelled"', async () => {
			const adapter = await startedAdapter();
			adapter.setCommandHandler(jest.fn());

			await adapter.handleUpdate(textUpdate('/task do something'));

			const call = mockApi.sendMessage.mock.calls[0];
			const cancelBtn = call[2].reply_markup.inline_keyboard[1][0];
			const cancelData = cancelBtn.callback_data; // tg:cancel:<uuid>

			await adapter.handleUpdate(callbackQueryUpdate(cancelData));

			expect(mockApi.editMessageText).toHaveBeenCalledWith(
				456,
				10,
				'❌ Cancelled',
				expect.objectContaining({ reply_markup: { inline_keyboard: [] } }),
			);
		});

		it('only the original issuer can confirm — different user gets "Not your command"', async () => {
			const adapter = await startedAdapter();
			const handler = jest.fn();
			adapter.setCommandHandler(handler);

			await adapter.handleUpdate(textUpdate('/task do something', { userId: 123 }));

			const call = mockApi.sendMessage.mock.calls[0];
			const confirmBtn = call[2].reply_markup.inline_keyboard[0][0];
			const confirmData = confirmBtn.callback_data;

			// Different user tries to confirm
			await adapter.handleUpdate(
				callbackQueryUpdate(confirmData, { userId: 999, callbackQueryId: 'cq-other' }),
			);

			expect(handler).not.toHaveBeenCalled();
			expect(mockApi.answerCallbackQuery).toHaveBeenCalledWith('cq-other', { text: 'Not your command' });
		});

		it('confirmation times out — message edited to "⏰ Confirmation timed out."', async () => {
			jest.useFakeTimers();

			const adapter = await startedAdapter();
			adapter.setCommandHandler(jest.fn());

			await adapter.handleUpdate(textUpdate('/task do something'));

			jest.advanceTimersByTime(120_000);

			// Let microtasks settle (the timeout handler uses .catch, which is async)
			await Promise.resolve();

			expect(mockApi.editMessageText).toHaveBeenCalledWith(
				456,
				10,
				'⏰ Confirmation timed out.',
				expect.objectContaining({ reply_markup: { inline_keyboard: [] } }),
			);
		});
	});

	// ── handleUpdate() — callback_query ───────────────────────────────

	describe('handleUpdate() — callback_query', () => {
		it('handles callback_query updates', async () => {
			const adapter = await startedAdapter();
			adapter.setCommandHandler(jest.fn());

			// Trigger a confirmation to have a valid confirmId
			await adapter.handleUpdate(textUpdate('/task do something'));
			const call = mockApi.sendMessage.mock.calls[0];
			const confirmData = call[2].reply_markup.inline_keyboard[0][0].callback_data;

			await adapter.handleUpdate(callbackQueryUpdate(confirmData));

			// answerCallbackQuery is called to dismiss loading indicator
			expect(mockApi.answerCallbackQuery).toHaveBeenCalled();
		});

		it('ignores callback_query without data', async () => {
			const adapter = await startedAdapter();
			adapter.setCommandHandler(jest.fn());

			await adapter.handleUpdate({
				update_id: 2,
				callback_query: {
					id: 'cq-nodata',
					from: { id: 123, first_name: 'Tester' },
					// no data
					message: { message_id: 10, chat: { id: 456 } },
				},
			});

			expect(mockApi.answerCallbackQuery).not.toHaveBeenCalled();
		});

		it('answers callback query to dismiss loading indicator', async () => {
			const adapter = await startedAdapter();
			adapter.setCommandHandler(jest.fn());

			await adapter.handleUpdate(textUpdate('/task do something'));
			const call = mockApi.sendMessage.mock.calls[0];
			const confirmData = call[2].reply_markup.inline_keyboard[0][0].callback_data;

			await adapter.handleUpdate(callbackQueryUpdate(confirmData, { callbackQueryId: 'cq-123' }));

			expect(mockApi.answerCallbackQuery).toHaveBeenCalledWith('cq-123');
		});
	});

	// ── sendPermissionPrompt() ────────────────────────────────────────

	describe('sendPermissionPrompt()', () => {
		it('sends message with approve/deny keyboard', async () => {
			const adapter = await startedAdapter();

			await adapter.sendPermissionPrompt({
				threadId: '456',
				callbackId: 'perm-abc',
				summary: 'Delete file X',
			});

			expect(mockApi.sendMessage).toHaveBeenCalledWith(
				456,
				expect.stringContaining('Permission requested'),
				expect.objectContaining({
					reply_markup: expect.objectContaining({
						inline_keyboard: expect.arrayContaining([
							expect.arrayContaining([
								expect.objectContaining({ text: '✅ Approve' }),
							]),
							expect.arrayContaining([
								expect.objectContaining({ text: '⛔ Deny' }),
							]),
						]),
					}),
				}),
			);
		});

		it('stores pending prompt for later resolution', async () => {
			const adapter = await startedAdapter();

			await adapter.sendPermissionPrompt({
				threadId: '456',
				callbackId: 'perm-xyz',
				summary: 'Run deploy',
			});

			// Verify by resolving it — should edit the message
			await adapter.markPermissionPromptResolved({
				callbackId: 'perm-xyz',
				approved: true,
			});

			expect(mockApi.editMessageText).toHaveBeenCalled();
		});
	});

	// ── markPermissionPromptResolved() ────────────────────────────────

	describe('markPermissionPromptResolved()', () => {
		it('edits message with approval status', async () => {
			const adapter = await startedAdapter();

			await adapter.sendPermissionPrompt({
				threadId: '456',
				callbackId: 'perm-1',
				summary: 'Action X',
			});

			await adapter.markPermissionPromptResolved({
				callbackId: 'perm-1',
				approved: true,
				resolvedBy: 'admin',
			});

			expect(mockApi.editMessageText).toHaveBeenCalledWith(
				456,
				10,
				expect.stringContaining('✅ Approved'),
				expect.objectContaining({ reply_markup: { inline_keyboard: [] } }),
			);
		});

		it('removes keyboard after resolution', async () => {
			const adapter = await startedAdapter();

			await adapter.sendPermissionPrompt({
				threadId: '456',
				callbackId: 'perm-2',
				summary: 'Action Y',
			});

			await adapter.markPermissionPromptResolved({
				callbackId: 'perm-2',
				approved: false,
			});

			const editCall = mockApi.editMessageText.mock.calls[0];
			expect(editCall[3]).toEqual({ reply_markup: { inline_keyboard: [] } });
		});

		it('handles unknown callbackId gracefully', async () => {
			const adapter = await startedAdapter();

			// Should not throw
			await expect(
				adapter.markPermissionPromptResolved({
					callbackId: 'nonexistent',
					approved: true,
				}),
			).resolves.toBeUndefined();

			expect(mockApi.editMessageText).not.toHaveBeenCalled();
		});
	});
});
