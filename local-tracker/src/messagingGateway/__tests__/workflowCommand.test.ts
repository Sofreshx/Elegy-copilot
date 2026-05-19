import { CommandRouter, WU002_POLICY_CONTRACT, type CommandRouterPolicy } from '../commandRouter';
import { getDefaultGatewayCommandSpecs } from '../commandSpecs';
import { executeWorkflow } from '../workflows/workflowRuntime';
import type { WorkflowStreamingModule } from '../workflows/workflowStreaming';

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
	loadWorkflowTemplate: jest.fn(),
}));

jest.mock('../workflows/workflowRuntime', () => ({
	executeWorkflow: jest.fn(async (def: any, executor: any, _context: any, observer: any) => {
		if (observer?.onRunStarted) {
			await observer.onRunStarted({
				workflowId: def.id,
				workflowName: def.name,
				stepCount: def.steps.length,
				startedAtMs: 0,
			});
		}
		const stepResults = [];
		for (const step of def.steps) {
			if (observer?.onStepStarted) {
				await observer.onStepStarted({
					workflowId: def.id,
					stepId: step.id,
					stepName: step.name,
					action: step.action,
				});
			}
			stepResults.push({ stepId: step.id, status: 'success', durationMs: 1 });
			if (observer?.onStepCompleted) {
				await observer.onStepCompleted({
					workflowId: def.id,
					stepId: step.id,
					status: 'success',
					durationMs: 1,
				});
			}
		}
		const result = { workflowId: def.id, status: 'completed', startedAtMs: 0, completedAtMs: 1, steps: stepResults };
		if (observer?.onRunCompleted) {
			await observer.onRunCompleted({ workflowId: def.id, result });
		}
		return result;
	}),
}));

const mockedExecuteWorkflow = executeWorkflow as jest.MockedFunction<typeof executeWorkflow>;

