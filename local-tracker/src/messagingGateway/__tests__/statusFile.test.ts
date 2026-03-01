import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	MessagingGatewayStatusWriter,
	MessagingGatewayStatusV1,
	MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_CONTRACT_VERSION,
	MESSAGING_GATEWAY_READINESS_CONTRACT_VERSION,
	getDefaultMessagingGatewayStatusPath,
	resolveMessagingGatewayStatusPath,
} from '../statusFile';

function makeStatus(overrides: Partial<MessagingGatewayStatusV1> = {}): MessagingGatewayStatusV1 {
	return {
		schemaVersion: 1,
		contractVersion: MESSAGING_GATEWAY_READINESS_CONTRACT_VERSION,
		compatibility: {
			normalizedFrom: 'v1',
			deterministic: true,
		},
		readiness: {
			state: 'disconnected',
			reasonCode: 'gateway_disconnected',
			deterministic: true,
		},
		lastUpdatedUtc: '',
		config: {
			configPath: '/tmp/config.json',
			mode: 'disconnected',
			discord: {
				guildId: '111',
				channelId: '222',
			},
			allowlists: {
				discordUsersCount: 1,
				workspaceRootsCount: 1,
			},
			workspaces: {
				activeRoot: '/tmp/ws',
			},
		},
		secrets: {
			discordBotToken: { present: false, fromKeychain: false, fromEnv: false },
			gatewayHttpToken: { present: false, fromKeychain: false, fromEnv: false },
			telegramBotToken: { present: false, fromKeychain: false, fromEnv: false },
		},
		runtime: {
			discord: { connected: false, ready: false },
			discoveryTelemetry: {
				contractVersion: MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_CONTRACT_VERSION,
				sample: {
					capacity: 12,
					size: 0,
					dropped: 0,
					deterministic: true,
				},
				countersByReason: {
					keyword_miss: 0,
					ambiguity: 0,
					stale_map: 0,
					no_route: 0,
				},
				recent: [],
			},
		},
		...overrides,
	};
}

