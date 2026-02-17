import { CommandRouter, WU002_POLICY_CONTRACT } from '../commandRouter';
import { PermissionOrchestrator } from '../permissionOrchestrator';

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

// ── Helpers ───────────────────────────────────────────────────────────────

const BASE_POLICY = {
	allowlistedUserIds: ['u-allow-1', 'u-allow-2'],
	requiredGuildId: 'g-req',
	requiredChannelId: 'c-req',
	rateLimitsPerMinute: WU002_POLICY_CONTRACT.rateLimitsPerMinute,
	maxActiveInvokeSessionsPerUser: WU002_POLICY_CONTRACT.maxActiveInvokeSessionsPerUser,
	permissionTimeoutMs: WU002_POLICY_CONTRACT.permissionTimeoutMs,
	maxPromptChars: WU002_POLICY_CONTRACT.maxPromptChars,
};

function makeRouter(overrides?: { policy?: Partial<typeof BASE_POLICY>; workspaceRoots?: string[] }) {
	const roots = overrides?.workspaceRoots ?? ['/ws/allowed-1', '/ws/allowed-2'];
	return new CommandRouter({
		policy: { ...BASE_POLICY, ...overrides?.policy },
		workspaces: {
			getActiveWorkspaceRoot: () => roots[0],
			getAllowedWorkspaceRoots: () => roots,
			setActiveWorkspaceRoot: jest.fn(async () => undefined),
		},
		auditLogger: { log: jest.fn() } as any,
		permissionOrchestrator: {
			approve: jest.fn(async () => undefined),
			deny: jest.fn(async () => undefined),
		} as any,
		nowMs: () => 0,
	});
}

function authorizedCtx(userId = 'u-allow-1') {
	return { userId, guildId: 'g-req', channelId: 'c-req', platform: 'test' };
}

// ── 1) Allowlist enforcement (user IDs) ──────────────────────────────────

describe('Allowlist enforcement — user IDs', () => {
	it('denies a non-allowlisted user', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/status' }, { userId: 'u-attacker', guildId: 'g-req', channelId: 'c-req', platform: 'test' });
		expect(res.kind).toBe('denied');
		expect(res.meta?.reason).toBe('user_not_allowlisted');
	});

	it('denies an empty userId', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/status' }, { userId: '', guildId: 'g-req', channelId: 'c-req', platform: 'test' });
		expect(res.kind).toBe('denied');
		expect(res.meta?.reason).toBe('user_not_allowlisted');
	});

	it('allows an allowlisted user', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/workspaces' }, authorizedCtx());
		expect(res.kind).toBe('ok');
	});
});

// ── 2) Guild + channel scope enforcement ─────────────────────────────────

describe('Allowlist enforcement — guild & channel scope', () => {
	it('denies wrong guildId', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/status' }, { userId: 'u-allow-1', guildId: 'g-wrong', channelId: 'c-req', platform: 'test' });
		expect(res.kind).toBe('denied');
		expect(res.meta?.reason).toBe('guild_scope_mismatch');
	});

	it('denies missing guildId', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/status' }, { userId: 'u-allow-1', channelId: 'c-req', platform: 'test' });
		expect(res.kind).toBe('denied');
		expect(res.meta?.reason).toBe('guild_scope_mismatch');
	});

	it('denies wrong channelId', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/status' }, { userId: 'u-allow-1', guildId: 'g-req', channelId: 'c-wrong', platform: 'test' });
		expect(res.kind).toBe('denied');
		expect(res.meta?.reason).toBe('channel_scope_mismatch');
	});

	it('denies missing channelId', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/status' }, { userId: 'u-allow-1', guildId: 'g-req', platform: 'test' });
		expect(res.kind).toBe('denied');
		expect(res.meta?.reason).toBe('channel_scope_mismatch');
	});
});

// ── 3) Workspace boundary enforcement ────────────────────────────────────