jest.mock('../workflows/executors', () => ({
	createDefaultRegistry: jest.fn(() => ({
		toStepExecutor: jest.fn(() => jest.fn()),
	})),
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
	workflowHistory?: any;
	workflowStreaming?: WorkflowStreamingModule;
}) {
	return new CommandRouter({
		policy: { ...BASE_POLICY, ...overrides?.policy },
		workspaces: {
			getActiveWorkspaceRoot: () => '/ws/active',
			getAllowedWorkspaceRoots: () => ['/ws/active'],
			setActiveWorkspaceRoot: jest.fn(async () => undefined),
		},
		auditLogger: { log: jest.fn() } as any,
		extensionClient: {
			start: jest.fn(),
			stop: jest.fn(async () => undefined),
			getStatus: jest.fn(() => 'connected' as const),
			get_sessions: jest.fn(async () => []),
			invoke_agent: jest.fn(async () => ({})),
			cancel_session: jest.fn(async () => ({})),
			resolve_permission: jest.fn(async () => ({})),
		} as any,
		permissionOrchestrator: {
			approve: jest.fn(async () => undefined),
			deny: jest.fn(async () => undefined),
			getPending: jest.fn(() => []),
		} as any,
		workflowHistory: overrides?.workflowHistory,
		workflowStreaming: overrides?.workflowStreaming,
		nowMs: () => 0,
	});
}

const ctx = { userId: 'u1', platform: 'discord' as const };

// ── Tests ─────────────────────────────────────────────────────────────────

beforeEach(() => {
	mockTemplates.clear();
	mockedExecuteWorkflow.mockClear();
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

	it('/workflow run wires streaming observer path and exposes runId', async () => {
		mockTemplates.set('deploy-prod', {
			id: 'deploy-prod',
			name: 'Deploy Production',
			version: '1.0.0',
			steps: [{ id: 'build', name: 'Build', action: 'build', dependsOn: [] }],
		});

		const observer = {
			onRunStarted: jest.fn(),
			onStepStarted: jest.fn(),
			onStepCompleted: jest.fn(),
			onRunCompleted: jest.fn(),
		};
		const workflowStreaming = {
			createRunContext: jest.fn(() => ({ runId: 'run-stream-1', observer })),
			publishRunFailure: jest.fn(),
			getBacklogSnapshot: jest.fn(() => ({ events: [], droppedCount: 0 })),
			subscribe: jest.fn(),
			unsubscribe: jest.fn(),
		} as unknown as WorkflowStreamingModule;

		const router = makeRouter({ workflowStreaming });
		const res = await router.route({ name: '/workflow', args: { subcommand: 'run', name: 'deploy-prod' } }, ctx);

		expect(res.kind).toBe('ok');
		expect(workflowStreaming.createRunContext).toHaveBeenCalledWith(expect.objectContaining({ id: 'deploy-prod' }));
		expect(mockedExecuteWorkflow).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'deploy-prod' }),
			expect.any(Function),
			expect.objectContaining({ workflowId: 'deploy-prod' }),
			observer,
		);
		expect(res.meta?.runId).toBe('run-stream-1');
		expect(res.messages.join('\n')).toContain('Run ID: `run-stream-1`');
	});

	it('/workflow run publishes run failure when executeWorkflow throws', async () => {
		mockTemplates.set('deploy-prod', {
			id: 'deploy-prod',
			name: 'Deploy Production',
			version: '1.0.0',
			steps: [{ id: 'build', name: 'Build', action: 'build', dependsOn: [] }],
		});

		const observer = {
			onRunStarted: jest.fn(),
			onStepStarted: jest.fn(),
			onStepCompleted: jest.fn(),
			onRunCompleted: jest.fn(),
		};
		const workflowStreaming = {
			createRunContext: jest.fn(() => ({ runId: 'run-stream-fail', observer })),
			publishRunFailure: jest.fn(),
			getBacklogSnapshot: jest.fn(() => ({ events: [], droppedCount: 0 })),
			subscribe: jest.fn(),
			unsubscribe: jest.fn(),
		} as unknown as WorkflowStreamingModule;

		mockedExecuteWorkflow.mockRejectedValueOnce(new Error('runtime crashed'));

		const router = makeRouter({ workflowStreaming });
		const res = await router.route({ name: '/workflow', args: { subcommand: 'run', name: 'deploy-prod' } }, ctx);

		expect(res.kind).toBe('error');
		expect(workflowStreaming.publishRunFailure).toHaveBeenCalledWith({
			runId: 'run-stream-fail',
			workflowId: 'deploy-prod',
			error: expect.any(Error),
		});
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
		expect(wf!.options).toHaveLength(3);
	});
});

describe('/workflow history', () => {
	it('returns usage hint when no name provided', async () => {
		const router = makeRouter({ workflowHistory: { readRecent: jest.fn(), append: jest.fn() } });
		const res = await router.route({ name: '/workflow', args: { subcommand: 'history' } }, ctx);
		expect(res.kind).toBe('ok');
		expect(res.messages.join('\n')).toContain('Usage');
	});

	it('returns not-enabled when workflowHistory dep is missing', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/workflow', args: { subcommand: 'history', name: 'deploy-prod' } }, ctx);
		expect(res.kind).toBe('ok');
		expect(res.messages.join('\n')).toContain('not enabled');
	});

	it('returns empty message when no history found', async () => {
		const mockHistory = { readRecent: jest.fn().mockReturnValue([]), append: jest.fn() };
		const router = makeRouter({ workflowHistory: mockHistory });
		const res = await router.route({ name: '/workflow', args: { subcommand: 'history', name: 'deploy-prod' } }, ctx);
		expect(res.kind).toBe('ok');
		expect(res.messages.join('\n')).toContain('No history found');
	});

	it('returns history entries', async () => {
		const entries = [
			{ workflowId: 'deploy-prod', status: 'completed', startedAtMs: 1000, completedAtMs: 2000, steps: [] },
			{ workflowId: 'deploy-prod', status: 'failed', startedAtMs: 3000, completedAtMs: 4500, steps: [] },
		];
		const mockHistory = { readRecent: jest.fn().mockReturnValue(entries), append: jest.fn() };
		const router = makeRouter({ workflowHistory: mockHistory });
		const res = await router.route({ name: '/workflow', args: { subcommand: 'history', name: 'deploy-prod' } }, ctx);
		expect(res.kind).toBe('ok');
		const text = res.messages.join('\n');
		expect(text).toContain('Workflow History: deploy-prod');
		expect(text).toContain('2 recent runs');
		expect(text).toContain('completed');
		expect(text).toContain('failed');
		expect(text).toContain('1000ms');
	});

	it('passes custom limit to readRecent', async () => {
		const mockHistory = { readRecent: jest.fn().mockReturnValue([]), append: jest.fn() };
		const router = makeRouter({ workflowHistory: mockHistory });
		await router.route({ name: '/workflow', args: { subcommand: 'history', name: 'deploy-prod', limit: 5 } }, ctx);
		expect(mockHistory.readRecent).toHaveBeenCalledWith('deploy-prod', 5);
	});
});

