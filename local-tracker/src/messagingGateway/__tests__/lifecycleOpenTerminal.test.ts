import {
	buildTerminalLaunchTemplate,
	containsUnsafeShellSyntax,
	validateOpenTerminalPayload,
} from '../lifecycleOpenTerminal';

describe('validateOpenTerminalPayload', () => {
	it('accepts strict valid payload', () => {
		const result = validateOpenTerminalPayload({
			sandboxId: 'sb-1',
			launcher: 'pwsh',
			profile: 'default',
		});

		expect(result).toEqual({
			ok: true,
			value: {
				sandboxId: 'sb-1',
				launcher: 'pwsh',
				profile: 'default',
			},
		});
	});

	it('rejects unexpected fields and command injection-like keys', () => {
		const result = validateOpenTerminalPayload({ sandboxId: 'sb-1', command: 'pwsh -NoExit' });
		expect(result).toEqual({
			ok: false,
			error: {
				code: 'invalid_lifecycle_payload',
				reason: 'unexpected_field:command',
			},
		});
	});

	it('rejects env injection at top-level and nested levels', () => {
		expect(validateOpenTerminalPayload({ sandboxId: 'sb-1', env: { PATH: '/tmp' } })).toEqual({
			ok: false,
			error: {
				code: 'env_injection_denied',
				reason: 'forbidden_field:env',
			},
		});

		expect(validateOpenTerminalPayload({ sandboxId: 'sb-1', context: { process_env: { HOME: '/tmp' } } })).toEqual({
			ok: false,
			error: {
				code: 'env_injection_denied',
				reason: 'forbidden_field:context.process_env',
			},
		});
	});

	it('rejects metacharacter/expansion fuzz samples in sandboxId', () => {
		const fuzzInputs = [
			'sb-1;whoami',
			'sb-1&&echo nope',
			'sb-1|cat /etc/passwd',
			'sb-1${HOME}',
			'sb-1$(uname)',
			'sb-1%USERPROFILE%',
		];

		for (const sandboxId of fuzzInputs) {
			const result = validateOpenTerminalPayload({ sandboxId });
			expect(result).toEqual({
				ok: false,
				error: {
					code: 'invalid_lifecycle_payload',
					reason: 'unsafe_shell_syntax:sandboxId',
				},
			});
		}
	});
});

describe('containsUnsafeShellSyntax', () => {
	it('flags expansion and metacharacters', () => {
		expect(containsUnsafeShellSyntax('safe-value')).toBe(false);
		expect(containsUnsafeShellSyntax('x;rm -rf')).toBe(true);
		expect(containsUnsafeShellSyntax('x$HOME')).toBe(true);
		expect(containsUnsafeShellSyntax('x%USERPROFILE%')).toBe(true);
	});
});

describe('buildTerminalLaunchTemplate', () => {
	it('uses fixed command templates (no arbitrary payload command)', () => {
		const windowsTemplate = buildTerminalLaunchTemplate({
			sandboxRoot: '/tmp/sb-1',
			launcher: 'pwsh',
			platform: 'win32',
		});

		expect(windowsTemplate.command).toBe('pwsh');
		expect(windowsTemplate.args).toEqual(['-NoLogo', '-NoExit', '-NoProfile', '-WorkingDirectory', windowsTemplate.cwd]);
	});

	it('rejects launchers unsupported for platform', () => {
		expect(() => buildTerminalLaunchTemplate({
			sandboxRoot: '/tmp/sb-1',
			launcher: 'x-terminal-emulator',
			platform: 'win32',
		})).toThrow('launcher_not_supported:x-terminal-emulator');
	});
});