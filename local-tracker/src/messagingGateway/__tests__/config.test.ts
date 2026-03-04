import fs from 'fs';
import os from 'os';
import path from 'path';

import {
	loadMessagingGatewayConfig,
	resolveMessagingGatewayConfigPath,
	getDefaultMessagingGatewayConfigPath,
	resolveSandboxLifecycleConfig,
	DEFAULT_SANDBOX_MAX_SANDBOXES,
	DEFAULT_SANDBOX_PORT_RANGE_START,
	DEFAULT_SANDBOX_PORT_RANGE_END,
	DEFAULT_SANDBOX_CLEANUP_ON_STARTUP,
	DEFAULT_SANDBOX_STALE_TTL_MS,
} from '../config';

const CONFIG_JSON_ENV = 'INSTRUCTION_ENGINE_GATEWAY_CONFIG_JSON';
const CONFIG_PATH_ENV = 'INSTRUCTION_ENGINE_GATEWAY_CONFIG_PATH';

function createBaseConfig(activeRoot: string) {
	return {
		discord: {
			allowlistedUserIds: ['1234567890'],
			guildId: '2222222222',
			channelId: '3333333333',
		},
		workspaces: {
			allowedRoots: [activeRoot],
			activeRoot,
		},
	};
}

describe('messaging gateway config sandboxLifecycle', () => {
	const originalEnv = process.env;
	let tmpRoot: string;

	beforeEach(() => {
		process.env = { ...originalEnv };
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
	});

	afterEach(() => {
		delete process.env[CONFIG_JSON_ENV];
		delete process.env[CONFIG_PATH_ENV];
		process.env = originalEnv;
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	});

	function loadFromEnvJson(partial: Record<string, unknown>) {
		const base = createBaseConfig(tmpRoot);
		process.env[CONFIG_JSON_ENV] = JSON.stringify({
			...base,
			...partial,
		});
		return loadMessagingGatewayConfig().config;
	}

	it('accepts valid sandboxLifecycle values', () => {
		const config = loadFromEnvJson({
			sandboxLifecycle: {
				maxSandboxes: 25,
				portRange: { start: 14000, end: 14099 },
				cleanupOnStartup: true,
				staleTtlMs: 3_600_000,
			},
		});

		expect(config.sandboxLifecycle).toEqual({
			maxSandboxes: 25,
			portRange: { start: 14000, end: 14099 },
			cleanupOnStartup: true,
			staleTtlMs: 3_600_000,
		});
	});

	it('rejects invalid sandboxLifecycle.maxSandboxes values', () => {
		expect(() =>
			loadFromEnvJson({
				sandboxLifecycle: {
					maxSandboxes: 0,
				},
			}),
		).toThrow('[Gateway] Invalid config: sandboxLifecycle.maxSandboxes must be an integer (1-100)');
	});

	it('rejects invalid sandboxLifecycle.portRange values', () => {
		expect(() =>
			loadFromEnvJson({
				sandboxLifecycle: {
					portRange: { start: 17000, end: 16000 },
				},
			}),
		).toThrow('[Gateway] Invalid config: sandboxLifecycle.portRange.start must be <= sandboxLifecycle.portRange.end');

		expect(() =>
			loadFromEnvJson({
				sandboxLifecycle: {
					portRange: { start: 0, end: 16000 },
				},
			}),
		).toThrow('[Gateway] Invalid config: sandboxLifecycle.portRange.start must be an integer port (1-65535)');
	});

	it('rejects invalid sandbox lifecycle cleanup values', () => {
		expect(() =>
			loadFromEnvJson({
				sandboxLifecycle: {
					cleanupOnStartup: 'yes',
				},
			}),
		).toThrow('[Gateway] Invalid config: sandboxLifecycle.cleanupOnStartup must be a boolean');

		expect(() =>
			loadFromEnvJson({
				sandboxLifecycle: {
					staleTtlMs: -1,
				},
			}),
		).toThrow('[Gateway] Invalid config: sandboxLifecycle.staleTtlMs must be an integer (0-31536000000)');
	});

	it('resolveSandboxLifecycleConfig returns defaults and merges optional overrides', () => {
		expect(resolveSandboxLifecycleConfig(undefined)).toEqual({
			maxSandboxes: DEFAULT_SANDBOX_MAX_SANDBOXES,
			portRange: {
				start: DEFAULT_SANDBOX_PORT_RANGE_START,
				end: DEFAULT_SANDBOX_PORT_RANGE_END,
			},
			cleanupOnStartup: DEFAULT_SANDBOX_CLEANUP_ON_STARTUP,
			staleTtlMs: DEFAULT_SANDBOX_STALE_TTL_MS,
		});

		expect(
			resolveSandboxLifecycleConfig({
				maxSandboxes: 7,
				cleanupOnStartup: true,
				staleTtlMs: 10_000,
			}),
		).toEqual({
			maxSandboxes: 7,
			portRange: {
				start: DEFAULT_SANDBOX_PORT_RANGE_START,
				end: DEFAULT_SANDBOX_PORT_RANGE_END,
			},
			cleanupOnStartup: true,
			staleTtlMs: 10_000,
		});
	});
});

