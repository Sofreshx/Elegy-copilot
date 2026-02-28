export type HookEnforcementMode = 'off' | 'warn' | 'block';

/**
 * Read enforcement mode from HOOK_ENFORCEMENT environment variable.
 * Valid values: 'off', 'warn', 'block'. Invalid → defaults to 'warn'.
 */
export function getHookEnforcementMode(): HookEnforcementMode {
	const env = (process.env.HOOK_ENFORCEMENT ?? '').trim().toLowerCase();
	if (env === 'off' || env === 'warn' || env === 'block') return env;
	return 'warn';
}

/**
 * Whether the enforcement mode should block tool calls when a block-severity rule matches.
 */
export function shouldBlock(mode: HookEnforcementMode): boolean {
	return mode === 'block';
}
