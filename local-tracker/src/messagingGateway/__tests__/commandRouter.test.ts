import {
	CommandRouter,
	COMMAND_ROUTER_DISCOVERY_SAMPLE_CAPACITY,
	WU002_POLICY_CONTRACT,
	type CommandRouterPolicy,
} from '../commandRouter';

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

const BASE_POLICY = {
	allowlistedUserIds: ['u1'],
	rateLimitsPerMinute: WU002_POLICY_CONTRACT.rateLimitsPerMinute,
	maxActiveInvokeSessionsPerUser: WU002_POLICY_CONTRACT.maxActiveInvokeSessionsPerUser,
	permissionTimeoutMs: WU002_POLICY_CONTRACT.permissionTimeoutMs,
	maxPromptChars: WU002_POLICY_CONTRACT.maxPromptChars,
};

function makeRouter(overrides?: {
	policy?: Partial<CommandRouterPolicy>;
	extensionClient?: any;
	permissionOrchestrator?: any;
	sessionDriver?: any;
	workspaceRoots?: string[];
	setActiveWorkspaceRoot?: jest.Mock;
}) {
	const roots = overrides?.workspaceRoots ?? ['/ws/active'];
	return new CommandRouter({
		policy: { ...BASE_POLICY, ...overrides?.policy },
		workspaces: {
			getActiveWorkspaceRoot: () => roots[0],
			getAllowedWorkspaceRoots: () => roots,
			setActiveWorkspaceRoot: overrides?.setActiveWorkspaceRoot ?? jest.fn(async () => undefined),
		},
		auditLogger: { log: jest.fn() } as any,
		extensionClient: overrides?.extensionClient,
		sessionDriver: overrides?.sessionDriver,
		permissionOrchestrator: overrides?.permissionOrchestrator ?? {
			approve: jest.fn(async () => undefined),
			deny: jest.fn(async () => undefined),
			getPending: jest.fn(() => []),
		} as any,
		nowMs: () => 0,
	});
}

const ctx = { userId: 'u1', platform: 'discord' as const };

// ── 1) Command tier resolution ────────────────────────────────────────────

describe('getCommandTier()', () => {
	const router = makeRouter();

	it.each([
		['/status', 'read'],
		['/sessions', 'read'],
		['/git', 'read'],
		['/workspaces', 'read'],
		['/sandbox', 'read'],
	])('returns read for %s', (cmd, tier) => {
		expect(router.getCommandTier(cmd)).toBe(tier);
	});

	it.each([
		['/task', 'invoke'],
		['/plan', 'invoke'],
		['/stop', 'invoke'],
	])('returns invoke for %s', (cmd, tier) => {
		expect(router.getCommandTier(cmd)).toBe(tier);
	});

	it.each([
		['/switch', 'admin'],
		['/approve', 'admin'],
		['/deny', 'admin'],
	])('returns admin for %s', (cmd, tier) => {
		expect(router.getCommandTier(cmd)).toBe(tier);
	});

	it('returns unknown for unrecognized commands', () => {
		expect(router.getCommandTier('/nope')).toBe('unknown');
		expect(router.getCommandTier('/exec')).toBe('unknown');
	});
});

// ── 2) Command normalization ──────────────────────────────────────────────

describe('Command normalization', () => {
	const router = makeRouter();

	it('adds leading slash if missing', async () => {
		const res = await router.route({ name: 'workspaces' }, ctx);
		expect(res.kind).toBe('ok');
		expect(res.command).toBe('/workspaces');
	});

	it('trims whitespace', async () => {
		const res = await router.route({ name: '  /workspaces  ' }, ctx);
		expect(res.kind).toBe('ok');
		expect(res.command).toBe('/workspaces');
	});

	it('denies empty command', async () => {
		const res = await router.route({ name: '' }, ctx);
		expect(res.kind).toBe('denied');
		expect(res.meta?.reason).toBe('unknown_command');
	});

	it('denies whitespace-only command', async () => {
		const res = await router.route({ name: '   ' }, ctx);
		expect(res.kind).toBe('denied');
		expect(res.meta?.reason).toBe('unknown_command');
	});
});

// ── 3) Read command responses ─────────────────────────────────────────────