describe('ENV JSON mode basics', () => {
	const originalEnv = process.env;
	let tmpRoot: string;

	beforeEach(() => {
		process.env = { ...originalEnv };
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
	});

	afterEach(() => {
		delete process.env[CONFIG_JSON_ENV];
		delete process.env[CONFIG_PATH_ENV];
		process.env = originalEnv;
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	});

	it('loads valid minimal config from env JSON', () => {
		const base = createBaseConfig(tmpRoot);
		process.env[CONFIG_JSON_ENV] = JSON.stringify(base);
		const result = loadMessagingGatewayConfig();
		expect(result.configPath).toBe(`(env:${CONFIG_JSON_ENV})`);
		expect(result.config.discord!.guildId).toBe('2222222222');
		expect(result.config.workspaces.activeRoot).toBe(path.resolve(tmpRoot));
	});

	it('throws on invalid JSON in env var', () => {
		process.env[CONFIG_JSON_ENV] = '{ not valid json';
		expect(() => loadMessagingGatewayConfig()).toThrow(
			`[Gateway] Invalid config: ${CONFIG_JSON_ENV} is not valid JSON`,
		);
	});

	it('falls through to file path when env var is empty string', () => {
		process.env[CONFIG_JSON_ENV] = '';
		// Point to a guaranteed-missing file so the file-path branch throws
		process.env[CONFIG_PATH_ENV] = path.join(tmpRoot, 'nonexistent.json');
		expect(() => loadMessagingGatewayConfig()).toThrow('[Gateway] Missing config file');
	});
});