describe('Workspace boundary enforcement', () => {
	it('denies /switch to a workspace not in the allowlist', async () => {
		const router = makeRouter();
		const res = await router.route(
			{ name: '/switch', args: { workspaceRoot: '/ws/evil-root' } },
			authorizedCtx(),
		);
		expect(res.kind).toBe('error');
		expect(res.messages.join(' ')).toMatch(/not.*allowlisted|not found/i);
	});

	it('allows /switch to an allowlisted workspace by basename', async () => {
		const router = makeRouter({ workspaceRoots: ['/ws/allowed-1', '/ws/allowed-2'] });
		const res = await router.route(
			{ name: '/switch', args: { workspaceRoot: 'allowed-2' } },
			authorizedCtx(),
		);
		expect(res.kind).toBe('ok');
	});
});

// ── 4) Rate limiting across tiers ────────────────────────────────────────

describe('Rate limiting — cross-tier isolation', () => {
	it('exhausting read tier does not affect invoke tier', async () => {
		const router = makeRouter();
		const ctx = authorizedCtx();

		// Exhaust read: 30 calls
		for (let i = 0; i < 30; i++) {
			await router.route({ name: '/workspaces' }, ctx);
		}
		const readDenied = await router.route({ name: '/workspaces' }, ctx);
		expect(readDenied.kind).toBe('denied');
		expect(readDenied.meta?.reason).toBe('rate_limited');

		// Invoke should still work
		const invoke = await router.route({ name: '/stop', args: { sessionId: 's1' } }, ctx);
		expect(invoke.kind).toBe('ok');
	});

	it('rate limits are per-user', async () => {
		const router = makeRouter();
		const ctx1 = authorizedCtx('u-allow-1');
		const ctx2 = authorizedCtx('u-allow-2');

		// Exhaust user 1 admin tier: 3 calls
		for (let i = 0; i < 3; i++) {
			await router.route({ name: '/approve', args: { callbackId: `cb-${i}` } }, ctx1);
		}
		const denied1 = await router.route({ name: '/approve', args: { callbackId: 'cb-extra' } }, ctx1);
		expect(denied1.kind).toBe('denied');
		expect(denied1.meta?.reason).toBe('rate_limited');

		// User 2 should still be able to use admin tier
		const ok2 = await router.route({ name: '/approve', args: { callbackId: 'cb-u2' } }, ctx2);
		expect(ok2.kind).toBe('ok');
	});
});

// ── 5) Replayed / unknown approval button interactions ───────────────────