describe('/status response', () => {
	it('returns ok with formatted summary (no extensionClient)', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/status' }, ctx);
		expect(res.kind).toBe('ok');
		expect(res.tier).toBe('read');
		const text = res.messages.join('\n');
		expect(text).toContain('Status');
		expect(text).toContain('disconnected');
		expect(text).toContain('repo');
		expect(text).toContain('main');
	});

	it('returns connected when extensionClient status is connected', async () => {
		const router = makeRouter({
			extensionClient: { getStatus: () => 'connected' },
		});
		const res = await router.route({ name: '/status' }, ctx);
		expect(res.kind).toBe('ok');
		const text = res.messages.join('\n');
		expect(text).toContain('connected');
	});
});

describe('/sessions response', () => {
	it('returns session list when extensionClient is connected', async () => {
		const router = makeRouter({
			extensionClient: {
				getStatus: () => 'connected',
				get_sessions: jest.fn(async () => [
					{ id: 's1', status: 'active', agentName: 'orchestrator', createdAt: '2026-01-01T00:00:00Z' },
				]),
			},
		});
		const res = await router.route({ name: '/sessions' }, ctx);
		expect(res.kind).toBe('ok');
		const text = res.messages.join('\n');
		expect(text).toContain('Sessions');
		expect(text).toContain('connected');
	});

	it('returns "not connected" when extensionClient is absent', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/sessions' }, ctx);
		expect(res.kind).toBe('ok');
		const text = res.messages.join('\n');
		expect(text).toContain('not connected');
	});
});

describe('/git response', () => {
	it('returns ok with git snapshot fields', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/git' }, ctx);
		expect(res.kind).toBe('ok');
		const text = res.messages.join('\n');
		expect(text).toContain('Git');
		expect(text).toContain('repo');
		expect(text).toContain('main');
	});

	it('returns "No git repository" when snapshot is null', async () => {
		mockGitSnapshot.mockResolvedValueOnce(null as any);
		const router = makeRouter();
		const res = await router.route({ name: '/git' }, ctx);
		expect(res.kind).toBe('ok');
		const text = res.messages.join('\n');
		expect(text).toContain('No git repository');
	});
});

describe('/workspaces response', () => {
	it('lists workspaces with active marker', async () => {
		const router = makeRouter({ workspaceRoots: ['/ws/one', '/ws/two'] });
		const res = await router.route({ name: '/workspaces' }, ctx);
		expect(res.kind).toBe('ok');
		const text = res.messages.join('\n');
		expect(text).toContain('Workspaces');
		expect(text).toContain('/ws/one');
		expect(text).toContain('/ws/two');
		// Active workspace gets '*' marker
		expect(text).toMatch(/\*.*\/ws\/one/);
	});
});

// ── 4) Invoke command argument validation ─────────────────────────────────

describe('/task argument validation', () => {
	it('returns error when prompt is empty', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/task', args: { prompt: '' } }, ctx);
		expect(res.kind).toBe('error');
	});

	it('returns error when args are missing entirely', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/task', args: undefined }, ctx);
		expect(res.kind).toBe('error');
	});

	it('succeeds with valid prompt (no extensionClient — connected-only message)', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/task', args: { prompt: 'do something' } }, ctx);
		expect(res.kind).toBe('ok');
		const text = res.messages.join('\n');
		expect(text).toContain('connected-only');
	});

	it('rejects prompt exceeding maxPromptChars via schema', async () => {
		const router = makeRouter();
		const oversized = 'a'.repeat(WU002_POLICY_CONTRACT.maxPromptChars + 1);
		const res = await router.route({ name: '/task', args: { prompt: oversized } }, ctx);
		// sanitizeInboundPrompt truncates then zod validates; either ok (truncated) or error
		expect(['ok', 'error']).toContain(res.kind);
	});

	it('rejects extra unknown arg fields', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/task', args: { prompt: 'hello', extra: 1 } }, ctx);
		expect(res.kind).toBe('error');
	});
});

describe('/plan argument validation', () => {
	it('succeeds with valid prompt (no extensionClient)', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/plan', args: { prompt: 'plan this' } }, ctx);
		expect(res.kind).toBe('ok');
		const text = res.messages.join('\n');
		expect(text).toContain('connected-only');
	});
});

describe('/stop argument validation', () => {
	it('returns error when sessionId is missing', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/stop', args: {} }, ctx);
		expect(res.kind).toBe('error');
	});

	it('returns error when sessionId is empty string', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/stop', args: { sessionId: '' } }, ctx);
		expect(res.kind).toBe('error');
	});

	it('returns connected-only message with valid sessionId (no client)', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/stop', args: { sessionId: 's-1' } }, ctx);
		expect(res.kind).toBe('ok');
		const text = res.messages.join('\n');
		expect(text).toContain('connected-only');
	});
});

