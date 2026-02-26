const mockDiscordPlatformInstance = {
	kind: 'discord' as const,
	start: jest.fn(),
	stop: jest.fn(),
	registerCommands: jest.fn(),
	setCommandHandler: jest.fn(),
};

jest.mock('../discordPlatform', () => ({
	DiscordPlatform: jest.fn(() => mockDiscordPlatformInstance),
}));

import { createPlatformAdapters } from '../platformFactory';
import { DiscordPlatform } from '../discordPlatform';
import type { MessagingGatewayConfig } from '../config';

beforeEach(() => {
	jest.clearAllMocks();
});

describe('createPlatformAdapters', () => {
	const baseConfig: MessagingGatewayConfig = {
		workspaces: { allowedRoots: ['/tmp'], activeRoot: '/tmp' },
	};

	it('creates 1 adapter with kind discord when discord config is present', () => {
		const config: MessagingGatewayConfig = {
			...baseConfig,
			discord: {
				allowlistedUserIds: ['u1'],
				guildId: 'g1',
				channelId: 'c1',
			},
		};

		const { adapters } = createPlatformAdapters(config);

		expect(adapters).toHaveLength(1);
		expect(adapters[0].kind).toBe('discord');
		expect(DiscordPlatform).toHaveBeenCalledWith(config.discord);
	});

	it('throws when no platforms are configured', () => {
		expect(() => createPlatformAdapters(baseConfig)).toThrow(
			'[Gateway] No platform adapters configured. At least one platform (discord or telegram) must be enabled.',
		);
	});

	it('throws when discord config is undefined', () => {
		const config: MessagingGatewayConfig = {
			...baseConfig,
			discord: undefined,
		};

		expect(() => createPlatformAdapters(config)).toThrow(
			'[Gateway] No platform adapters configured.',
		);
	});
});