describe('MessagingGatewayStatusWriter', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-file-'));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('writeNow() writes valid JSON with schemaVersion and lastUpdatedUtc', () => {
		const statusPath = path.join(tmpDir, 'status.json');
		const status = makeStatus();
		const writer = new MessagingGatewayStatusWriter(statusPath, status);

		writer.writeNow();

		const content = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
		expect(content.schemaVersion).toBe(1);
			expect(content.contractVersion).toBe(MESSAGING_GATEWAY_READINESS_CONTRACT_VERSION);
		expect(typeof content.lastUpdatedUtc).toBe('string');
		expect(content.lastUpdatedUtc.length).toBeGreaterThan(0);
	});

		test('constructor normalizes legacy v0 status input into canonical v1 readiness shape', () => {
			const statusPath = path.join(tmpDir, 'legacy-status.json');
			const writer = new MessagingGatewayStatusWriter(statusPath, {
				configPath: '/legacy/config.json',
				activeWorkspaceRoot: '/legacy/ws',
				connected: true,
				ready: false,
				activeSessionThreadCount: 2,
			});

			writer.writeNow();
			const content = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
			expect(content.schemaVersion).toBe(1);
			expect(content.contractVersion).toBe(MESSAGING_GATEWAY_READINESS_CONTRACT_VERSION);
			expect(content.compatibility).toEqual({ normalizedFrom: 'v0', deterministic: true });
			expect(content.readiness).toEqual({
				state: 'not_ready',
				reasonCode: 'gateway_not_ready',
				deterministic: true,
			});
			expect(content.runtime.discord.connected).toBe(true);
			expect(content.runtime.discord.ready).toBe(false);
			expect(content.runtime.sessions.activeSessionThreadCount).toBe(2);
			expect(content.config.workspaces.activeRoot).toBe('/legacy/ws');
			expect(content.runtime.discoveryTelemetry.contractVersion).toBe(
				MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_CONTRACT_VERSION,
			);
			expect(content.runtime.discoveryTelemetry.countersByReason).toEqual({
				keyword_miss: 0,
				ambiguity: 0,
				stale_map: 0,
				no_route: 0,
			});
		});

		test('constructor keeps discovery telemetry shape when provided', () => {
			const statusPath = path.join(tmpDir, 'status-with-discovery.json');
			const writer = new MessagingGatewayStatusWriter(
				statusPath,
				makeStatus({
					runtime: {
						discord: { connected: true, ready: true },
						discoveryTelemetry: {
							contractVersion: MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_CONTRACT_VERSION,
							sample: { capacity: 12, size: 1, dropped: 0, deterministic: true },
							countersByReason: {
								keyword_miss: 1,
								ambiguity: 0,
								stale_map: 0,
								no_route: 0,
							},
							recent: [
								{ sequence: 1, reason: 'keyword_miss', command: '/unknown', detail: 'unknown_command' },
							],
						},
					},
				}),
			);

			writer.writeNow();
			const content = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
			expect(content.runtime.discoveryTelemetry.sample.size).toBe(1);
			expect(content.runtime.discoveryTelemetry.countersByReason.keyword_miss).toBe(1);
		});

	test('writeNow() creates parent directory if needed', () => {
		const deepPath = path.join(tmpDir, 'a', 'b', 'status.json');
		const writer = new MessagingGatewayStatusWriter(deepPath, makeStatus());

		writer.writeNow();

		expect(fs.existsSync(deepPath)).toBe(true);
		const content = JSON.parse(fs.readFileSync(deepPath, 'utf8'));
		expect(content.schemaVersion).toBe(1);
	});

	test('atomic write produces valid JSON file', () => {
		const statusPath = path.join(tmpDir, 'status.json');
		const writer = new MessagingGatewayStatusWriter(statusPath, makeStatus());

		// Write multiple times — file should always be valid JSON
		for (let i = 0; i < 5; i++) {
			writer.writeNow();
			const raw = fs.readFileSync(statusPath, 'utf8');
			expect(() => JSON.parse(raw)).not.toThrow();
		}
	});

	test('update() calls mutator and writes', () => {
		const statusPath = path.join(tmpDir, 'status.json');
		const status = makeStatus();
		const writer = new MessagingGatewayStatusWriter(statusPath, status);

		writer.update((s) => {
			s.runtime.discord.connected = true;
			s.runtime.discord.ready = true;
		});

		const content = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
		expect(content.runtime.discord.connected).toBe(true);
		expect(content.runtime.discord.ready).toBe(true);
	});

	describe('heartbeat', () => {
		beforeEach(() => {
			jest.useFakeTimers();
		});

		afterEach(() => {
			jest.useRealTimers();
		});

		test('startHeartbeat() fires at interval, stopHeartbeat() stops it', () => {
			const statusPath = path.join(tmpDir, 'status.json');
			const writer = new MessagingGatewayStatusWriter(statusPath, makeStatus());
			const onBeat = jest.fn();

			writer.startHeartbeat(1000, onBeat);

			jest.advanceTimersByTime(3500);
			expect(onBeat).toHaveBeenCalledTimes(3);

			writer.stopHeartbeat();

			jest.advanceTimersByTime(3000);
			expect(onBeat).toHaveBeenCalledTimes(3);
		});
	});
});

describe('getDefaultMessagingGatewayStatusPath', () => {
	test('returns expected path under home directory', () => {
		const result = getDefaultMessagingGatewayStatusPath();
		expect(result).toBe(
			path.join(os.homedir(), '.instruction-engine', 'messaging-gateway.status.json'),
		);
	});
});

describe('resolveMessagingGatewayStatusPath', () => {
	test('ignores configPath arg and returns default', () => {
		const result = resolveMessagingGatewayStatusPath('/some/random/path.json');
		expect(result).toBe(getDefaultMessagingGatewayStatusPath());
	});
});