describe('Discord config validation', () => {
	const originalEnv = process.env;
	let tmpRoot: string;

	beforeEach(() => {
		process.env = { ...originalEnv };
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
	});

	afterEach(() => {
		delete process.env[CONFIG_JSON_ENV];
		delete process.env[CONFIG_PATH_ENV];
		process.env = originalEnv;
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	});

	function loadRawEnvJson(raw: Record<string, unknown>) {
		process.env[CONFIG_JSON_ENV] = JSON.stringify(raw);
		return loadMessagingGatewayConfig().config;
	}

	it('throws when neither discord nor telegram is present', () => {
		expect(() =>
			loadRawEnvJson({
				workspaces: { allowedRoots: [tmpRoot], activeRoot: tmpRoot },
			}),
		).toThrow('[Gateway] Invalid config: at least one platform (discord or telegram) must be configured');
	});

	it('allows platformless config when explicitly enabled', () => {
		process.env.INSTRUCTION_ENGINE_GATEWAY_ALLOW_PLATFORMLESS = '1';
		const config = loadRawEnvJson({
			workspaces: { allowedRoots: [tmpRoot], activeRoot: tmpRoot },
		});
		expect(config.discord).toBeUndefined();
		expect(config.telegram).toBeUndefined();
	});

	it('throws when guildId is missing', () => {
		expect(() =>
			loadRawEnvJson({
				discord: {
					allowlistedUserIds: ['1234567890'],
					channelId: '3333333333',
				},
				workspaces: { allowedRoots: [tmpRoot], activeRoot: tmpRoot },
			}),
		).toThrow('[Gateway] Invalid config: discord.guildId must be a non-empty string');
	});

	it('throws when channelId is missing', () => {
		expect(() =>
			loadRawEnvJson({
				discord: {
					allowlistedUserIds: ['1234567890'],
					guildId: '2222222222',
				},
				workspaces: { allowedRoots: [tmpRoot], activeRoot: tmpRoot },
			}),
		).toThrow('[Gateway] Invalid config: discord.channelId must be a non-empty string');
	});

	it('throws when allowlistedUserIds is empty', () => {
		expect(() =>
			loadRawEnvJson({
				discord: {
					allowlistedUserIds: [],
					guildId: '2222222222',
					channelId: '3333333333',
				},
				workspaces: { allowedRoots: [tmpRoot], activeRoot: tmpRoot },
			}),
		).toThrow('[Gateway] Invalid config: discord.allowlistedUserIds must not be empty');
	});

	it('throws when user ID is non-numeric', () => {
		expect(() =>
			loadRawEnvJson({
				discord: {
					allowlistedUserIds: ['abc'],
					guildId: '2222222222',
					channelId: '3333333333',
				},
				workspaces: { allowedRoots: [tmpRoot], activeRoot: tmpRoot },
			}),
		).toThrow('[Gateway] Invalid config: discord.allowlistedUserIds contains a non-numeric ID');
	});

	it('throws when guildId is non-numeric', () => {
		expect(() =>
			loadRawEnvJson({
				discord: {
					allowlistedUserIds: ['1234567890'],
					guildId: 'not-a-number',
					channelId: '3333333333',
				},
				workspaces: { allowedRoots: [tmpRoot], activeRoot: tmpRoot },
			}),
		).toThrow('[Gateway] Invalid config: discord.guildId must be numeric');
	});

	it('parses valid permissionsChannelId', () => {
		const config = loadRawEnvJson({
			discord: {
				allowlistedUserIds: ['1234567890'],
				guildId: '2222222222',
				channelId: '3333333333',
				permissionsChannelId: '4444444444',
			},
			workspaces: { allowedRoots: [tmpRoot], activeRoot: tmpRoot },
		});
		expect(config.discord!.permissionsChannelId).toBe('4444444444');
	});

	it('throws when permissionsChannelId is non-numeric', () => {
		expect(() =>
			loadRawEnvJson({
				discord: {
					allowlistedUserIds: ['1234567890'],
					guildId: '2222222222',
					channelId: '3333333333',
					permissionsChannelId: 'not-numeric',
				},
				workspaces: { allowedRoots: [tmpRoot], activeRoot: tmpRoot },
			}),
		).toThrow('[Gateway] Invalid config: discord.permissionsChannelId must be numeric');
	});
});

