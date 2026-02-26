import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	MessagingGatewayStatusWriter,
	MessagingGatewayStatusV1,
	getDefaultMessagingGatewayStatusPath,
	resolveMessagingGatewayStatusPath,
} from '../statusFile';

function makeStatus(overrides: Partial<MessagingGatewayStatusV1> = {}): MessagingGatewayStatusV1 {
	return {
		schemaVersion: 1,
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
		expect(typeof content.lastUpdatedUtc).toBe('string');
		expect(content.lastUpdatedUtc.length).toBeGreaterThan(0);
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