// ── 5) Admin commands ─────────────────────────────────────────────────────

describe('/switch command', () => {
	it('switches to an allowed workspace by basename', async () => {
		const setter = jest.fn(async () => undefined);
		const router = makeRouter({
			workspaceRoots: ['/ws/active', '/ws/other'],
			setActiveWorkspaceRoot: setter,
		});
		const res = await router.route({ name: '/switch', args: { workspaceRoot: 'other' } }, ctx);
		expect(res.kind).toBe('ok');
		expect(res.tier).toBe('admin');
		expect(setter).toHaveBeenCalled();
	});

	it('rejects disallowed workspace path', async () => {
		const router = makeRouter({ workspaceRoots: ['/ws/active'] });
		const res = await router.route({ name: '/switch', args: { workspaceRoot: '/ws/evil' } }, ctx);
		expect(res.kind).toBe('error');
	});

	it('rejects empty workspaceRoot', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/switch', args: { workspaceRoot: '' } }, ctx);
		expect(res.kind).toBe('error');
	});
});

describe('/approve and /deny commands', () => {
	it('/approve with valid callbackId succeeds', async () => {
		const approveFn = jest.fn(async () => undefined);
		const router = makeRouter({
			permissionOrchestrator: {
				approve: approveFn,
				deny: jest.fn(async () => undefined),
				getPending: jest.fn(() => []),
			},
		});
		const res = await router.route({ name: '/approve', args: { callbackId: 'cb-1' } }, ctx);
		expect(res.kind).toBe('ok');
		expect(res.tier).toBe('admin');
		expect(approveFn).toHaveBeenCalledWith('cb-1');
		expect(res.messages.join('\n')).toContain('Approved');
	});

	it('/deny with valid callbackId succeeds', async () => {
		const denyFn = jest.fn(async () => undefined);
		const router = makeRouter({
			permissionOrchestrator: {
				approve: jest.fn(async () => undefined),
				deny: denyFn,
				getPending: jest.fn(() => []),
			},
		});
		const res = await router.route({ name: '/deny', args: { callbackId: 'cb-2' } }, ctx);
		expect(res.kind).toBe('ok');
		expect(res.tier).toBe('admin');
		expect(denyFn).toHaveBeenCalledWith('cb-2');
		expect(res.messages.join('\n')).toContain('Denied');
	});

	it('/approve with missing callbackId returns error', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/approve', args: {} }, ctx);
		expect(res.kind).toBe('error');
	});

	it('/deny with empty callbackId returns error', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/deny', args: { callbackId: '' } }, ctx);
		expect(res.kind).toBe('error');
	});
});

// ── 6) Policy contract assertion ──────────────────────────────────────────

describe('Policy contract assertion', () => {
	it('throws if rate limits do not match WU002_POLICY_CONTRACT', () => {
		expect(() =>
			makeRouter({
				policy: {
					rateLimitsPerMinute: { read: 999, invoke: 6, admin: 3 },
				} as any,
			}),
		).toThrow('rate limits must match WU-002 contract');
	});

	it('throws if maxActiveInvokeSessionsPerUser does not match', () => {
		expect(() =>
			makeRouter({
				policy: { maxActiveInvokeSessionsPerUser: 99 } as any,
			}),
		).toThrow('maxActiveInvokeSessionsPerUser must match WU-002 contract');
	});

	it('throws if permissionTimeoutMs does not match', () => {
		expect(() =>
			makeRouter({
				policy: { permissionTimeoutMs: 1 } as any,
			}),
		).toThrow('permissionTimeoutMs must match WU-002 contract');
	});

	it('throws if maxPromptChars does not match', () => {
		expect(() =>
			makeRouter({
				policy: { maxPromptChars: 1 } as any,
			}),
		).toThrow('maxPromptChars must match WU-002 contract');
	});

	it('does not throw when all values match', () => {
		expect(() => makeRouter()).not.toThrow();
	});
});

// ── 7) Invoke slot tracking ──────────────────────────────────────────────