describe('Workspaces validation', () => {
	const originalEnv = process.env;
	let tmpRoot: string;

	beforeEach(() => {
		process.env = { ...originalEnv };
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
	});

	afterEach(() => {
		delete process.env[CONFIG_JSON_ENV];
		delete process.env[CONFIG_PATH_ENV];
		process.env = originalEnv;
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	});

	function loadRawEnvJson(raw: Record<string, unknown>) {
		process.env[CONFIG_JSON_ENV] = JSON.stringify(raw);
		return loadMessagingGatewayConfig().config;
	}

	it('throws when workspaces block is missing', () => {
		expect(() =>
			loadRawEnvJson({
				discord: {
					allowlistedUserIds: ['1234567890'],
					guildId: '2222222222',
					channelId: '3333333333',
				},
			}),
		).toThrow('[Gateway] Invalid config: workspaces must be an object');
	});

	it('throws when allowedRoots is empty', () => {
		expect(() =>
			loadRawEnvJson({
				discord: {
					allowlistedUserIds: ['1234567890'],
					guildId: '2222222222',
					channelId: '3333333333',
				},
				workspaces: { allowedRoots: [], activeRoot: tmpRoot },
			}),
		).toThrow('[Gateway] Invalid config: workspaces.allowedRoots must not be empty');
	});

	it('throws when activeRoot is not in allowedRoots', () => {
		const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-other-'));
		try {
			expect(() =>
				loadRawEnvJson({
					discord: {
						allowlistedUserIds: ['1234567890'],
						guildId: '2222222222',
						channelId: '3333333333',
					},
					workspaces: { allowedRoots: [tmpRoot], activeRoot: otherDir },
				}),
			).toThrow('[Gateway] Invalid config: workspaces.activeRoot must be included in workspaces.allowedRoots');
		} finally {
			fs.rmSync(otherDir, { recursive: true, force: true });
		}
	});

	it('throws when activeRoot does not exist', () => {
		const fake = path.join(os.tmpdir(), 'gateway-nonexistent-' + Date.now());
		expect(() =>
			loadRawEnvJson({
				discord: {
					allowlistedUserIds: ['1234567890'],
					guildId: '2222222222',
					channelId: '3333333333',
				},
				workspaces: { allowedRoots: [fake], activeRoot: fake },
			}),
		).toThrow('[Gateway] Invalid config: workspaces.activeRoot must exist and be a directory');
	});
});

describe('Config path resolution', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		delete process.env[CONFIG_PATH_ENV];
		process.env = originalEnv;
	});

	it('uses CONFIG_PATH env var when set', () => {
		const customPath = path.join(os.tmpdir(), 'gateway-config', 'custom.config.json');
		process.env[CONFIG_PATH_ENV] = customPath;
		expect(resolveMessagingGatewayConfigPath()).toBe(path.resolve(customPath));
	});

	it('falls back to default path when env var is not set', () => {
		delete process.env[CONFIG_PATH_ENV];
		expect(resolveMessagingGatewayConfigPath()).toBe(path.resolve(getDefaultMessagingGatewayConfigPath()));
	});

	it('CLI arg takes priority over env var', () => {
		process.env[CONFIG_PATH_ENV] = path.join(os.tmpdir(), 'gateway-config', 'env.config.json');
		const cliPath = path.join(os.tmpdir(), 'gateway-config', 'cli.config.json');
		expect(resolveMessagingGatewayConfigPath(cliPath)).toBe(path.resolve(cliPath));
	});

	it('uses canonical os.homedir default when HOME and USERPROFILE diverge', () => {
		delete process.env[CONFIG_PATH_ENV];
		const homeOnlyPath = path.join(os.tmpdir(), 'gateway-config-home-only');
		const userProfilePath = path.join(os.tmpdir(), 'gateway-config-userprofile');
		process.env.HOME = homeOnlyPath;
		process.env.USERPROFILE = userProfilePath;

		const resolvedPath = resolveMessagingGatewayConfigPath();
		const expectedPath = path.resolve(
			path.join(os.homedir(), '.instruction-engine', 'messaging-gateway.config.json'),
		);

		expect(resolvedPath).toBe(expectedPath);

		if (process.platform === 'win32') {
			const homeDerivedPath = path.resolve(
				path.join(homeOnlyPath, '.instruction-engine', 'messaging-gateway.config.json'),
			);
			expect(resolvedPath.toLowerCase()).not.toBe(homeDerivedPath.toLowerCase());
		}
	});
});

describe('Mode validation', () => {
	const originalEnv = process.env;
	let tmpRoot: string;

	beforeEach(() => {
		process.env = { ...originalEnv };
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
	});

	afterEach(() => {
		delete process.env[CONFIG_JSON_ENV];
		delete process.env[CONFIG_PATH_ENV];
		process.env = originalEnv;
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	});

	function loadFromEnvJson(partial: Record<string, unknown>) {
		const base = createBaseConfig(tmpRoot);
		process.env[CONFIG_JSON_ENV] = JSON.stringify({
			...base,
			...partial,
		});
		return loadMessagingGatewayConfig().config;
	}

	it.each(['auto', 'connected', 'disconnected'] as const)('accepts valid mode "%s"', (mode) => {
		const config = loadFromEnvJson({ mode });
		expect(config.mode).toBe(mode);
	});

	it('throws on invalid mode', () => {
		expect(() => loadFromEnvJson({ mode: 'bogus' })).toThrow(
			'[Gateway] Invalid config: mode must be one of auto|connected|disconnected',
		);
	});
});

