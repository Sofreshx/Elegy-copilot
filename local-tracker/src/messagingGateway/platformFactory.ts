import type { MessagingGatewayConfig } from './config';
import type { MessagePlatform } from './platform';
import { DiscordPlatform } from './discordPlatform';
import { TelegramPlatform } from './telegramPlatform';

export interface PlatformFactoryResult {
	adapters: MessagePlatform[];
}

/**
 * Creates platform adapters based on config.
 * Returns only adapters whose config blocks are present.
 */
export function createPlatformAdapters(config: MessagingGatewayConfig): PlatformFactoryResult {
	const adapters: MessagePlatform[] = [];

	if (config.discord) {
		adapters.push(new DiscordPlatform(config.discord));
	}

	if (config.telegram) {
		adapters.push(new TelegramPlatform(config.telegram));
	}

	if (adapters.length === 0) {
		throw new Error('[Gateway] No platform adapters configured. At least one platform (discord or telegram) must be enabled.');
	}

	return { adapters };
}
