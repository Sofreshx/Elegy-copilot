import { CommandRouter, WU002_POLICY_CONTRACT, type CommandRouterPolicy } from '../commandRouter';
import { getDefaultGatewayCommandSpecs } from '../commandSpecs';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockGitSnapshot = jest.fn().mockResolvedValue({
	repoName: 'repo',
	branch: 'main',
	ahead: 0,
	behind: 0,
	modified: 0,
	untracked: 0,
	staged: 0,
});

jest.mock('../gitSnapshot', () => ({
	getWorkspaceGitSnapshot: (...args: any[]) => mockGitSnapshot(...args),
}));

const mockTemplates = new Map<string, any>();

jest.mock('../workflows/workflowLoader', () => ({
	loadAllWorkflowTemplates: () => mockTemplates,
}));

jest.mock('../workflows/workflowRuntime', () => ({
	executeWorkflow: jest.fn(async (def: any, executor: any) => {
		const stepResults = [];
		for (const step of def.steps) {
			stepResults.push({ stepId: step.id, status: 'success', durationMs: 1 });
		}
		return { workflowId: def.id, status: 'completed', startedAtMs: 0, completedAtMs: 1, steps: stepResults };
	}),
}));

// ── Helpers ───────────────────────────────────────────────────────────────

const BASE_POLICY = {
	allowlistedUserIds: ['u1'],
	rateLimitsPerMinute: WU002_POLICY_CONTRACT.rateLimitsPerMinute,
	maxActiveInvokeSessionsPerUser: WU002_POLICY_CONTRACT.maxActiveInvokeSessionsPerUser,
	permissionTimeoutMs: WU002_POLICY_CONTRACT.permissionTimeoutMs,
	maxPromptChars: WU002_POLICY_CONTRACT.maxPromptChars,
};

function makeRouter(overrides?: { policy?: Partial<CommandRouterPolicy> }) {
	return new CommandRouter({
		policy: { ...BASE_POLICY, ...overrides?.policy },
		workspaces: {
			getActiveWorkspaceRoot: () => '/ws/active',
			getAllowedWorkspaceRoots: () => ['/ws/active'],
			setActiveWorkspaceRoot: jest.fn(async () => undefined),
		},
		auditLogger: { log: jest.fn() } as any,
		permissionOrchestrator: {
			approve: jest.fn(async () => undefined),
			deny: jest.fn(async () => undefined),
			getPending: jest.fn(() => []),
		} as any,
		nowMs: () => 0,
	});
}

const ctx = { userId: 'u1', platform: 'discord' as const };

// ── Tests ─────────────────────────────────────────────────────────────────

beforeEach(() => {
	mockTemplates.clear();
});

describe('/workflow command', () => {
	it('/workflow list returns list of templates', async () => {
		mockTemplates.set('deploy-prod', {
			id: 'deploy-prod',
			name: 'Deploy Production',
			description: 'Full deploy pipeline',
			version: '1.0.0',
			steps: [{ id: 's1', name: 'Build', action: 'build', dependsOn: [] }],
		});
		mockTemplates.set('test-suite', {
			id: 'test-suite',
			name: 'Test Suite',
			version: '1.0.0',
			steps: [{ id: 's1', name: 'Test', action: 'test', dependsOn: [] }],
		});
		mockTemplates.set('lint-all', {
			id: 'lint-all',
			name: 'Lint All',
			description: 'Run linters',
			version: '1.0.0',
			steps: [{ id: 's1', name: 'Lint', action: 'lint', dependsOn: [] }],
		});

		const router = makeRouter();
		const res = await router.route({ name: '/workflow', args: { subcommand: 'list' } }, ctx);
		expect(res.kind).toBe('ok');
		const text = res.messages.join('\n');
		expect(text).toContain('Available Workflows');
		expect(text).toContain('deploy-prod');
		expect(text).toContain('test-suite');
		expect(text).toContain('lint-all');
	});

	it('/workflow run with valid name returns execution results', async () => {
		mockTemplates.set('deploy-prod', {
			id: 'deploy-prod',
			name: 'Deploy Production',
			version: '1.0.0',
			steps: [
				{ id: 'build', name: 'Build', action: 'build', dependsOn: [] },
				{ id: 'deploy', name: 'Deploy', action: 'deploy', dependsOn: ['build'] },
			],
		});

		const router = makeRouter();
		const res = await router.route({ name: '/workflow', args: { subcommand: 'run', name: 'deploy-prod' } }, ctx);
		expect(res.kind).toBe('ok');
		const text = res.messages.join('\n');
		expect(text).toContain('Workflow: Deploy Production');
		expect(text).toContain('completed');
		expect(text).toContain('build');
		expect(text).toContain('deploy');
	});

	it('/workflow run with invalid name returns not-found', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/workflow', args: { subcommand: 'run', name: 'nope' } }, ctx);
		expect(res.kind).toBe('ok');
		const text = res.messages.join('\n');
		expect(text).toContain('not found');
		expect(text).toContain('/workflow list');
	});

	it('/workflow run without name returns usage hint', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/workflow', args: { subcommand: 'run' } }, ctx);
		expect(res.kind).toBe('ok');
		const text = res.messages.join('\n');
		expect(text).toContain('Usage');
		expect(text).toContain('/workflow run');
	});

	it('getCommandTier returns admin for /workflow', () => {
		const router = makeRouter();
		expect(router.getCommandTier('/workflow')).toBe('admin');
	});

	it('/workflow with invalid subcommand returns error', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/workflow', args: { subcommand: 'bad' } }, ctx);
		expect(res.kind).toBe('error');
	});

	it('/workflow is in the command specs', () => {
		const specs = getDefaultGatewayCommandSpecs();
		const wf = specs.find(s => s.name === '/workflow');
		expect(wf).toBeDefined();
		expect(wf!.tier).toBe('admin');
		expect(wf!.options).toHaveLength(2);
	});
});
