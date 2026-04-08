import { ActionRegistry, ActionNotFoundError, ActionExecutor } from '../workflows/actionRegistry';
import type { WorkflowStep } from '../workflows/workflowSchema';
import { registerDevExecutors } from '../workflows/executors/devExecutors';
import { registerGitExecutors } from '../workflows/executors/gitExecutors';
import { registerSessionExecutors } from '../workflows/executors/sessionExecutors';
import type { BridgeClient } from '../bridgeClient';

function step(id: string, action: string, params?: Record<string, unknown>): WorkflowStep {
    return { id, name: `Step ${id}`, action, type: 'action', streaming: false, dependsOn: [], params };
}

describe('ActionRegistry', () => {
    let registry: ActionRegistry;

    beforeEach(() => {
        registry = new ActionRegistry();
    });

    it('register + get round-trip works', async () => {
        const exec: ActionExecutor = jest.fn(async () => 'ok');
        registry.register('my.action', exec);
        expect(registry.get('my.action')).toBe(exec);
    });

    it('register duplicate throws Error', () => {
        registry.register('dup', jest.fn());
        expect(() => registry.register('dup', jest.fn())).toThrow('already registered');
    });

    it('get missing action throws ActionNotFoundError with correct actionName', () => {
        try {
            registry.get('no-such-action');
            fail('expected ActionNotFoundError');
        } catch (err) {
            expect(err).toBeInstanceOf(ActionNotFoundError);
            expect((err as ActionNotFoundError).actionName).toBe('no-such-action');
        }
    });

    it('has returns true for registered actions', () => {
        registry.register('exists', jest.fn());
        expect(registry.has('exists')).toBe(true);
    });

    it('has returns false for unregistered actions', () => {
        expect(registry.has('nope')).toBe(false);
    });

    it('toStepExecutor returns function that calls registered executor', async () => {
        const exec: ActionExecutor = jest.fn(async () => 42);
        registry.register('calc', exec);

        const stepExec = registry.toStepExecutor();
        const s = step('s1', 'calc');
        const ctx = { foo: 'bar' };
        const result = await stepExec(s, ctx);

        expect(exec).toHaveBeenCalledWith(s, ctx);
        expect(result).toBe(42);
    });

    it('toStepExecutor with unregistered action throws ActionNotFoundError', async () => {
        const stepExec = registry.toStepExecutor();
        try {
            await stepExec(step('s1', 'missing'), {});
            fail('expected ActionNotFoundError');
        } catch (err) {
            expect(err).toBeInstanceOf(ActionNotFoundError);
            expect((err as ActionNotFoundError).actionName).toBe('missing');
        }
    });

    it('getRegisteredActions returns sorted list', () => {
        registry.register('z.last', jest.fn());
        registry.register('a.first', jest.fn());
        registry.register('m.middle', jest.fn());
        expect(registry.getRegisteredActions()).toEqual(['a.first', 'm.middle', 'z.last']);
    });
});

