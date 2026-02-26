import { CommandRouter, WU002_POLICY_CONTRACT, type CommandRouterPolicy } from '../commandRouter';
import type { PlatformCommandInteraction, PlatformMessageHandle } from '../platform';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockGitSnapshot = jest.fn().mockResolvedValue({
	repoName: 'repo',
	branch: 'main',
	ahead: 0,
	behind: 0,
	modified: 1,
	untracked: 2,
	staged: 0,
});

jest.mock('../gitSnapshot', () => ({
	getWorkspaceGitSnapshot: (...args: any[]) => mockGitSnapshot(...args),
}));

// ── Helpers ───────────────────────────────────────────────────────────────

const BASE_POLICY: CommandRouterPolicy = {
	allowlistedUserIds: ['u1'],
	rateLimitsPerMinute: WU002_POLICY_CONTRACT.rateLimitsPerMinute,
	maxActiveInvokeSessionsPerUser: WU002_POLICY_CONTRACT.maxActiveInvokeSessionsPerUser,
	permissionTimeoutMs: WU002_POLICY_CONTRACT.permissionTimeoutMs,
	maxPromptChars: WU002_POLICY_CONTRACT.maxPromptChars,
};

function makeRouter(overrides?: {
	policy?: Partial<CommandRouterPolicy>;
	extensionClient?: any;
}) {
	return new CommandRouter({
		policy: { ...BASE_POLICY, ...overrides?.policy },
		workspaces: {
			getActiveWorkspaceRoot: () => process.cwd(),
			getAllowedWorkspaceRoots: () => [process.cwd()],
			setActiveWorkspaceRoot: jest.fn(async () => undefined),
		},
		auditLogger: { log: jest.fn() } as any,
		extensionClient: overrides?.extensionClient,
		permissionOrchestrator: {
			approve: jest.fn(async () => undefined),
			deny: jest.fn(async () => undefined),
			getPending: jest.fn(() => []),
		} as any,
		nowMs: () => 0,
	});
}

function makeMockInteraction(
	command: string,
	overrides?: Partial<PlatformCommandInteraction>,
): PlatformCommandInteraction {
	const mockHandle: PlatformMessageHandle = { edit: jest.fn(async () => undefined) };
	return {
		platform: 'discord',
		command,
		args: undefined,
		context: { userId: 'u1' },
		replyInitial: jest.fn(async () => mockHandle),
		sendMessage: jest.fn(async () => mockHandle),
		...overrides,
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Adapter E2E flow', () => {
	describe('read-tier command (/status)', () => {
		it('routes /status through adapter → router → response', async () => {
			const router = makeRouter();
			const interaction = makeMockInteraction('/status');
			const ctx = { userId: 'u1', platform: interaction.platform } as const;

			const result = await router.route({ name: interaction.command }, ctx);

			expect(result.kind).toBe('ok');
			expect(result.tier).toBe('read');
			expect(result.command).toBe('/status');
			expect(result.messages.length).toBeGreaterThan(0);

			// Simulate adapter replying with router output
			await interaction.replyInitial(result.messages.join('\n'));
			expect(interaction.replyInitial).toHaveBeenCalledTimes(1);
		});
	});

	describe('invoke-tier command (/task)', () => {
		it('routes /task through adapter → router in disconnected mode → returns connected-only message', async () => {
			const router = makeRouter(); // no extensionClient → disconnected
			const interaction = makeMockInteraction('/task', {
				args: { prompt: 'do something' },
			});
			const ctx = { userId: 'u1', platform: interaction.platform } as const;

			const result = await router.route(
				{ name: interaction.command, args: interaction.args },
				ctx,
			);

			expect(result.kind).toBe('ok');
			expect(result.tier).toBe('invoke');
			const text = result.messages.join('\n');
			expect(text).toContain('connected-only');
		});

		it('denies /task for non-allowlisted user', async () => {
			const router = makeRouter();
			const interaction = makeMockInteraction('/task', {
				args: { prompt: 'do something' },
				context: { userId: 'unknown-user' },
			});
			const ctx = {
				userId: interaction.context.userId,
				platform: interaction.platform,
			} as const;

			const result = await router.route(
				{ name: interaction.command, args: interaction.args },
				ctx,
			);

			expect(result.kind).toBe('denied');
			expect(result.meta?.reason).toBe('user_not_allowlisted');
		});
	});

	describe('cross-platform routing', () => {
		it('routes a telegram context through router (guild/channel checks skipped)', async () => {
			const router = makeRouter({
				policy: {
					allowlistedUserIds: ['t-user-1'],
					requiredGuildId: 'g1',
					requiredChannelId: 'c1',
				},
			});
			const interaction = makeMockInteraction('/status', {
				platform: 'telegram',
				context: { userId: 't-user-1' },
			});
			const ctx = {
				userId: interaction.context.userId,
				platform: interaction.platform,
			} as const;

			const result = await router.route({ name: interaction.command }, ctx);

			// Telegram skips guild/channel scope checks, so this should succeed
			expect(result.kind).toBe('ok');
			expect(result.tier).toBe('read');
			expect(result.messages.length).toBeGreaterThan(0);
		});

		it('enforces guild/channel for discord with same policy', async () => {
			const router = makeRouter({
				policy: {
					allowlistedUserIds: ['u1'],
					requiredGuildId: 'g1',
					requiredChannelId: 'c1',
				},
			});
			const interaction = makeMockInteraction('/status', {
				platform: 'discord',
				context: { userId: 'u1' }, // no guildId/channelId
			});
			const ctx = {
				userId: interaction.context.userId,
				platform: interaction.platform,
			} as const;

			const result = await router.route({ name: interaction.command }, ctx);

			expect(result.kind).toBe('denied');
			expect(result.meta?.reason).toBe('guild_scope_mismatch');
		});
	});
});
