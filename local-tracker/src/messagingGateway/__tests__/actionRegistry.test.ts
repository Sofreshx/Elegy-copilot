import { ActionRegistry, ActionNotFoundError, ActionExecutor } from '../workflows/actionRegistry';
import type { WorkflowStep } from '../workflows/workflowSchema';
import { registerDevExecutors } from '../workflows/executors/devExecutors';
import { registerGitExecutors } from '../workflows/executors/gitExecutors';

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
    });
});

describe('registerGitExecutors', () => {
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
});
