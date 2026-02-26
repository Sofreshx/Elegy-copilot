import type { MessagePlatform } from '../platform';
import { hasPermissionPromptCapability, hasSessionSummaryCapability } from '../platformCapabilities';

function makeBarePlatform(): MessagePlatform {
	return {
		kind: 'discord',
		start: jest.fn(),
		stop: jest.fn(),
		registerCommands: jest.fn(),
		setCommandHandler: jest.fn(),
	};
}

describe('hasPermissionPromptCapability', () => {
	it('returns true when both sendPermissionPrompt and markPermissionPromptResolved are present', () => {
		const platform = {
			...makeBarePlatform(),
			sendPermissionPrompt: jest.fn(),
			markPermissionPromptResolved: jest.fn(),
		};
		expect(hasPermissionPromptCapability(platform)).toBe(true);
	});

	it('returns false when sendPermissionPrompt is missing', () => {
		const platform = {
			...makeBarePlatform(),
			markPermissionPromptResolved: jest.fn(),
		};
		expect(hasPermissionPromptCapability(platform)).toBe(false);
	});

	it('returns false when markPermissionPromptResolved is missing', () => {
		const platform = {
			...makeBarePlatform(),
			sendPermissionPrompt: jest.fn(),
		};
		expect(hasPermissionPromptCapability(platform)).toBe(false);
	});

	it('returns false for a bare MessagePlatform', () => {
		expect(hasPermissionPromptCapability(makeBarePlatform())).toBe(false);
	});
});

describe('hasSessionSummaryCapability', () => {
	it('returns true when startSessionsSummary is present', () => {
		const platform = {
			...makeBarePlatform(),
			startSessionsSummary: jest.fn(),
		};
		expect(hasSessionSummaryCapability(platform)).toBe(true);
	});

	it('returns false for a bare MessagePlatform', () => {
		expect(hasSessionSummaryCapability(makeBarePlatform())).toBe(false);
	});
});
