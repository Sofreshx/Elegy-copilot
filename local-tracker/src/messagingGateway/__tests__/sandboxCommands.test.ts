import { CommandRouter, WU002_POLICY_CONTRACT } from '../commandRouter';
import type { SandboxRegistry } from '../sandboxRegistry';

jest.mock('../gitSnapshot', () => ({
	getWorkspaceGitSnapshot: jest.fn(async () => ({
		repoName: 'repo',
		branch: 'main',
		ahead: 0,
		behind: 0,
		modified: 0,
		untracked: 0,
		staged: 0,
	})),
}));

const BASE_POLICY = {
	allowlistedUserIds: ['u1'],
	rateLimitsPerMinute: WU002_POLICY_CONTRACT.rateLimitsPerMinute,
	maxActiveInvokeSessionsPerUser: WU002_POLICY_CONTRACT.maxActiveInvokeSessionsPerUser,
	permissionTimeoutMs: WU002_POLICY_CONTRACT.permissionTimeoutMs,
	maxPromptChars: WU002_POLICY_CONTRACT.maxPromptChars,
};

const ctx = { userId: 'u1', platform: 'discord' as const };

function makeRouter(sandboxRegistry?: SandboxRegistry) {
	return new CommandRouter({
		policy: BASE_POLICY,
		workspaces: {
			getActiveWorkspaceRoot: () => '/ws/active',
			getAllowedWorkspaceRoots: () => ['/ws/active'],
		},
		auditLogger: { log: jest.fn() } as any,
		permissionOrchestrator: {
			approve: jest.fn(async () => undefined),
			deny: jest.fn(async () => undefined),
		} as any,
		sandboxRegistry,
		nowMs: () => 0,
	});
}

describe('/sandbox command', () => {
	it('returns list when registry has entries', async () => {
		const registry: SandboxRegistry = {
			getAll: () => [
				{
					client: {} as any,
					meta: {
						sandboxId: 'sb-1',
						hostPort: 9001,
						status: 'connected',
						registeredAt: '2026-01-01T00:00:00.000Z',
					},
				},
				{
					client: {} as any,
					meta: {
						sandboxId: 'sb-2',
						hostPort: 9002,
						status: 'idle',
						registeredAt: '2026-01-02T00:00:00.000Z',
					},
				},
			],
		} as any;

		const router = makeRouter(registry);
		const result = await router.route({ name: '/sandbox' }, ctx);

		expect(result.kind).toBe('ok');
		expect(result.messages.join('\n')).toContain('Sandboxes (2)');
		expect(result.messages.join('\n')).toContain('sb-1');
		expect(result.messages.join('\n')).toContain('sb-2');
		expect(result.messages.join('\n')).toContain('port 9001');
		expect(result.messages.join('\n')).toContain('port 9002');
	});

	it('returns empty message when no sandboxes', async () => {
		const registry: SandboxRegistry = {
			getAll: () => [],
		} as any;

		const router = makeRouter(registry);
		const result = await router.route({ name: '/sandbox' }, ctx);

		expect(result.kind).toBe('ok');
		expect(result.messages.join('\n')).toContain('No sandboxes registered');
	});

	it('returns unavailable when no registry', async () => {
		const router = makeRouter(undefined);
		const result = await router.route({ name: '/sandbox' }, ctx);

		expect(result.kind).toBe('ok');
		expect(result.messages.join('\n')).toContain('Sandbox registry not available');
	});
});