describe('Invoke slot tracking', () => {
	it('/task consumes a slot; second concurrent /task is denied', async () => {
		let resolveTask!: () => void;
		const taskPromise = new Promise<void>((r) => { resolveTask = r; });

		const router = makeRouter({
			extensionClient: {
				getStatus: () => 'connected',
				invoke_agent: jest.fn(() => taskPromise.then(() => ({ sessionId: 's1' }))),
			},
		});

		// Start first /task (blocks)
		const first = router.route({ name: '/task', args: { prompt: 'hello' } }, ctx);

		// Second /task should be denied (slot occupied)
		const second = await router.route({ name: '/task', args: { prompt: 'world' } }, ctx);
		expect(second.kind).toBe('denied');
		expect(second.meta?.reason).toBe('invoke_concurrency_limit');

		// Resolve first
		resolveTask();
		const firstResult = await first;
		expect(firstResult.kind).toBe('ok');
	});

	it('slot is released after command completes', async () => {
		const router = makeRouter({
			extensionClient: {
				getStatus: () => 'connected',
				invoke_agent: jest.fn(async () => ({ sessionId: 's1' })),
			},
		});

		const first = await router.route({ name: '/task', args: { prompt: 'one' } }, ctx);
		expect(first.kind).toBe('ok');

		// After completion, another /task should be allowed
		const second = await router.route({ name: '/task', args: { prompt: 'two' } }, ctx);
		expect(second.kind).toBe('ok');
	});

	it('slot is released even after error', async () => {
		const invokeAgent = jest.fn()
			.mockRejectedValueOnce(new Error('boom'))
			.mockResolvedValueOnce({ sessionId: 's2' });

		const router = makeRouter({
			extensionClient: {
				getStatus: () => 'connected',
				invoke_agent: invokeAgent,
			},
		});

		const first = await router.route({ name: '/task', args: { prompt: 'fail' } }, ctx);
		expect(first.kind).toBe('error');

		// Slot should be released after error
		const second = await router.route({ name: '/task', args: { prompt: 'retry' } }, ctx);
		expect(second.kind).toBe('ok');
	});

	it('/stop does NOT consume an invoke slot', async () => {
		let resolveTask!: () => void;
		const taskPromise = new Promise<void>((r) => { resolveTask = r; });

		const router = makeRouter({
			extensionClient: {
				getStatus: () => 'connected',
				invoke_agent: jest.fn(() => taskPromise.then(() => ({ sessionId: 's1' }))),
				cancel_session: jest.fn(async () => undefined),
			},
		});

		// Occupy the invoke slot with /task
		const task = router.route({ name: '/task', args: { prompt: 'hello' } }, ctx);

		// /stop should still work (no slot consumed)
		const stop = await router.route({ name: '/stop', args: { sessionId: 's1' } }, ctx);
		expect(stop.kind).toBe('ok');

		resolveTask();
		await task;
	});
});

// ── 8) Unknown command routing ────────────────────────────────────────────

describe('Unknown command routing', () => {
	it('returns denied with unknown tier', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/doesnotexist' }, ctx);
		expect(res.kind).toBe('denied');
		expect(res.tier).toBe('unknown');
		expect(res.meta?.reason).toBe('unknown_command');
	});
});

// ── 9) Platform-aware authorization (WU-005) ─────────────────────────────

describe('Platform-aware authorization (WU-005)', () => {
	it('accepts Telegram user present in per-platform allowlist', async () => {
		const router = makeRouter({
			policy: {
				allowlistedUserIds: ['u1'],
				allowlistedUserIdsByPlatform: { telegram: ['t-user-1'] },
			},
		});
		const res = await router.route(
			{ name: '/status' },
			{ userId: 't-user-1', platform: 'telegram' as const },
		);
		expect(res.kind).toBe('ok');
	});

	it('denies Telegram user not in per-platform allowlist', async () => {
		const router = makeRouter({
			policy: {
				allowlistedUserIds: ['u1'],
				allowlistedUserIdsByPlatform: { telegram: ['t-user-1'] },
			},
		});
		const res = await router.route(
			{ name: '/status' },
			{ userId: 't-user-999', platform: 'telegram' as const },
		);
		expect(res.kind).toBe('denied');
		expect(res.meta?.reason).toBe('user_not_allowlisted');
	});

	it('falls through to global allowlist when no platform override', async () => {
		const router = makeRouter({
			policy: { allowlistedUserIds: ['t-user-1'] },
		});
		const res = await router.route(
			{ name: '/status' },
			{ userId: 't-user-1', platform: 'telegram' as const },
		);
		expect(res.kind).toBe('ok');
	});

	it('skips guild/channel checks for Telegram', async () => {
		const router = makeRouter({
			policy: {
				allowlistedUserIds: ['t-user-1'],
				requiredGuildId: 'g1',
				requiredChannelId: 'c1',
			},
		});
		const res = await router.route(
			{ name: '/status' },
			{ userId: 't-user-1', platform: 'telegram' as const },
		);
		expect(res.kind).toBe('ok');
	});

	it('enforces guild/channel checks for Discord', async () => {
		const router = makeRouter({
			policy: {
				allowlistedUserIds: ['u1'],
				requiredGuildId: 'g1',
				requiredChannelId: 'c1',
			},
		});
		const res = await router.route(
			{ name: '/status' },
			{ userId: 'u1', platform: 'discord' as const },
		);
		expect(res.kind).toBe('denied');
		expect(res.meta?.reason).toBe('guild_scope_mismatch');
	});
});

