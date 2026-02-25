import path from 'path';

export type OpenTerminalLifecycleAction = 'open-terminal';
export type LifecyclePayloadAction = 'create' | 'start' | 'stop' | 'open-terminal' | 'pr-open';
export type LifecyclePayloadErrorCode = 'invalid_lifecycle_payload' | 'env_injection_denied';

export interface LifecyclePayloadValidationFailure {
	code: LifecyclePayloadErrorCode;
	reason: string;
}

export interface OpenTerminalPayload {
	sandboxId: string;
	launcher?: OpenTerminalLauncher;
	profile?: OpenTerminalProfile;
}

export const OPEN_TERMINAL_LAUNCHERS = ['auto', 'pwsh', 'terminal', 'x-terminal-emulator'] as const;
export type OpenTerminalLauncher = (typeof OPEN_TERMINAL_LAUNCHERS)[number];

export const OPEN_TERMINAL_PROFILES = ['default'] as const;
export type OpenTerminalProfile = (typeof OPEN_TERMINAL_PROFILES)[number];

export interface TerminalLaunchTemplate {
	launcher: Exclude<OpenTerminalLauncher, 'auto'>;
	command: string;
	args: string[];
	cwd: string;
}

const SANDBOX_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;
const SHELL_META_CHAR_RE = /[;&|`<>]/;
const SHELL_EXPANSION_RE = /(\$\(|\$\{|\$[A-Za-z_][A-Za-z0-9_]*|%[^%\r\n\s]+%|![^!\r\n\s]+!)/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeKey(key: string): string {
	return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isForbiddenEnvKey(key: string): boolean {
	const normalized = normalizeKey(key);
	return normalized === 'env'
		|| normalized === 'environment'
		|| normalized === 'processenv'
		|| normalized === 'shellenv'
		|| normalized === 'environmentvariables';
}

function findForbiddenEnvPath(value: unknown, prefix = ''): string | null {
	if (!isRecord(value)) return null;
	for (const [key, child] of Object.entries(value)) {
		const next = prefix ? `${prefix}.${key}` : key;
		if (isForbiddenEnvKey(key)) return next;
		const nested = findForbiddenEnvPath(child, next);
		if (nested) return nested;
	}
	return null;
}

export function containsUnsafeShellSyntax(input: string): boolean {
	return SHELL_META_CHAR_RE.test(input) || SHELL_EXPANSION_RE.test(input);
}

export function validateOpenTerminalPayload(payload: unknown):
	| { ok: true; value: OpenTerminalPayload }
	| { ok: false; error: LifecyclePayloadValidationFailure } {
	if (!isRecord(payload)) {
		return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'payload_not_object' } };
	}

	const forbiddenEnvPath = findForbiddenEnvPath(payload);
	if (forbiddenEnvPath) {
		return {
			ok: false,
			error: {
				code: 'env_injection_denied',
				reason: `forbidden_field:${forbiddenEnvPath}`,
			},
		};
	}

	for (const key of Object.keys(payload)) {
		if (key !== 'sandboxId' && key !== 'launcher' && key !== 'profile') {
			return {
				ok: false,
				error: {
					code: 'invalid_lifecycle_payload',
					reason: `unexpected_field:${key}`,
				},
			};
		}
	}

	if (typeof payload.sandboxId !== 'string') {
		return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'missing_or_invalid_sandbox_id' } };
	}
	const sandboxId = payload.sandboxId.trim();
	if (!sandboxId) {
		return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'missing_or_invalid_sandbox_id' } };
	}
	if (containsUnsafeShellSyntax(sandboxId)) {
		return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'unsafe_shell_syntax:sandboxId' } };
	}
	if (!SANDBOX_ID_RE.test(sandboxId)) {
		return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_sandbox_id_format' } };
	}

	let launcher: OpenTerminalLauncher | undefined;
	if (payload.launcher !== undefined) {
		if (typeof payload.launcher !== 'string') {
			return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_launcher' } };
		}
		const rawLauncher = payload.launcher.trim();
		if (!rawLauncher) {
			return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_launcher' } };
		}
		if (containsUnsafeShellSyntax(rawLauncher)) {
			return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'unsafe_shell_syntax:launcher' } };
		}
		if (!OPEN_TERMINAL_LAUNCHERS.includes(rawLauncher as OpenTerminalLauncher)) {
			return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_launcher' } };
		}
		launcher = rawLauncher as OpenTerminalLauncher;
	}

	let profile: OpenTerminalProfile | undefined;
	if (payload.profile !== undefined) {
		if (typeof payload.profile !== 'string') {
			return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_profile' } };
		}
		const rawProfile = payload.profile.trim();
		if (!rawProfile) {
			return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_profile' } };
		}
		if (containsUnsafeShellSyntax(rawProfile)) {
			return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'unsafe_shell_syntax:profile' } };
		}
		if (!OPEN_TERMINAL_PROFILES.includes(rawProfile as OpenTerminalProfile)) {
			return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_profile' } };
		}
		profile = rawProfile as OpenTerminalProfile;
	}

	return {
		ok: true,
		value: {
			sandboxId,
			...(launcher ? { launcher } : {}),
			...(profile ? { profile } : {}),
		},
	};
}

export class LifecyclePayloadValidationError extends Error {
	readonly code: LifecyclePayloadErrorCode;
	readonly reason: string;
	readonly action: LifecyclePayloadAction;

	constructor(failure: LifecyclePayloadValidationFailure, action: LifecyclePayloadAction = 'open-terminal') {
		super(`Invalid lifecycle payload: ${failure.reason}`);
		this.name = 'LifecyclePayloadValidationError';
		this.code = failure.code;
		this.reason = failure.reason;
		this.action = action;
	}
}

const LIFECYCLE_PAYLOAD_ACTIONS = new Set<LifecyclePayloadAction>(['create', 'start', 'stop', 'open-terminal', 'pr-open']);

export function isLifecyclePayloadValidationError(value: unknown): value is LifecyclePayloadValidationError {
	if (!(value instanceof Error)) return false;
	const candidate = value as Partial<LifecyclePayloadValidationError>;
	return typeof candidate.code === 'string'
		&& typeof candidate.reason === 'string'
		&& typeof candidate.action === 'string'
		&& LIFECYCLE_PAYLOAD_ACTIONS.has(candidate.action as LifecyclePayloadAction);
}

export function assertValidOpenTerminalPayload(payload: unknown): OpenTerminalPayload {
	const result = validateOpenTerminalPayload(payload);
	if (!result.ok) {
		throw new LifecyclePayloadValidationError(result.error);
	}
	return result.value;
}

export function buildTerminalLaunchTemplate(params: {
	sandboxRoot: string;
	launcher?: OpenTerminalLauncher;
	platform?: NodeJS.Platform;
}): TerminalLaunchTemplate {
	const platform = params.platform ?? process.platform;
	const cwd = path.resolve(params.sandboxRoot);
	const requested = params.launcher ?? 'auto';

	let launcher: Exclude<OpenTerminalLauncher, 'auto'>;
	if (requested === 'auto') {
		if (platform === 'win32') launcher = 'pwsh';
		else if (platform === 'darwin') launcher = 'terminal';
		else launcher = 'x-terminal-emulator';
	} else {
		launcher = requested;
	}

	if (platform === 'win32' && launcher !== 'pwsh') {
		throw new LifecyclePayloadValidationError({
			code: 'invalid_lifecycle_payload',
			reason: `launcher_not_supported:${launcher}`,
		});
	}
	if (platform === 'darwin' && launcher !== 'terminal') {
		throw new LifecyclePayloadValidationError({
			code: 'invalid_lifecycle_payload',
			reason: `launcher_not_supported:${launcher}`,
		});
	}
	if (platform !== 'win32' && platform !== 'darwin' && launcher !== 'x-terminal-emulator') {
		throw new LifecyclePayloadValidationError({
			code: 'invalid_lifecycle_payload',
			reason: `launcher_not_supported:${launcher}`,
		});
	}

	if (launcher === 'pwsh') {
		return {
			launcher,
			command: 'pwsh',
			args: ['-NoLogo', '-NoExit', '-NoProfile', '-WorkingDirectory', cwd],
			cwd,
		};
	}

	if (launcher === 'terminal') {
		return {
			launcher,
			command: 'open',
			args: ['-a', 'Terminal', cwd],
			cwd,
		};
	}

	return {
		launcher,
		command: 'x-terminal-emulator',
		args: ['--working-directory', cwd],
		cwd,
	};
}