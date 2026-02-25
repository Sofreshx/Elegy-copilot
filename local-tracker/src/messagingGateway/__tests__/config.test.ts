import fs from 'fs';
import os from 'os';
import path from 'path';

import {
	loadMessagingGatewayConfig,
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