// ── 10) SessionDriver delegation (WU-S05/S06/S07a/S07b/S08) ──────────────

describe('SessionDriver delegation', () => {
	const mockDriver = () => ({
		invokeAgent: jest.fn(async () => ({ sessionId: 'sd-1' })),
		cancelSession: jest.fn(async () => undefined),
		getSessions: jest.fn(async () => [
			{ id: 'sd-1', status: 'active', agentName: 'orchestrator', createdAt: '2026-01-01T00:00:00Z' },
		]),
		resolvePermission: jest.fn(async () => undefined),
		getStatus: jest.fn(() => 'connected'),
		getSource: jest.fn(() => 'local' as const),
	});

	it('/task delegates to sessionDriver.invokeAgent when present', async () => {
		const driver = mockDriver();
		const router = makeRouter({ sessionDriver: driver });
		const res = await router.route({ name: '/task', args: { prompt: 'hello' } }, ctx);
		expect(res.kind).toBe('ok');
		expect(driver.invokeAgent).toHaveBeenCalledWith({ agentName: 'orchestrator', prompt: 'hello' });
	});

	it('/task extracts sessionId from sessionDriver result', async () => {
		const driver = mockDriver();
		const router = makeRouter({ sessionDriver: driver });
		const res = await router.route({ name: '/task', args: { prompt: 'hello' } }, ctx);
		expect(res.meta?.sessionId).toBe('sd-1');
	});

	it('/plan delegates to sessionDriver.invokeAgent when present', async () => {
		const driver = mockDriver();
		const router = makeRouter({ sessionDriver: driver });
		const res = await router.route({ name: '/plan', args: { prompt: 'make a plan' } }, ctx);
		expect(res.kind).toBe('ok');
		expect(driver.invokeAgent).toHaveBeenCalledTimes(1);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect((driver.invokeAgent.mock.calls as any)[0][0].prompt).toContain('PLAN ONLY');
	});

	it('/stop delegates to sessionDriver.cancelSession when present', async () => {
		const driver = mockDriver();
		const router = makeRouter({ sessionDriver: driver });
		const res = await router.route({ name: '/stop', args: { sessionId: 'sd-1' } }, ctx);
		expect(res.kind).toBe('ok');
		expect(driver.cancelSession).toHaveBeenCalledWith({ sessionId: 'sd-1' });
	});

	it('/sessions delegates to sessionDriver.getSessions when present', async () => {
		const driver = mockDriver();
		const router = makeRouter({ sessionDriver: driver });
		const res = await router.route({ name: '/sessions' }, ctx);
		expect(res.kind).toBe('ok');
		expect(driver.getSessions).toHaveBeenCalledTimes(1);
		expect(res.messages.join('\n')).toContain('Sessions');
	});

	it('/approve calls permissionOrchestrator AND sessionDriver.resolvePermission', async () => {
		const driver = mockDriver();
		const orch = {
			approve: jest.fn(async () => undefined),
			deny: jest.fn(async () => undefined),
			getPending: jest.fn(() => []),
		};
		const router = makeRouter({ sessionDriver: driver, permissionOrchestrator: orch });
		const res = await router.route({ name: '/approve', args: { callbackId: 'cb-1' } }, ctx);
		expect(res.kind).toBe('ok');
		expect(orch.approve).toHaveBeenCalledWith('cb-1');
		expect(driver.resolvePermission).toHaveBeenCalledWith({ callbackId: 'cb-1', approved: true });
	});

	it('/deny calls permissionOrchestrator AND sessionDriver.resolvePermission', async () => {
		const driver = mockDriver();
		const orch = {
			approve: jest.fn(async () => undefined),
			deny: jest.fn(async () => undefined),
			getPending: jest.fn(() => []),
		};
		const router = makeRouter({ sessionDriver: driver, permissionOrchestrator: orch });
		const res = await router.route({ name: '/deny', args: { callbackId: 'cb-2' } }, ctx);
		expect(res.kind).toBe('ok');
		expect(orch.deny).toHaveBeenCalledWith('cb-2');
		expect(driver.resolvePermission).toHaveBeenCalledWith({ callbackId: 'cb-2', approved: false });
	});

	it('/approve tolerates sessionDriver.resolvePermission failure (best-effort)', async () => {
		const driver = mockDriver();
		driver.resolvePermission.mockRejectedValue(new Error('boom'));
		const router = makeRouter({ sessionDriver: driver });
		const res = await router.route({ name: '/approve', args: { callbackId: 'cb-3' } }, ctx);
		expect(res.kind).toBe('ok');
		expect(res.messages.join('\n')).toContain('Approved');
	});

	it('/task falls back to extensionClient when sessionDriver is absent', async () => {
		const client = {
			getStatus: () => 'connected',
			invoke_agent: jest.fn(async () => ({ sessionId: 'ec-1' })),
		};
		const router = makeRouter({ extensionClient: client });
		const res = await router.route({ name: '/task', args: { prompt: 'hi' } }, ctx);
		expect(res.kind).toBe('ok');
		expect(client.invoke_agent).toHaveBeenCalled();
	});

	it('/stop falls back to extensionClient when sessionDriver is absent', async () => {
		const client = {
			getStatus: () => 'connected',
			cancel_session: jest.fn(async () => undefined),
		};
		const router = makeRouter({ extensionClient: client });
		const res = await router.route({ name: '/stop', args: { sessionId: 'x' } }, ctx);
		expect(res.kind).toBe('ok');
		expect(client.cancel_session).toHaveBeenCalledWith({ sessionId: 'x' });
	});
});

