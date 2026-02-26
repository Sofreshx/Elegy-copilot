import { topologicalSort, executeWorkflow, StepExecutor } from '../workflows/workflowRuntime';
import { parseWorkflowDefinition, WorkflowStep, WorkflowDefinition } from '../workflows/workflowSchema';

// Helper to make a minimal step
function step(id: string, dependsOn: string[] = []): WorkflowStep {
    return { id, name: `Step ${id}`, action: `action-${id}`, dependsOn };
}

// Helper to make a minimal workflow definition
function workflow(id: string, steps: WorkflowStep[]): WorkflowDefinition {
    return { id, name: `Workflow ${id}`, version: '1.0.0', steps };
}

describe('topologicalSort', () => {
    it('sorts a linear chain into sequential layers', () => {
        const steps = [step('A'), step('B', ['A']), step('C', ['B'])];
        const layers = topologicalSort(steps);
        expect(layers).toHaveLength(3);
        expect(layers[0].map(s => s.id)).toEqual(['A']);
        expect(layers[1].map(s => s.id)).toEqual(['B']);
        expect(layers[2].map(s => s.id)).toEqual(['C']);
    });

    it('groups parallel steps into a single layer', () => {
        const steps = [step('A'), step('B')];
        const layers = topologicalSort(steps);
        expect(layers).toHaveLength(1);
        expect(layers[0].map(s => s.id).sort()).toEqual(['A', 'B']);
    });

    it('sorts a diamond DAG into three layers', () => {
        const steps = [step('A'), step('B', ['A']), step('C', ['A']), step('D', ['B', 'C'])];
        const layers = topologicalSort(steps);
        expect(layers).toHaveLength(3);
        expect(layers[0].map(s => s.id)).toEqual(['A']);
        expect(layers[1].map(s => s.id).sort()).toEqual(['B', 'C']);
        expect(layers[2].map(s => s.id)).toEqual(['D']);
    });

    it('throws on cycle', () => {
        const steps = [step('A', ['B']), step('B', ['A'])];
        expect(() => topologicalSort(steps)).toThrow('Cycle detected');
    });

    it('throws on unknown dependency', () => {
        const steps = [step('A', ['X'])];
        expect(() => topologicalSort(steps)).toThrow('depends on unknown step "X"');
    });

    it('throws on duplicate step ID', () => {
        const steps = [step('A'), step('A')];
        expect(() => topologicalSort(steps)).toThrow('Duplicate step id: A');
    });

    it('handles a single step', () => {
        const layers = topologicalSort([step('only')]);
        expect(layers).toHaveLength(1);
        expect(layers[0].map(s => s.id)).toEqual(['only']);
    });
});

describe('parseWorkflowDefinition', () => {
    it('parses a valid definition', () => {
        const input = {
            id: 'wf-1',
            name: 'Test Workflow',
            version: '1.0.0',
            steps: [{ id: 'step1', name: 'Step 1', action: 'do-thing' }],
        };
        const result = parseWorkflowDefinition(input);
        expect(result.id).toBe('wf-1');
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0].dependsOn).toEqual([]);
    });

    it('rejects empty steps array', () => {
        const input = { id: 'wf-1', name: 'Test', version: '1.0.0', steps: [] };
        expect(() => parseWorkflowDefinition(input)).toThrow();
    });

    it('rejects invalid step ID format', () => {
        const input = {
            id: 'wf-1',
            name: 'Test',
            version: '1.0.0',
            steps: [{ id: 'invalid id!', name: 'Step', action: 'act' }],
        };
        expect(() => parseWorkflowDefinition(input)).toThrow();
    });

    it('rejects missing required fields', () => {
        expect(() => parseWorkflowDefinition({ id: 'wf-1' })).toThrow();
        expect(() => parseWorkflowDefinition({})).toThrow();
    });
});

describe('executeWorkflow', () => {
    it('executes a linear workflow in order', async () => {
        const callOrder: string[] = [];
        const executor: StepExecutor = async (s) => { callOrder.push(s.id); };

        const def = workflow('linear', [step('A'), step('B', ['A']), step('C', ['B'])]);
        const result = await executeWorkflow(def, executor);

        expect(callOrder).toEqual(['A', 'B', 'C']);
        expect(result.status).toBe('completed');
        expect(result.steps).toHaveLength(3);
    });

    it('executes parallel steps in the same layer', async () => {
        const callOrder: string[] = [];
        const executor: StepExecutor = async (s) => { callOrder.push(s.id); };

        const def = workflow('parallel', [step('A'), step('B'), step('C', ['A', 'B'])]);
        const result = await executeWorkflow(def, executor);

        // A and B should both be called before C
        expect(callOrder.indexOf('C')).toBeGreaterThan(callOrder.indexOf('A'));
        expect(callOrder.indexOf('C')).toBeGreaterThan(callOrder.indexOf('B'));
        expect(result.status).toBe('completed');
    });

    it('skips dependents of a failed step', async () => {
        const executor: StepExecutor = async (s) => {
            if (s.id === 'B') throw new Error('B failed');
        };

        const def = workflow('skip', [step('A'), step('B', ['A']), step('C', ['B'])]);
        const result = await executeWorkflow(def, executor);

        expect(result.status).toBe('failed');
        const stepMap = new Map(result.steps.map(r => [r.stepId, r]));
        expect(stepMap.get('A')!.status).toBe('success');
        expect(stepMap.get('B')!.status).toBe('failed');
        expect(stepMap.get('C')!.status).toBe('skipped');
    });

    it('returns completed when all steps succeed', async () => {
        const executor: StepExecutor = async () => 'ok';
        const def = workflow('all-ok', [step('A'), step('B')]);
        const result = await executeWorkflow(def, executor);

        expect(result.status).toBe('completed');
        expect(result.steps.every(s => s.status === 'success')).toBe(true);
    });

    it('returns failed when a step fails', async () => {
        const executor: StepExecutor = async (s) => {
            if (s.id === 'A') throw new Error('boom');
        };
        const def = workflow('fail', [step('A')]);
        const result = await executeWorkflow(def, executor);

        expect(result.status).toBe('failed');
        expect(result.steps[0].error).toBe('boom');
    });

    it('includes skipped results for dependents of failed steps', async () => {
        const executor: StepExecutor = async (s) => {
            if (s.id === 'A') throw new Error('fail');
        };
        const def = workflow('skip-dep', [step('A'), step('B', ['A']), step('C', ['A'])]);
        const result = await executeWorkflow(def, executor);

        const skipped = result.steps.filter(s => s.status === 'skipped');
        expect(skipped).toHaveLength(2);
        expect(skipped.map(s => s.stepId).sort()).toEqual(['B', 'C']);
    });
});