describe('registerDevExecutors', () => {
    it('registers all dev actions and returns deterministic structured output', async () => {
        const registry = new ActionRegistry();
        registerDevExecutors(registry);

        expect(registry.has('dev.research')).toBe(true);
        expect(registry.has('dev.plan')).toBe(true);
        expect(registry.has('dev.review')).toBe(true);
        expect(registry.has('dev.implement')).toBe(true);
        expect(registry.has('dev.test')).toBe(true);
        expect(registry.has('dev.analyze-session')).toBe(true);

        const nowMs = 1700000000123;
        const result = await registry.get('dev.research')(
            step('s-research', 'dev.research', { topic: 'workflow-gaps' }),
            {
                workflowId: 'wf-compat',
                sessionId: 'ses-42',
                requestId: 'req-99',
                nowMs,
            },
        );

        expect(result).toEqual({
            action: 'dev.research',
            stepId: 's-research',
            stepName: 'Step s-research',
            timestampMs: nowMs,
            params: { topic: 'workflow-gaps' },
            context: {
                workflowId: 'wf-compat',
                sessionId: 'ses-42',
                requestId: 'req-99',
            },
        });

        const implementResult = await registry.get('dev.implement')(
            step('s-implement', 'dev.implement', { ticket: 'G-05-WU-03', dryRun: true }),
            {
                workflowId: 'wf-compat',
                sessionId: 'ses-42',
                requestId: 'req-99',
                nowMs: nowMs + 1,
            },
        );

        expect(implementResult).toEqual({
            action: 'dev.implement',
            stepId: 's-implement',
            stepName: 'Step s-implement',
            timestampMs: nowMs + 1,
            params: { ticket: 'G-05-WU-03', dryRun: true },
            context: {
                workflowId: 'wf-compat',
                sessionId: 'ses-42',
                requestId: 'req-99',
            },
        });

        const testResult = await registry.get('dev.test')(
            step('s-test', 'dev.test', { suite: 'registry', runInBand: true }),
            {
                workflowId: 'wf-compat',
                sessionId: 'ses-42',
                requestId: 'req-99',
                nowMs: nowMs + 2,
            },
        );

        expect(testResult).toEqual({
            action: 'dev.test',
            stepId: 's-test',
            stepName: 'Step s-test',
            timestampMs: nowMs + 2,
            params: { suite: 'registry', runInBand: true },
            context: {
                workflowId: 'wf-compat',
                sessionId: 'ses-42',
                requestId: 'req-99',
            },
        });

        const analyzeSessionResult = await registry.get('dev.analyze-session')(
            step('s-analyze', 'dev.analyze-session', { includeArtifacts: true, window: '24h' }),
            {
                workflowId: 'wf-compat',
                sessionId: 'ses-42',
                requestId: 'req-99',
                nowMs: nowMs + 3,
            },
        );

        expect(analyzeSessionResult).toEqual({
            action: 'dev.analyze-session',
            stepId: 's-analyze',
            stepName: 'Step s-analyze',
            timestampMs: nowMs + 3,
            params: { includeArtifacts: true, window: '24h' },
            context: {
                workflowId: 'wf-compat',
                sessionId: 'ses-42',
                requestId: 'req-99',
            },
        });
    });
});