describe('Permission orchestrator — replayed/stale approval', () => {
	beforeEach(() => {
		jest.useFakeTimers();
		jest.setSystemTime(new Date('2026-02-16T00:00:00.000Z'));
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('rejects approve for a callbackId that was never pending', async () => {
		const client = {
			getStatus: () => 'connected',
			resolve_permission: jest.fn(async () => ({ ok: true })),
		} as any;

		const orch = new PermissionOrchestrator({
			client,
			permissionTimeoutMs: 10_000,
			defaultResolvedBy: 'test',
		});

		await expect(orch.approve('unknown-cb')).rejects.toThrow('not pending');
		expect(client.resolve_permission).not.toHaveBeenCalled();
	});

	it('rejects double-approve (second call after first resolved)', async () => {
		const client = {
			getStatus: () => 'connected',
			resolve_permission: jest.fn(async () => ({ ok: true })),
		} as any;

		const orch = new PermissionOrchestrator({
			client,
			permissionTimeoutMs: 30_000,
			defaultResolvedBy: 'test',
		});

		orch.handleExtensionEvent({
			type: 'permission_requested',
			callbackId: 'cb-1',
			toolName: 'run_command',
			description: 'execute ls',
		});

		await orch.approve('cb-1');
		expect(client.resolve_permission).toHaveBeenCalledTimes(1);

		// Second call should fail: callbackId is no longer pending
		await expect(orch.approve('cb-1')).rejects.toThrow('not pending');
		expect(client.resolve_permission).toHaveBeenCalledTimes(1);
	});

	it('rejects approve after timeout auto-deny', async () => {
		const client = {
			getStatus: () => 'connected',
			resolve_permission: jest.fn(async () => ({ ok: true })),
		} as any;

		const orch = new PermissionOrchestrator({
			client,
			permissionTimeoutMs: 5_000,
			defaultResolvedBy: 'test',
		});

		orch.handleExtensionEvent({
			type: 'permission_requested',
			callbackId: 'cb-timeout',
			toolName: 'edit_file',
		});

		// Advance past timeout
		await jest.advanceTimersByTimeAsync(5_000);

		// Should have auto-denied
		expect(client.resolve_permission).toHaveBeenCalledWith(
			expect.objectContaining({ callbackId: 'cb-timeout', approved: false }),
		);

		// Subsequent approve attempt must fail
		await expect(orch.approve('cb-timeout')).rejects.toThrow('not pending');
	});
});

// ── 6) Malformed payloads ────────────────────────────────────────────────

describe('Malformed payloads', () => {
	it('denies unknown/empty command names', async () => {
		const router = makeRouter();
		const ctx = authorizedCtx();

		const unknown = await router.route({ name: '/hacked' }, ctx);
		expect(unknown.kind).toBe('denied');
		expect(unknown.meta?.reason).toBe('unknown_command');

		const empty = await router.route({ name: '' }, ctx);
		expect(empty.kind).toBe('denied');
		expect(empty.meta?.reason).toBe('unknown_command');
	});

	it('rejects /queue with missing prompt', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/queue', args: {} }, authorizedCtx());
		expect(res.kind).toBe('error');
	});

	it('rejects /queue with non-string prompt', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/queue', args: { prompt: 12345 } }, authorizedCtx());
		expect(res.kind).toBe('error');
	});

	it('rejects /switch with empty workspaceRoot', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/switch', args: { workspaceRoot: '' } }, authorizedCtx());
		expect(res.kind).toBe('error');
	});

	it('rejects /approve with missing callbackId', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/approve', args: {} }, authorizedCtx());
		expect(res.kind).toBe('error');
	});

	it('rejects /sessions with out-of-range limit', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/sessions', args: { limit: -1 } }, authorizedCtx());
		expect(res.kind).toBe('error');
	});

	it('handles completely garbage args gracefully', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/switch', args: 'not-an-object' }, authorizedCtx());
		expect(res.kind).toBe('error');
	});
});

// ── 7) Invoke concurrency limit ──────────────────────────────────────────

describe('Invoke concurrency limit', () => {
	it('blocks second concurrent /task from same user', async () => {
		let taskResolve: () => void;
		const taskPromise = new Promise<void>((resolve) => { taskResolve = resolve; });

		const extensionClient = {
			getStatus: () => 'connected',
			invoke_agent: jest.fn(() => taskPromise.then(() => ({ sessionId: 'sess-1' }))),
		} as any;

		const router = new CommandRouter({
			policy: BASE_POLICY,
			workspaces: {
				getActiveWorkspaceRoot: () => '/ws/allowed-1',
				getAllowedWorkspaceRoots: () => ['/ws/allowed-1'],
			},
			auditLogger: { log: jest.fn() } as any,
			extensionClient,
			nowMs: () => 0,
		});

		const ctx = authorizedCtx();

		// First /task: starts but doesn't resolve yet
		const firstTask = router.route({ name: '/task', args: { prompt: 'first' } }, ctx);

		// Second /task: should be denied due to concurrency limit
		const secondTask = await router.route({ name: '/task', args: { prompt: 'second' } }, ctx);
		expect(secondTask.kind).toBe('denied');
		expect(secondTask.meta?.reason).toBe('invoke_concurrency_limit');

		// Resolve first task
		taskResolve!();
		const firstResult = await firstTask;
		expect(firstResult.kind).toBe('ok');
	});
});
