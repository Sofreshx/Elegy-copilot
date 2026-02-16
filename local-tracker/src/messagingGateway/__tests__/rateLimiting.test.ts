import { CommandRouter, WU002_POLICY_CONTRACT } from '../commandRouter';

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

describe('CommandRouter rate limiting (per-tier)', () => {
	const policy = {
		allowlistedUserIds: ['u1'],
		rateLimitsPerMinute: WU002_POLICY_CONTRACT.rateLimitsPerMinute,
		maxActiveInvokeSessionsPerUser: WU002_POLICY_CONTRACT.maxActiveInvokeSessionsPerUser,
		permissionTimeoutMs: WU002_POLICY_CONTRACT.permissionTimeoutMs,
		maxPromptChars: WU002_POLICY_CONTRACT.maxPromptChars,
	};

	const ctx = { userId: 'u1', platform: 'test' };

	function makeRouter() {
		return new CommandRouter({
			policy,
			workspaces: {
				getActiveWorkspaceRoot: () => '/ws/active',
				getAllowedWorkspaceRoots: () => ['/ws/active'],
			},
			auditLogger: { log: jest.fn() } as any,
			e3Cli: {} as any,
			permissionOrchestrator: {
				approve: jest.fn(async () => undefined),
				deny: jest.fn(async () => undefined),
			} as any,
			nowMs: () => 0,
		});
	}

	it('enforces read tier limit (30/min) independently of invoke tier', async () => {
		const router = makeRouter();

		for (let i = 0; i < 30; i++) {
			const res = await router.route({ name: '/workspaces' }, ctx);
			expect(res.kind).toBe('ok');
			expect(res.tier).toBe('read');
		}

		const denied = await router.route({ name: '/workspaces' }, ctx);
		expect(denied.kind).toBe('denied');
		expect(denied.tier).toBe('read');
		expect(denied.meta?.reason).toBe('rate_limited');
		expect(denied.meta?.retryAfterMs).toBe(60_000);

		// Invoke tier should still allow its first call.
		const invoke = await router.route({ name: '/stop', args: { sessionId: 's1' } }, ctx);
		expect(invoke.kind).toBe('ok');
		expect(invoke.tier).toBe('invoke');
	});

	it('enforces invoke tier limit (6/min)', async () => {
		const router = makeRouter();
		for (let i = 0; i < 6; i++) {
			const res = await router.route({ name: '/stop', args: { sessionId: `s-${i}` } }, ctx);
			expect(res.kind).toBe('ok');
			expect(res.tier).toBe('invoke');
		}

		const denied = await router.route({ name: '/stop', args: { sessionId: 's-7' } }, ctx);
		expect(denied.kind).toBe('denied');
		expect(denied.tier).toBe('invoke');
		expect(denied.meta?.reason).toBe('rate_limited');
	});

	it('enforces admin tier limit (3/min)', async () => {
		const router = makeRouter();
		for (let i = 0; i < 3; i++) {
			const res = await router.route({ name: '/approve', args: { callbackId: `cb-${i}` } }, ctx);
			expect(res.kind).toBe('ok');
			expect(res.tier).toBe('admin');
		}

		const denied = await router.route({ name: '/approve', args: { callbackId: 'cb-4' } }, ctx);
		expect(denied.kind).toBe('denied');
		expect(denied.tier).toBe('admin');
		expect(denied.meta?.reason).toBe('rate_limited');
	});
});