describe('registerGitExecutors', () => {
    it('registers git.merge-prs action', () => {
        const registry = new ActionRegistry();
        registerGitExecutors(registry);

        expect(registry.has('git.merge-prs')).toBe(true);
    });

    it('allows whitelisted read-only commands', async () => {
        const registry = new ActionRegistry();
        registerGitExecutors(registry);

        const result = await registry.get('git.state-analysis')(
            step('s-git', 'git.state-analysis', {
                command: 'status --short',
                repositoryPath: '/workspace/repo',
            }),
            {
                workflowId: 'wf-review',
                sessionId: 'ses-7',
                nowMs: 1710000000000,
            },
        );

        expect(result).toEqual(
            expect.objectContaining({
                action: 'git.state-analysis',
                stepId: 's-git',
                requestedCommand: 'status --short',
                requestedToken: 'status',
                blocked: false,
            }),
        );
        expect(result).toEqual(
            expect.objectContaining({
                whitelist: ['status', 'log', 'diff', 'branch', 'remote', 'show', 'rev-parse', 'ls-files'],
            }),
        );
    });

    it('blocks non-whitelisted commands with reason', async () => {
        const registry = new ActionRegistry();
        registerGitExecutors(registry);

        const result = await registry.get('git.state-analysis')(
            step('s-git-block', 'git.state-analysis', { command: 'push origin main' }),
            { nowMs: 1710000000100 },
        );

        expect(result).toEqual(
            expect.objectContaining({
                action: 'git.state-analysis',
                requestedToken: 'push',
                blocked: true,
            }),
        );
        expect((result as { reason?: string }).reason).toContain('not in read-only whitelist');
    });

    it('returns deterministic merge-prs output with safe defaults', async () => {
        const registry = new ActionRegistry();
        registerGitExecutors(registry);

        const result = await registry.get('git.merge-prs')(
            step('s-merge', 'git.merge-prs', {
                command: 'merge --ff-only',
                mergeRequests: ['#12', { prNumber: 44 }, { ref: 'feature/abc' }, 77],
                repositoryPath: '/workspace/repo',
            }),
            {
                workflowId: 'wf-merge',
                sessionId: 'ses-merge',
                nowMs: 1710000000200,
            },
        );

        expect(result).toEqual(
            expect.objectContaining({
                action: 'git.merge-prs',
                stepId: 's-merge',
                timestampMs: 1710000000200,
                requestedCommand: 'merge --ff-only',
                requestedToken: 'merge',
                whitelist: ['merge', 'checkout', 'pull', 'push'],
                dryRun: true,
                timeoutMsPerMerge: 120000,
                mergeCap: 10,
                mergeRequests: ['#12', '44', 'feature/abc', '77'],
                blocked: false,
                context: {
                    repositoryPath: '/workspace/repo',
                    workflowId: 'wf-merge',
                    sessionId: 'ses-merge',
                },
            }),
        );
    });

    it('blocks merge-prs when command token is not whitelisted', async () => {
        const registry = new ActionRegistry();
        registerGitExecutors(registry);

        const result = await registry.get('git.merge-prs')(
            step('s-merge-block', 'git.merge-prs', {
                command: 'fetch origin',
                mergeRequests: ['123'],
            }),
            { nowMs: 1710000000300 },
        );

        expect(result).toEqual(
            expect.objectContaining({
                action: 'git.merge-prs',
                requestedToken: 'fetch',
                blocked: true,
            }),
        );
        expect((result as { reason?: string }).reason).toContain('not in merge whitelist');
    });

    it('blocks merge-prs when merge request count exceeds cap', async () => {
        const registry = new ActionRegistry();
        registerGitExecutors(registry);

        const mergeRequests = Array.from({ length: 11 }, (_, index) => index + 1);
        const result = await registry.get('git.merge-prs')(
            step('s-merge-cap', 'git.merge-prs', {
                command: 'pull origin main',
                mergeRequests,
            }),
            { nowMs: 1710000000400 },
        );

        expect(result).toEqual(
            expect.objectContaining({
                action: 'git.merge-prs',
                requestedToken: 'pull',
                mergeCap: 10,
                blocked: true,
            }),
        );
        expect((result as { reason?: string }).reason).toContain('exceeds cap 10');
    });
});

describe('registerSessionExecutors', () => {
    function createBridgeClient(): BridgeClient {
        return {
            start: jest.fn(),
            stop: jest.fn(async () => undefined),
            getStatus: jest.fn(() => 'connected' as const),
            get_sessions: jest.fn(async () => []),
            invoke_agent: jest.fn(async () => ({ sessionId: 'ses-new' })),
            cancel_session: jest.fn(async () => ({ cancelled: true })),
            resolve_permission: jest.fn(async () => ({ resolved: true })),
        };
    }

    it('fails closed when session.stop is missing a bound session id', async () => {
        const bridgeClient = createBridgeClient();
        const registry = new ActionRegistry();
        registerSessionExecutors(registry, bridgeClient);

        await expect(
            registry.get('session.stop')(step('s-stop', 'session.stop'), {}),
        ).rejects.toThrow('requires a bound sessionId');
        expect(bridgeClient.cancel_session).not.toHaveBeenCalled();
    });

    it('uses bound session context for log collection and stop', async () => {
        const bridgeClient = createBridgeClient();
        const registry = new ActionRegistry();
        registerSessionExecutors(registry, bridgeClient);

        await expect(
            registry.get('session.collectLogs')(step('s-log', 'session.collectLogs'), { sessionId: 'ses-42' }),
        ).resolves.toEqual({ collected: true, sessionId: 'ses-42' });

        await registry.get('session.stop')(step('s-stop', 'session.stop'), { sessionId: 'ses-42' });
        expect(bridgeClient.cancel_session).toHaveBeenCalledWith({ sessionId: 'ses-42' });
    });
});