describe('/workflow inspect', () => {
	it('returns usage hint when no name provided', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/workflow', args: { subcommand: 'inspect' } }, ctx);
		expect(res.kind).toBe('ok');
		expect(res.messages.join('\n')).toContain('Usage');
	});

	it('returns not-found for unknown workflow', async () => {
		const router = makeRouter();
		const res = await router.route({ name: '/workflow', args: { subcommand: 'inspect', name: 'nope' } }, ctx);
		expect(res.kind).toBe('ok');
		expect(res.messages.join('\n')).toContain('not found');
	});

	it('returns workflow details with steps', async () => {
		mockTemplates.set('deploy-prod', {
			id: 'deploy-prod',
			name: 'Deploy Production',
			description: 'Full deploy pipeline',
			version: '2.1.0',
			steps: [
				{ id: 'build', name: 'Build', action: 'build', dependsOn: [] },
				{ id: 'deploy', name: 'Deploy', action: 'deploy', dependsOn: ['build'] },
			],
		});

		const router = makeRouter();
		const res = await router.route({ name: '/workflow', args: { subcommand: 'inspect', name: 'deploy-prod' } }, ctx);
		expect(res.kind).toBe('ok');
		const text = res.messages.join('\n');
		expect(text).toContain('Workflow: Deploy Production');
		expect(text).toContain('v2.1.0');
		expect(text).toContain('Full deploy pipeline');
		expect(text).toContain('Steps');
		expect(text).toContain('build');
		expect(text).toContain('deploy');
		expect(text).toContain('depends on: build');
	});
});

describe('/workflow run with history', () => {
	it('appends to history on successful run', async () => {
		mockTemplates.set('deploy-prod', {
			id: 'deploy-prod',
			name: 'Deploy Production',
			version: '1.0.0',
			steps: [{ id: 'build', name: 'Build', action: 'build', dependsOn: [] }],
		});
		const mockHistory = { readRecent: jest.fn(), append: jest.fn() };
		const router = makeRouter({ workflowHistory: mockHistory });
		await router.route({ name: '/workflow', args: { subcommand: 'run', name: 'deploy-prod' } }, ctx);
		expect(mockHistory.append).toHaveBeenCalledTimes(1);
		expect(mockHistory.append).toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'deploy-prod' }));
	});

	it('does not fail when history append throws', async () => {
		mockTemplates.set('deploy-prod', {
			id: 'deploy-prod',
			name: 'Deploy Production',
			version: '1.0.0',
			steps: [{ id: 'build', name: 'Build', action: 'build', dependsOn: [] }],
		});
		const mockHistory = { readRecent: jest.fn(), append: jest.fn().mockImplementation(() => { throw new Error('disk full'); }) };
		const router = makeRouter({ workflowHistory: mockHistory });
		const res = await router.route({ name: '/workflow', args: { subcommand: 'run', name: 'deploy-prod' } }, ctx);
		expect(res.kind).toBe('ok');
	});

	it('does not append when no history dep', async () => {
		mockTemplates.set('deploy-prod', {
			id: 'deploy-prod',
			name: 'Deploy Production',
			version: '1.0.0',
			steps: [{ id: 'build', name: 'Build', action: 'build', dependsOn: [] }],
		});
		const router = makeRouter();
		const res = await router.route({ name: '/workflow', args: { subcommand: 'run', name: 'deploy-prod' } }, ctx);
		expect(res.kind).toBe('ok');
	});
});
