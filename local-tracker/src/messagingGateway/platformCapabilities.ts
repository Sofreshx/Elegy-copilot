import type { MessagePlatform } from './platform';

/**
 * Capability for platforms that support interactive permission prompts
 * (e.g., Discord with button-based approve/deny in channels/threads).
 */
export interface PlatformPermissionPromptCapability {
	sendPermissionPrompt(params: { threadId: string; callbackId: string; summary: string }): Promise<void>;
	markPermissionPromptResolved(params: {
		callbackId: string;
		approved: boolean;
		resolvedBy?: string;
		timedOut?: boolean;
	}): Promise<void>;
}

/**
 * Capability for platforms that support periodic session summary messages
 * (e.g., Discord with a pinned/updated summary message).
 */
export interface PlatformSessionSummaryCapability {
	startSessionsSummary(params: {
		buildContent: () => string | Promise<string>;
		intervalMs?: number;
	}): { stop: () => void };
}

/**
 * Type guard: checks if a platform supports permission prompts.
 */
export function hasPermissionPromptCapability(
	platform: MessagePlatform,
): platform is MessagePlatform & PlatformPermissionPromptCapability {
	return (
		typeof (platform as any).sendPermissionPrompt === 'function' &&
		typeof (platform as any).markPermissionPromptResolved === 'function'
	);
}

/**
 * Type guard: checks if a platform supports session summary.
 */
export function hasSessionSummaryCapability(
	platform: MessagePlatform,
): platform is MessagePlatform & PlatformSessionSummaryCapability {
	return typeof (platform as any).startSessionsSummary === 'function';
}
