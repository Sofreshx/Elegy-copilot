import { runPlatformComplianceSuite } from './platformCompliance.harness';

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

beforeEach(() => {
	jest.clearAllMocks();
	mockIsReady.mockReturnValue(true);
	jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
	jest.restoreAllMocks();
});

runPlatformComplianceSuite({
	platformName: 'DiscordPlatform',
	expectedKind: 'discord',
	factory: () =>
		new DiscordPlatform({
			allowlistedUserIds: ['123456'],
			guildId: '111111',
			channelId: '222222',
		} as any),
});