describe('Golden snapshot', () => {
	const originalEnv = process.env;
	let tmpRoot: string;

	beforeEach(() => {
		process.env = { ...originalEnv };
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
	});

	afterEach(() => {
		delete process.env[CONFIG_JSON_ENV];
		delete process.env[CONFIG_PATH_ENV];
		process.env = originalEnv;
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	});

	it('valid complete config matches snapshot', () => {
		const fullConfig = {
			mode: 'connected',
			discord: {
				allowlistedUserIds: ['1234567890'],
				guildId: '2222222222',
				channelId: '3333333333',
				permissionsChannelId: '4444444444',
			},
			workspaces: {
				allowedRoots: [tmpRoot],
				activeRoot: tmpRoot,
			},
			sandboxLifecycle: {
				maxSandboxes: 5,
				portRange: { start: 14000, end: 14099 },
				cleanupOnStartup: true,
				staleTtlMs: 60_000,
			},
		};
		process.env[CONFIG_JSON_ENV] = JSON.stringify(fullConfig);
		const result = loadMessagingGatewayConfig();

		// Normalize temp paths so the snapshot is stable across runs
		const serialized = JSON.parse(JSON.stringify(result.config));
		const resolvedRoot = path.resolve(tmpRoot);
		serialized.workspaces.activeRoot = serialized.workspaces.activeRoot === resolvedRoot ? '<TMPROOT>' : serialized.workspaces.activeRoot;
		serialized.workspaces.allowedRoots = serialized.workspaces.allowedRoots.map((r: string) =>
			r === resolvedRoot ? '<TMPROOT>' : r,
		);
		expect(serialized).toMatchSnapshot();
	});
});

describe('Telegram config validation', () => {
	const originalEnv = process.env;
	let tmpRoot: string;

	beforeEach(() => {
		process.env = { ...originalEnv };
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
	});

	afterEach(() => {
		delete process.env[CONFIG_JSON_ENV];
		delete process.env[CONFIG_PATH_ENV];
		process.env = originalEnv;
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	});

	function loadRawEnvJson(raw: Record<string, unknown>) {
		process.env[CONFIG_JSON_ENV] = JSON.stringify(raw);
		return loadMessagingGatewayConfig().config;
	}

	it('accepts telegram-only config (no discord)', () => {
		const config = loadRawEnvJson({
			telegram: { allowlistedUserIds: ['9876543210'] },
			workspaces: { allowedRoots: [tmpRoot], activeRoot: tmpRoot },
		});
		expect(config.telegram).toEqual({ allowlistedUserIds: ['9876543210'] });
		expect(config.discord).toBeUndefined();
	});

	it('accepts config with both discord and telegram', () => {
		const config = loadRawEnvJson({
			discord: {
				allowlistedUserIds: ['1234567890'],
				guildId: '2222222222',
				channelId: '3333333333',
			},
			telegram: { allowlistedUserIds: ['9876543210'] },
			workspaces: { allowedRoots: [tmpRoot], activeRoot: tmpRoot },
		});
		expect(config.discord!.guildId).toBe('2222222222');
		expect(config.telegram).toEqual({ allowlistedUserIds: ['9876543210'] });
	});

	it('throws when neither discord nor telegram is present', () => {
		expect(() =>
			loadRawEnvJson({
				workspaces: { allowedRoots: [tmpRoot], activeRoot: tmpRoot },
			}),
		).toThrow('[Gateway] Invalid config: at least one platform (discord or telegram) must be configured');
	});

	it('throws when telegram.allowlistedUserIds is empty', () => {
		expect(() =>
			loadRawEnvJson({
				telegram: { allowlistedUserIds: [] },
				workspaces: { allowedRoots: [tmpRoot], activeRoot: tmpRoot },
			}),
		).toThrow('[Gateway] Invalid config: telegram.allowlistedUserIds must not be empty');
	});

	it('throws when telegram.allowlistedUserIds is not an array', () => {
		expect(() =>
			loadRawEnvJson({
				telegram: { allowlistedUserIds: 'not-an-array' },
				workspaces: { allowedRoots: [tmpRoot], activeRoot: tmpRoot },
			}),
		).toThrow('[Gateway] Invalid config: telegram.allowlistedUserIds must be an array of strings');
	});

	it('throws when telegram is not an object', () => {
		expect(() =>
			loadRawEnvJson({
				telegram: 'not-an-object',
				workspaces: { allowedRoots: [tmpRoot], activeRoot: tmpRoot },
			}),
		).toThrow('[Gateway] Invalid config: telegram must be an object');
	});

	it('throws when telegram user ID is non-numeric', () => {
		expect(() =>
			loadRawEnvJson({
				telegram: { allowlistedUserIds: ['abc'] },
				workspaces: { allowedRoots: [tmpRoot], activeRoot: tmpRoot },
			}),
		).toThrow('[Gateway] Invalid config: telegram.allowlistedUserIds contains a non-numeric ID');
	});
});

