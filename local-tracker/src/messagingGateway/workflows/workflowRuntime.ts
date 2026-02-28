import { WorkflowDefinition, WorkflowStep, WorkflowStepResult, WorkflowRunResult } from './workflowSchema';
import { getWorkflowTracer } from './workflowTracing';
import { StepOutputStore } from './stepOutputStore';
import { evaluateStepCondition } from './conditionEvaluator';
import { evaluateExecutorPolicy } from './executorPolicy';

export type StepExecutor = (step: WorkflowStep, context: Record<string, unknown>) => Promise<unknown>;

/**
 * Topological sort of workflow steps.
 * Throws if a cycle is detected or if a dependsOn references a non-existent step.
 */
export function topologicalSort(steps: WorkflowStep[]): WorkflowStep[][] {
    const stepMap = new Map<string, WorkflowStep>();
    for (const step of steps) {
        if (stepMap.has(step.id)) throw new Error(`Duplicate step id: ${step.id}`);
        stepMap.set(step.id, step);
    }

    // Validate all dependencies exist
    for (const step of steps) {
        for (const dep of step.dependsOn) {
            if (!stepMap.has(dep)) {
                throw new Error(`Step "${step.id}" depends on unknown step "${dep}"`);
            }
        }
    }

    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();
    for (const step of steps) {
        inDegree.set(step.id, step.dependsOn.length);
        for (const dep of step.dependsOn) {
            const list = dependents.get(dep) ?? [];
            list.push(step.id);
            dependents.set(dep, list);
        }
    }

    const layers: WorkflowStep[][] = [];
    const remaining = new Set(steps.map(s => s.id));

    while (remaining.size > 0) {
        const ready: WorkflowStep[] = [];
        for (const id of remaining) {
            if ((inDegree.get(id) ?? 0) === 0) {
                ready.push(stepMap.get(id)!);
            }
        }

        if (ready.length === 0) {
            throw new Error('Cycle detected in workflow DAG');
        }

        layers.push(ready);
        for (const step of ready) {
            remaining.delete(step.id);
            for (const depId of dependents.get(step.id) ?? []) {
                inDegree.set(depId, (inDegree.get(depId) ?? 1) - 1);
            }
        }
    }

    return layers;
}

/**
 * Execute a workflow using the DAG runtime.
 * Steps within the same layer run in parallel.
 * If a step fails, dependent steps are skipped.
 */
export async function executeWorkflow(
    definition: WorkflowDefinition,
    executor: StepExecutor,
    context: Record<string, unknown> = {},
): Promise<WorkflowRunResult> {
    const tracer = getWorkflowTracer();
    const rootSpan = tracer.startSpan(`workflow.${definition.id}`, {
        'workflow.id': definition.id,
        'workflow.name': definition.name,
        'workflow.stepCount': definition.steps.length,
    });

    const layers = topologicalSort(definition.steps);
    const results: WorkflowStepResult[] = [];
    const failedSteps = new Set<string>();
    const outputStore = new StepOutputStore();
    const startedAtMs = Date.now();

    for (const layer of layers) {
        const layerResults = await Promise.all(
            layer.map(async (step): Promise<WorkflowStepResult> => {
                // Skip if any dependency failed
                const hasFailed = step.dependsOn.some(dep => failedSteps.has(dep));
                if (hasFailed) {
                    failedSteps.add(step.id);
                    return { stepId: step.id, status: 'skipped', durationMs: 0 };
                }

                if (step.condition !== undefined) {
                    try {
                        const shouldExecute = evaluateStepCondition(step.condition, outputStore);
                        if (!shouldExecute) {
                            return { stepId: step.id, status: 'skipped', durationMs: 0 };
                        }
                    } catch (err) {
                        failedSteps.add(step.id);
                        return {
                            stepId: step.id,
                            status: 'failed',
                            durationMs: 0,
                            error: err instanceof Error ? err.message : String(err),
                        };
                    }
                }

                const stepSpan = tracer.startSpan(`step.${step.id}`, {
                    'step.id': step.id,
                    'step.action': step.action,
                });
                const stepStart = Date.now();
                try {
                    const resolvedStep: WorkflowStep = {
                        ...step,
                        params: outputStore.resolveParams(step.params),
                    };

                    const policyResult = evaluateExecutorPolicy(resolvedStep.action, resolvedStep.params, context);
                    if (!policyResult.allowed) {
                        failedSteps.add(step.id);
                        const reason = policyResult.reason ?? `Executor policy blocked action "${resolvedStep.action}"`;
                        stepSpan.setStatus('error', reason);
                        stepSpan.end();
                        return {
                            stepId: step.id,
                            status: 'failed',
                            durationMs: 0,
                            error: reason,
                        };
                    }

                    const output = await executor(resolvedStep, context);
                    outputStore.setStepOutput(step.id, output);
                    stepSpan.setStatus('ok');
                    stepSpan.end();
                    return {
                        stepId: step.id,
                        status: 'success',
                        durationMs: Date.now() - stepStart,
                        output,
                    };
                } catch (err) {
                    failedSteps.add(step.id);
                    stepSpan.setStatus('error', err instanceof Error ? err.message : String(err));
                    stepSpan.end();
                    return {
                        stepId: step.id,
                        status: 'failed',
                        durationMs: Date.now() - stepStart,
                        error: err instanceof Error ? err.message : String(err),
                    };
                }
            }),
        );
        results.push(...layerResults);
    }

    const hasFailure = results.some(r => r.status === 'failed');
    const hasSkipped = results.some(r => r.status === 'skipped');
    const status = hasFailure ? 'failed' : hasSkipped ? 'partial' : 'completed';

    rootSpan.setStatus(status === 'completed' ? 'ok' : 'error');
    rootSpan.end();

    return {
        workflowId: definition.id,
        status,
        startedAtMs,
        completedAtMs: Date.now(),
        steps: results,
    };
}
