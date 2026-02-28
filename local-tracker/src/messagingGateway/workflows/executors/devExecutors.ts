import type { ActionRegistry } from '../actionRegistry';
import type { WorkflowStep } from '../workflowSchema';

interface DevActionResult {
    action: 'dev.research' | 'dev.plan' | 'dev.review';
    stepId: string;
    stepName: string;
    timestampMs: number;
    params: Record<string, unknown>;
    context: {
        workflowId?: string;
        sessionId?: string;
        requestId?: string;
    };
}

function resolveTimestampMs(step: WorkflowStep, context: Record<string, unknown>): number {
    const contextTimestamp = context.nowMs;
    if (typeof contextTimestamp === 'number' && Number.isFinite(contextTimestamp)) {
        return contextTimestamp;
    }

    const stepTimestamp = step.params?.nowMs;
    if (typeof stepTimestamp === 'number' && Number.isFinite(stepTimestamp)) {
        return stepTimestamp;
    }

    return 0;
}

function buildResult(
    action: DevActionResult['action'],
    step: WorkflowStep,
    context: Record<string, unknown>,
): DevActionResult {
    return {
        action,
        stepId: step.id,
        stepName: step.name,
        timestampMs: resolveTimestampMs(step, context),
        params: step.params ?? {},
        context: {
            workflowId: typeof context.workflowId === 'string' ? context.workflowId : undefined,
            sessionId: typeof context.sessionId === 'string' ? context.sessionId : undefined,
            requestId: typeof context.requestId === 'string' ? context.requestId : undefined,
        },
    };
}

export function registerDevExecutors(registry: ActionRegistry): void {
    registry.register('dev.research', async (step, context) => {
        return buildResult('dev.research', step, context);
    });

    registry.register('dev.plan', async (step, context) => {
        return buildResult('dev.plan', step, context);
    });

    registry.register('dev.review', async (step, context) => {
        return buildResult('dev.review', step, context);
    });
}