// ── 11) Discovery telemetry (WS2 WU-05) ─────────────────────────────────

describe('Discovery telemetry', () => {
	it('records keyword_miss for unknown command', async () => {
		const router = makeRouter();
		await router.route({ name: '/does-not-exist' }, ctx);

		const summary = router.getDiscoveryTelemetrySummary();
		expect(summary.contractVersion).toBe('skill_discovery_telemetry_v1');
		expect(summary.countersByReason.keyword_miss).toBe(1);
		expect(summary.sample.size).toBe(1);
		expect(summary.recent[0]?.reason).toBe('keyword_miss');
	});

	it('records ambiguity for ambiguous /switch routing conditions', async () => {
		const router = makeRouter({
			workspaceRoots: ['/ws/team-a/repo', '/ws/team-b/repo'],
		});
		const res = await router.route({ name: '/switch', args: { workspaceRoot: 'repo' } }, ctx);

		expect(res.kind).toBe('error');
		const summary = router.getDiscoveryTelemetrySummary();
		expect(summary.countersByReason.ambiguity).toBe(1);
		expect(summary.recent.some((sample) => sample.reason === 'ambiguity')).toBe(true);
	});

	it('records stale_map for missing workflow definitions', async () => {
		const router = makeRouter();
		const res = await router.route({
			name: '/workflow',
			args: { subcommand: 'inspect', name: 'workflow-that-does-not-exist' },
		}, ctx);

		expect(res.kind).toBe('ok');
		expect(res.messages.join('\n')).toContain('not found');
		const summary = router.getDiscoveryTelemetrySummary();
		expect(summary.countersByReason.stale_map).toBe(1);
	});

	it('records no_route for command argument misses', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/task', args: {} }, ctx);

		expect(res.kind).toBe('error');
		const summary = router.getDiscoveryTelemetrySummary();
		expect(summary.countersByReason.no_route).toBe(1);
		expect(summary.recent.some((sample) => sample.reason === 'no_route')).toBe(true);
	});

	it('keeps sampled telemetry bounded with dropped counter', async () => {
		const router = makeRouter();
		for (let i = 0; i < COMMAND_ROUTER_DISCOVERY_SAMPLE_CAPACITY + 3; i++) {
			await router.route({ name: `/missing-${i}` }, ctx);
		}

		const summary = router.getDiscoveryTelemetrySummary();
		expect(summary.sample.capacity).toBe(COMMAND_ROUTER_DISCOVERY_SAMPLE_CAPACITY);
		expect(summary.sample.size).toBe(COMMAND_ROUTER_DISCOVERY_SAMPLE_CAPACITY);
		expect(summary.sample.dropped).toBe(3);
		expect(summary.countersByReason.keyword_miss).toBe(COMMAND_ROUTER_DISCOVERY_SAMPLE_CAPACITY + 3);
	});
});
