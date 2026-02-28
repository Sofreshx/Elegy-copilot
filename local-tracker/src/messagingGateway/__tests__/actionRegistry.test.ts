import { ActionRegistry, ActionNotFoundError, ActionExecutor } from '../workflows/actionRegistry';
import type { WorkflowStep } from '../workflows/workflowSchema';

function step(id: string, action: string): WorkflowStep {
    return { id, name: `Step ${id}`, action, dependsOn: [] };
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
