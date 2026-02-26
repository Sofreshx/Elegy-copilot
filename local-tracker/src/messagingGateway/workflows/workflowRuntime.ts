import { WorkflowDefinition, WorkflowStep, WorkflowStepResult, WorkflowRunResult } from './workflowSchema';

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
    const layers = topologicalSort(definition.steps);
    const results: WorkflowStepResult[] = [];
    const failedSteps = new Set<string>();
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

                const stepStart = Date.now();
                try {
                    const output = await executor(step, context);
                    return {
                        stepId: step.id,
                        status: 'success',
                        durationMs: Date.now() - stepStart,
                        output,
                    };
                } catch (err) {
                    failedSteps.add(step.id);
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

    return {
        workflowId: definition.id,
        status,
        startedAtMs,
        completedAtMs: Date.now(),
        steps: results,
    };
}
