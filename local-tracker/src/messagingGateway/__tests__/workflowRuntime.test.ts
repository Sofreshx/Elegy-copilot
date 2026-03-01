import fs from 'node:fs';
import path from 'node:path';
import { topologicalSort, executeWorkflow, StepExecutor } from '../workflows/workflowRuntime';
import { parseWorkflowDefinition, WorkflowStep, WorkflowDefinition } from '../workflows/workflowSchema';

const LEGACY_TEMPLATE_FILES = [
    'failed-session-recovery.json',
    'finalization-validation.json',
    'incident-escalation.json',
] as const;

interface RawWorkflowTemplate {
    schemaVersion?: string;
    steps: Array<Record<string, unknown>>;
    [key: string]: unknown;
}

function loadRawTemplate(filename: string): RawWorkflowTemplate {
    const templatePath = path.join(__dirname, '../workflows/templates', filename);
    const parsed = JSON.parse(fs.readFileSync(templatePath, 'utf8')) as Record<string, unknown>;
    return {
        ...parsed,
        schemaVersion: typeof parsed.schemaVersion === 'string' ? parsed.schemaVersion : undefined,
        steps: Array.isArray(parsed.steps) ? (parsed.steps as Array<Record<string, unknown>>) : [],
    };
}

// Helper to make a minimal step
function step(id: string, dependsOn: string[] = [], condition?: string): WorkflowStep {
    return {
        id,
        name: `Step ${id}`,
        action: `action-${id}`,
        type: 'action',
        condition,
        streaming: false,
        dependsOn,
    };
}

