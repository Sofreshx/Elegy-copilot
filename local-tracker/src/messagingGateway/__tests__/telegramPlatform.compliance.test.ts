import { runPlatformComplianceSuite } from './platformCompliance.harness';

// ── Mock variables (prefixed with "mock" for Jest hoisting) ───────────────

const mockGetMe = jest.fn().mockResolvedValue({ id: 1, is_bot: true, first_name: 'Test', username: 'TestBot' });
const mockSetMyCommands = jest.fn().mockResolvedValue(true);

jest.mock('grammy', () => {
	const MockBot = jest.fn().mockImplementation(() => ({
		api: {
			getMe: mockGetMe,
			sendMessage: jest.fn(),
			editMessageText: jest.fn(),
			setMyCommands: mockSetMyCommands,
			answerCallbackQuery: jest.fn(),
		},
		botInfo: undefined as any,
	}));
	return { Bot: MockBot };
});

jest.mock('../secrets', () => ({
	getGatewaySecret: jest.fn(async () => ({ value: 'mock-telegram-token' })),
}));

// Import after mocks are in place
import { TelegramPlatform } from '../telegramPlatform';

beforeEach(() => {
	jest.clearAllMocks();
	jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
	jest.restoreAllMocks();
});

runPlatformComplianceSuite({
	platformName: 'TelegramPlatform',
	expectedKind: 'telegram',
	factory: () =>
		new TelegramPlatform({ allowlistedUserIds: ['123'] }),
});
