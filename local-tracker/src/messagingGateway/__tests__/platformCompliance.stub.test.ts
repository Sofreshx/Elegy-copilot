import { runPlatformComplianceSuite } from './platformCompliance.harness';
import type { MessagePlatform } from '../platform';

function createStubPlatform(): MessagePlatform {
	return {
		kind: 'discord',
		start: jest.fn().mockResolvedValue(undefined),
		stop: jest.fn().mockResolvedValue(undefined),
		registerCommands: jest.fn().mockResolvedValue(undefined),
		setCommandHandler: jest.fn(),
	};
}

runPlatformComplianceSuite({
	platformName: 'StubPlatform',
	expectedKind: 'discord',
	factory: createStubPlatform,
});
