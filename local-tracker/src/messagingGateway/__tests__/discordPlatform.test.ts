import type { PlatformCommandHandler } from '../platform';

// ── Mock variables (prefixed with "mock" for Jest hoisting) ───────────────

const mockLogin = jest.fn().mockResolvedValue('token');
const mockDestroy = jest.fn().mockResolvedValue(undefined);
const mockIsReady = jest.fn().mockReturnValue(true);
const mockOn = jest.fn();
const mockOnce = jest.fn();
const mockUser = { tag: 'TestBot#1234', id: 'app-123' };

const mockPut = jest.fn().mockResolvedValue(undefined);
const mockSetToken = jest.fn().mockReturnThis();
const mockApplicationGuildCommands = jest.fn(() => '/mock-route');

jest.mock('discord.js', () => {
	const MockClient = jest.fn().mockImplementation(() => ({
		login: mockLogin,
		destroy: mockDestroy,
		isReady: mockIsReady,
		on: mockOn,
		once: mockOnce,
		user: mockUser,
		application: { id: 'app-123' },
	}));

	const MockREST = jest.fn().mockImplementation(() => ({
		put: mockPut,
		setToken: mockSetToken,
	}));

	return {
		Client: MockClient,
		REST: MockREST,
		Routes: { applicationGuildCommands: mockApplicationGuildCommands },
		GatewayIntentBits: { Guilds: 1 },
		ApplicationCommandOptionType: { String: 3, Integer: 4, Boolean: 5 },
		ActionRowBuilder: jest.fn(),
		ButtonBuilder: jest.fn(),
		ButtonStyle: { Primary: 1, Danger: 4 },
		ChannelType: { PublicThread: 11 },
	};
});

jest.mock('../secrets', () => ({
	getGatewaySecret: jest.fn(async () => ({ value: 'mock-discord-token' })),
}));

// Import after mocks are in place
import { DiscordPlatform } from '../discordPlatform';

// ── Helpers ───────────────────────────────────────────────────────────────

const mockConfig = {
	allowlistedUserIds: ['123456789'],
	guildId: '456',
	channelId: '789',
};

// ── Tests ─────────────────────────────────────────────────────────────────

beforeEach(() => {
	jest.clearAllMocks();
	mockIsReady.mockReturnValue(true);
	jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
	jest.restoreAllMocks();
});

describe('DiscordPlatform', () => {
	// ── Constructor ───────────────────────────────────────────────────────

	it('creates an instance with valid config', () => {
		const platform = new DiscordPlatform(mockConfig as any);
		expect(platform).toBeDefined();
	});

	// ── kind property ─────────────────────────────────────────────────────

	it('returns "discord" for the kind property', () => {
		const platform = new DiscordPlatform(mockConfig as any);
		expect(platform.kind).toBe('discord');
	});

	// ── setCommandHandler ─────────────────────────────────────────────────

	it('stores a command handler without throwing', () => {
		const platform = new DiscordPlatform(mockConfig as any);
		const handler: PlatformCommandHandler = jest.fn() as any;
		expect(() => platform.setCommandHandler(handler)).not.toThrow();
	});

	// ── start() ───────────────────────────────────────────────────────────

	describe('start()', () => {
		it('calls client.login, registers commands, and sets started', async () => {
			const platform = new DiscordPlatform(mockConfig as any);

			await platform.start();

			expect(mockSetToken).toHaveBeenCalledWith('mock-discord-token');
			expect(mockLogin).toHaveBeenCalledWith('mock-discord-token');
			expect(mockPut).toHaveBeenCalledTimes(1);
			expect(mockPut).toHaveBeenCalledWith('/mock-route', expect.objectContaining({ body: expect.any(Array) }));
		});

		it('registers the interactionCreate listener', async () => {
			const platform = new DiscordPlatform(mockConfig as any);

			await platform.start();

			expect(mockOn).toHaveBeenCalledWith('interactionCreate', expect.any(Function));
		});

		it('is idempotent — second call is a no-op', async () => {
			const platform = new DiscordPlatform(mockConfig as any);

			await platform.start();
			await platform.start();

			expect(mockLogin).toHaveBeenCalledTimes(1);
			expect(mockPut).toHaveBeenCalledTimes(1);
		});
	});

	// ── stop() ────────────────────────────────────────────────────────────

	describe('stop()', () => {
		it('calls client.destroy and clears started', async () => {
			const platform = new DiscordPlatform(mockConfig as any);
			await platform.start();

			await platform.stop();

			expect(mockDestroy).toHaveBeenCalledTimes(1);
		});

		it('is idempotent — second call is a no-op', async () => {
			const platform = new DiscordPlatform(mockConfig as any);
			await platform.start();

			await platform.stop();
			await platform.stop();

			expect(mockDestroy).toHaveBeenCalledTimes(1);
		});

		it('no-ops when never started', async () => {
			const platform = new DiscordPlatform(mockConfig as any);

			await platform.stop();

			expect(mockDestroy).not.toHaveBeenCalled();
		});
	});

	// ── registerCommands() ────────────────────────────────────────────────

	describe('registerCommands()', () => {
		it('calls REST.put with the correct route and transformed commands', async () => {
			const platform = new DiscordPlatform(mockConfig as any);
			await platform.start();

			// start() already calls registerCommands once; clear to isolate
			mockPut.mockClear();
			mockApplicationGuildCommands.mockClear();

			await platform.registerCommands([
				{ name: '/ping', description: 'Ping', tier: 'read' as const },
				{
					name: '/echo',
					description: 'Echo a message',
					tier: 'read' as const,
					options: [{ name: 'text', description: 'Text to echo', type: 'string' as const, required: true }],
				},
			]);

			expect(mockApplicationGuildCommands).toHaveBeenCalledWith('app-123', '456');
			expect(mockPut).toHaveBeenCalledWith('/mock-route', {
				body: [
					{ name: 'ping', description: 'Ping', options: undefined },
					{
						name: 'echo',
						description: 'Echo a message',
						options: [{ name: 'text', description: 'Text to echo', type: 3, required: true }],
					},
				],
			});
		});
	});
});
