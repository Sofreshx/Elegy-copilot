export type ExecutorRiskLevel = 'read-only' | 'mutating' | 'destructive';

export interface ExecutorPolicyEvaluatorInput {
    actionName: string;
    riskLevel: ExecutorRiskLevel;
    params: Record<string, unknown> | undefined;
    dryRun: boolean;
}

export interface ExecutorPolicyEvaluationResult {
    allowed: boolean;
    reason?: string;
    riskLevel: ExecutorRiskLevel;
}

export interface ExecutorPolicyContext {
    allowMutatingExecutors?: boolean;
    allowDestructiveExecutors?: boolean;
    executorPolicyEvaluator?: (input: ExecutorPolicyEvaluatorInput) => { allowed: boolean; reason?: string } | undefined;
}

const DESTRUCTIVE_ACTION_PATTERN = /(delete|remove|merge|destroy|stop)/i;
const MUTATING_ACTION_PATTERN = /(create|write|update|start|sync|install|apply|implement|edit|modify|patch)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isExecutorPolicyContext(value: unknown): value is ExecutorPolicyContext {
    return isRecord(value);
}

export function resolveExecutorRiskLevel(actionName: string): ExecutorRiskLevel {
    if (DESTRUCTIVE_ACTION_PATTERN.test(actionName)) {
        return 'destructive';
    }

    if (MUTATING_ACTION_PATTERN.test(actionName)) {
        return 'mutating';
    }

    return 'read-only';
}

export function evaluateExecutorPolicy(
    actionName: string,
    params: Record<string, unknown> | undefined,
    context: Record<string, unknown> = {},
): ExecutorPolicyEvaluationResult {
    const riskLevel = resolveExecutorRiskLevel(actionName);
    const dryRun = params?.dryRun === true;
    const policyContext = isExecutorPolicyContext(context) ? context : {};

    const evaluator = policyContext.executorPolicyEvaluator;
    if (typeof evaluator === 'function') {
        const overrideResult = evaluator({ actionName, riskLevel, params, dryRun });
        if (overrideResult?.allowed === false) {
            return {
                allowed: false,
                reason: overrideResult.reason ?? `Executor policy evaluator blocked action "${actionName}"`,
                riskLevel,
            };
        }
    }

    if (riskLevel === 'read-only') {
        return { allowed: true, riskLevel };
    }

    if (riskLevel === 'destructive') {
        if (dryRun || policyContext.allowDestructiveExecutors === true) {
            return { allowed: true, riskLevel };
        }

        return {
            allowed: false,
            reason: `Action "${actionName}" (${riskLevel}) requires dryRun=true or context.allowDestructiveExecutors=true`,
            riskLevel,
        };
    }

    if (
        dryRun
        || policyContext.allowMutatingExecutors === true
        || policyContext.allowDestructiveExecutors === true
    ) {
        return { allowed: true, riskLevel };
    }

    return {
        allowed: false,
        reason: `Action "${actionName}" (${riskLevel}) requires dryRun=true or context.allowMutatingExecutors=true`,
        riskLevel,
    };
}