describe('configVersion validation', () => {
	const originalEnv = process.env;
	let tmpRoot: string;

	beforeEach(() => {
		process.env = { ...originalEnv };
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
	});

	afterEach(() => {
		delete process.env[CONFIG_JSON_ENV];
		delete process.env[CONFIG_PATH_ENV];
		process.env = originalEnv;
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	});

	function loadFromEnvJson(partial: Record<string, unknown>) {
		const base = {
			discord: {
				allowlistedUserIds: ['1234567890'],
				guildId: '2222222222',
				channelId: '3333333333',
			},
			workspaces: { allowedRoots: [tmpRoot], activeRoot: tmpRoot },
		};
		process.env[CONFIG_JSON_ENV] = JSON.stringify({ ...base, ...partial });
		return loadMessagingGatewayConfig().config;
	}

	it('accepts and preserves configVersion', () => {
		const config = loadFromEnvJson({ configVersion: 2 });
		expect(config.configVersion).toBe(2);
	});

	it('config without configVersion is normalized to v1 marker', () => {
		const config = loadFromEnvJson({});
		expect(config.configVersion).toBe(1);
		expect(config.schemaVersion).toBe(1);
		expect(config.contractVersion).toBe('messaging_gateway_config_v1');
		expect(config.compatibility).toEqual({ normalizedFrom: 'v0', deterministic: true });
	});

	it('normalizes v0 legacy root fields into canonical v1 config shape', () => {
		process.env[CONFIG_JSON_ENV] = JSON.stringify({
			allowlistedUserIds: ['1234567890'],
			guildId: '2222222222',
			channelId: '3333333333',
			allowedRoots: [tmpRoot],
			activeRoot: tmpRoot,
		});

		const config = loadMessagingGatewayConfig().config;
		expect(config.discord).toEqual({
			allowlistedUserIds: ['1234567890'],
			guildId: '2222222222',
			channelId: '3333333333',
			permissionsChannelId: undefined,
		});
		expect(config.workspaces.activeRoot).toBe(path.resolve(tmpRoot));
		expect(config.compatibility).toEqual({ normalizedFrom: 'v0', deterministic: true });
	});

	it('throws when configVersion is not a positive integer', () => {
		expect(() => loadFromEnvJson({ configVersion: 0 })).toThrow(
			'[Gateway] Invalid config: configVersion must be a positive integer',
		);
		expect(() => loadFromEnvJson({ configVersion: -1 })).toThrow(
			'[Gateway] Invalid config: configVersion must be a positive integer',
		);
		expect(() => loadFromEnvJson({ configVersion: 1.5 })).toThrow(
			'[Gateway] Invalid config: configVersion must be a positive integer',
		);
		expect(() => loadFromEnvJson({ configVersion: 'one' })).toThrow(
			'[Gateway] Invalid config: configVersion must be a positive integer',
		);
	});
});