// Helper to make a minimal workflow definition
function workflow(id: string, steps: WorkflowStep[]): WorkflowDefinition {
    return { id, name: `Workflow ${id}`, version: '1.0.0', schemaVersion: '1.0', steps };
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
        expect(result.schemaVersion).toBe('1.0');
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0].dependsOn).toEqual([]);
        expect(result.steps[0].type).toBe('action');
        expect(result.steps[0].streaming).toBe(false);
        expect(result.steps[0].streamingMetadata).toBeUndefined();
        expect(result.steps[0].ui).toBeUndefined();
        expect(result.ui).toBeUndefined();
    });

    it('preserves explicit v2 fields when provided', () => {
        const input = {
            id: 'wf-v2',
            name: 'Workflow V2',
            version: '2.0.0',
            schemaVersion: '2.0',
            steps: [
                {
                    id: 'step1',
                    name: 'Step 1',
                    action: 'do-thing',
                    type: 'decision',
                    condition: 'ctx.isReady === true',
                    outputs: { branch: 'ready' },
                    streaming: true,
                    dependsOn: ['bootstrap'],
                },
                {
                    id: 'bootstrap',
                    name: 'Bootstrap',
                    action: 'bootstrap',
                },
            ],
        };

        const result = parseWorkflowDefinition(input);

        expect(result.schemaVersion).toBe('2.0');
        expect(result.steps[0].type).toBe('decision');
        expect(result.steps[0].condition).toBe('ctx.isReady === true');
        expect(result.steps[0].outputs).toEqual({ branch: 'ready' });
        expect(result.steps[0].streaming).toBe(true);
        expect(result.steps[0].dependsOn).toEqual(['bootstrap']);
    });

    it('parses optional streaming and ui metadata when provided', () => {
        const input = {
            id: 'wf-meta',
            name: 'Workflow Metadata',
            version: '2.0.0',
            schemaVersion: '2.1',
            ui: {
                category: 'operations',
                tags: ['workflow', 'live-view'],
            },
            steps: [
                {
                    id: 'step1',
                    name: 'Step 1',
                    action: 'stream-output',
                    streaming: true,
                    streamingMetadata: {
                        mode: 'chunk',
                        channel: 'workflow-step-1',
                        eventType: 'delta',
                    },
                    ui: {
                        label: 'Streaming Step',
                        group: 'analysis',
                        order: 1,
                        icon: 'pulse',
                    },
                },
            ],
        };

        const result = parseWorkflowDefinition(input);

        expect(result.ui).toEqual({
            category: 'operations',
            tags: ['workflow', 'live-view'],
        });
        expect(result.steps[0].streaming).toBe(true);
        expect(result.steps[0].streamingMetadata).toEqual({
            mode: 'chunk',
            channel: 'workflow-step-1',
            eventType: 'delta',
        });
        expect(result.steps[0].ui).toEqual({
            label: 'Streaming Step',
            group: 'analysis',
            order: 1,
            icon: 'pulse',
        });
    });

    it('applies v1 defaults when parsing legacy templates', () => {
        for (const filename of LEGACY_TEMPLATE_FILES) {
            const rawTemplate = loadRawTemplate(filename);
            expect(rawTemplate.schemaVersion).toBeUndefined();

            const definition = parseWorkflowDefinition(rawTemplate);
            expect(definition.schemaVersion).toBe('1.0');
            if (!Object.prototype.hasOwnProperty.call(rawTemplate, 'ui')) {
                expect(definition.ui).toBeUndefined();
            }

            for (let index = 0; index < rawTemplate.steps.length; index += 1) {
                const rawStep = rawTemplate.steps[index];
                const parsedStep = definition.steps[index];

                if (!Object.prototype.hasOwnProperty.call(rawStep, 'type')) {
                    expect(parsedStep.type).toBe('action');
                }

                if (!Object.prototype.hasOwnProperty.call(rawStep, 'streaming')) {
                    expect(parsedStep.streaming).toBe(false);
                }

                if (!Object.prototype.hasOwnProperty.call(rawStep, 'streamingMetadata')) {
                    expect(parsedStep.streamingMetadata).toBeUndefined();
                }

                if (!Object.prototype.hasOwnProperty.call(rawStep, 'ui')) {
                    expect(parsedStep.ui).toBeUndefined();
                }

                if (!Object.prototype.hasOwnProperty.call(rawStep, 'dependsOn')) {
                    expect(parsedStep.dependsOn).toEqual([]);
                }
            }
        }
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

    it('blocks destructive actions when not dryRun and no context override is provided', async () => {
        const executor = jest.fn<ReturnType<StepExecutor>, Parameters<StepExecutor>>(async () => 'ok');
        const destructiveStep: WorkflowStep = {
            ...step('A'),
            action: 'delete-resource',
        };

        const def = workflow('policy-block-destructive', [destructiveStep]);
        const result = await executeWorkflow(def, executor);
        const stepResult = result.steps.find(s => s.stepId === 'A');

        expect(result.status).toBe('failed');
        expect(stepResult).toBeDefined();
        expect(stepResult!.status).toBe('failed');
        expect(stepResult!.durationMs).toBe(0);
        expect(stepResult!.error).toContain('requires dryRun=true');
        expect(executor).not.toHaveBeenCalled();
    });

    it('allows destructive actions when dryRun is true', async () => {
        const executor = jest.fn<ReturnType<StepExecutor>, Parameters<StepExecutor>>(async () => 'ok');
        const destructiveStep: WorkflowStep = {
            ...step('A'),
            action: 'delete-resource',
            params: { dryRun: true },
        };

        const def = workflow('policy-allow-destructive-dryrun', [destructiveStep]);
        const result = await executeWorkflow(def, executor);

        expect(result.status).toBe('completed');
        expect(result.steps[0].status).toBe('success');
        expect(executor).toHaveBeenCalledTimes(1);
    });

    it('allows mutating actions when context override is enabled', async () => {
        const executor = jest.fn<ReturnType<StepExecutor>, Parameters<StepExecutor>>(async () => 'ok');
        const mutatingStep: WorkflowStep = {
            ...step('A'),
            action: 'create-resource',
        };

        const def = workflow('policy-allow-mutating-override', [mutatingStep]);
        const result = await executeWorkflow(def, executor, { allowMutatingExecutors: true });

        expect(result.status).toBe('completed');
        expect(result.steps[0].status).toBe('success');
        expect(executor).toHaveBeenCalledTimes(1);
    });

    it('honors executor policy callback blocks over other allows', async () => {
        const executor = jest.fn<ReturnType<StepExecutor>, Parameters<StepExecutor>>(async () => 'ok');
        const destructiveStep: WorkflowStep = {
            ...step('A'),
            action: 'delete-resource',
            params: { dryRun: true },
        };

        const def = workflow('policy-callback-block', [destructiveStep]);
        const result = await executeWorkflow(def, executor, {
            allowMutatingExecutors: true,
            executorPolicyEvaluator: () => ({ allowed: false, reason: 'blocked-by-callback' }),
        });

        expect(result.status).toBe('failed');
        expect(result.steps[0].status).toBe('failed');
        expect(result.steps[0].durationMs).toBe(0);
        expect(result.steps[0].error).toBe('blocked-by-callback');
        expect(executor).not.toHaveBeenCalled();
    });

    it('supports output chaining across steps using templates', async () => {
        const stepOne: WorkflowStep = {
            ...step('step1'),
            params: { input: 'seed' },
        };
        const stepTwo: WorkflowStep = {
            ...step('step2', ['step1']),
            params: {
                token: '{{step1.token}}',
                nested: '{{step1.result.value}}',
                message: 'token={{step1.token}}',
            },
        };

        let executedStepTwo: WorkflowStep | undefined;
        const executor: StepExecutor = async (s) => {
            if (s.id === 'step1') {
                return { token: 'tok-123', result: { value: 'nested-42' } };
            }

            if (s.id === 'step2') {
                executedStepTwo = s;
                return { ok: true };
            }

            return null;
        };

        const def = workflow('chaining', [stepOne, stepTwo]);
        const result = await executeWorkflow(def, executor);

        expect(result.status).toBe('completed');
        expect(executedStepTwo).toBeDefined();
        expect(executedStepTwo!.params).toEqual({
            token: 'tok-123',
            nested: 'nested-42',
            message: 'token=tok-123',
        });

        // Runtime must not mutate the original workflow definition.
        expect(stepTwo.params).toEqual({
            token: '{{step1.token}}',
            nested: '{{step1.result.value}}',
            message: 'token={{step1.token}}',
        });
    });

    it('keeps unresolved template references unchanged and does not crash', async () => {
        const stepOne: WorkflowStep = step('step1');
        const stepTwo: WorkflowStep = {
            ...step('step2', ['step1']),
            params: {
                missingField: '{{step1.missing}}',
                missingStep: '{{stepX.token}}',
                mixed: 'value={{step1.missing}}',
            },
        };

        let executedStepTwo: WorkflowStep | undefined;
        const executor: StepExecutor = async (s) => {
            if (s.id === 'step1') return { token: 'tok-123' };
            if (s.id === 'step2') executedStepTwo = s;
            return null;
        };

        const def = workflow('missing-refs', [stepOne, stepTwo]);
        const result = await executeWorkflow(def, executor);

        expect(result.status).toBe('completed');
        expect(executedStepTwo!.params).toEqual({
            missingField: '{{step1.missing}}',
            missingStep: '{{stepX.token}}',
            mixed: 'value={{step1.missing}}',
        });
    });

    it('executes a step when its condition evaluates to true', async () => {
        const calls: string[] = [];
        const executor: StepExecutor = async (s) => {
            calls.push(s.id);
            if (s.id === 'A') {
                return { shouldRun: true };
            }

            return { ok: true };
        };

        const def = workflow('condition-true', [
            step('A'),
            step('B', ['A'], 'A.shouldRun == true'),
        ]);

        const result = await executeWorkflow(def, executor);
        const stepMap = new Map(result.steps.map(r => [r.stepId, r]));

        expect(result.status).toBe('completed');
        expect(calls).toEqual(['A', 'B']);
        expect(stepMap.get('B')!.status).toBe('success');
    });

    it('skips a step when its condition evaluates to false', async () => {
        const calls: string[] = [];
        const executor: StepExecutor = async (s) => {
            calls.push(s.id);
            if (s.id === 'A') {
                return { shouldRun: false };
            }

            return { ok: true };
        };

        const def = workflow('condition-false', [
            step('A'),
            step('B', ['A'], 'A.shouldRun == true'),
        ]);

        const result = await executeWorkflow(def, executor);
        const stepMap = new Map(result.steps.map(r => [r.stepId, r]));

        expect(result.status).toBe('partial');
        expect(calls).toEqual(['A']);
        expect(stepMap.get('B')!.status).toBe('skipped');
        expect(stepMap.get('B')!.durationMs).toBe(0);
    });

    it('fails deterministically when a condition expression is malformed', async () => {
        const calls: string[] = [];
        const executor: StepExecutor = async (s) => {
            calls.push(s.id);
            if (s.id === 'A') {
                return { shouldRun: true };
            }

            return { ok: true };
        };

        const def = workflow('condition-malformed', [
            step('A'),
            step('B', ['A'], 'A.shouldRun =='),
            step('C', ['B']),
        ]);

        const result = await executeWorkflow(def, executor);
        const stepMap = new Map(result.steps.map(r => [r.stepId, r]));

        expect(result.status).toBe('failed');
        expect(calls).toEqual(['A']);
        expect(stepMap.get('B')!.status).toBe('failed');
        expect(stepMap.get('B')!.durationMs).toBe(0);
        expect(stepMap.get('B')!.error).toBeDefined();
        expect(stepMap.get('C')!.status).toBe('skipped');
    });

    it('blocks dangerous prototype path traversal in templates', async () => {
        const stepOne: WorkflowStep = step('step1');
        const stepTwo: WorkflowStep = {
            ...step('step2', ['step1']),
            params: {
                safe: '{{step1.safe.value}}',
                dangerousProto: '{{step1.__proto__.polluted}}',
                dangerousCtor: '{{step1.constructor.name}}',
                dangerousPrototype: '{{step1.prototype.name}}',
            },
        };

        let executedStepTwo: WorkflowStep | undefined;
        const executor: StepExecutor = async (s) => {
            if (s.id === 'step1') return { safe: { value: 'ok' } };
            if (s.id === 'step2') executedStepTwo = s;
            return null;
        };

        const def = workflow('proto-safe', [stepOne, stepTwo]);
        const result = await executeWorkflow(def, executor);

        expect(result.status).toBe('completed');
        expect(executedStepTwo!.params).toEqual({
            safe: 'ok',
            dangerousProto: '{{step1.__proto__.polluted}}',
            dangerousCtor: '{{step1.constructor.name}}',
            dangerousPrototype: '{{step1.prototype.name}}',
        });
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
});
