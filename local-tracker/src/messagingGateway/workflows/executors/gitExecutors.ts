import type { ActionRegistry } from '../actionRegistry';
import type { WorkflowStep } from '../workflowSchema';

const READ_ONLY_GIT_COMMANDS = [
    'status',
    'log',
    'diff',
    'branch',
    'remote',
    'show',
    'rev-parse',
    'ls-files',
] as const;

const GIT_MERGE_PR_COMMANDS = ['merge', 'checkout', 'pull', 'push'] as const;
const MERGE_PR_CAP = 10;
const DEFAULT_TIMEOUT_MS_PER_MERGE = 120_000;

type ReadOnlyGitCommand = typeof READ_ONLY_GIT_COMMANDS[number];
type MergePrGitCommand = typeof GIT_MERGE_PR_COMMANDS[number];

interface GitStateAnalysisResult {
    action: 'git.state-analysis';
    stepId: string;
    timestampMs: number;
    requestedCommand: string;
    requestedToken: string;
    whitelist: readonly ReadOnlyGitCommand[];
    blocked: boolean;
    reason?: string;
    params: Record<string, unknown>;
    context: {
        repositoryPath?: string;
        workflowId?: string;
        sessionId?: string;
    };
}

interface GitMergePrsResult {
    action: 'git.merge-prs';
    stepId: string;
    timestampMs: number;
    requestedCommand: string;
    requestedToken: string;
    whitelist: readonly MergePrGitCommand[];
    dryRun: boolean;
    timeoutMsPerMerge: number;
    mergeCap: number;
    mergeRequests: string[];
    blocked: boolean;
    reason?: string;
    context: {
        repositoryPath?: string;
        workflowId?: string;
        sessionId?: string;
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

function normalizeCommandToken(command: string): string {
    const trimmed = command.trim();
    if (!trimmed) {
        return '';
    }

    const [token = ''] = trimmed.split(/\s+/);
    return token.toLowerCase();
}

function isReadOnlyCommand(token: string): token is ReadOnlyGitCommand {
    return (READ_ONLY_GIT_COMMANDS as readonly string[]).includes(token);
}

function isMergePrCommand(token: string): token is MergePrGitCommand {
    return (GIT_MERGE_PR_COMMANDS as readonly string[]).includes(token);
}

function normalizeDryRun(value: unknown): boolean {
    if (typeof value === 'boolean') {
        return value;
    }

    return true;
}

function normalizeTimeoutMsPerMerge(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.trunc(value);
    }

    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.trunc(parsed);
        }
    }

    return DEFAULT_TIMEOUT_MS_PER_MERGE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function normalizeMergeRequest(value: unknown): string | undefined {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(Math.trunc(value));
    }

    if (isRecord(value)) {
        const candidates: unknown[] = [value.pr, value.prNumber, value.number, value.id, value.ref];
        for (const candidate of candidates) {
            const normalized = normalizeMergeRequest(candidate);
            if (typeof normalized === 'string') {
                return normalized;
            }
        }
    }

    return undefined;
}

function normalizeMergeRequests(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((request) => normalizeMergeRequest(request))
        .filter((request): request is string => typeof request === 'string');
}

export function registerGitExecutors(registry: ActionRegistry): void {
    registry.register('git.state-analysis', async (step, context) => {
        const requestedCommand =
            typeof step.params?.command === 'string' && step.params.command.trim().length > 0
                ? step.params.command
                : 'status';

        const requestedToken = normalizeCommandToken(requestedCommand);
        const blocked = !isReadOnlyCommand(requestedToken);

        return {
            action: 'git.state-analysis',
            stepId: step.id,
            timestampMs: resolveTimestampMs(step, context),
            requestedCommand,
            requestedToken,
            whitelist: READ_ONLY_GIT_COMMANDS,
            blocked,
            reason: blocked
                ? `Requested git command "${requestedCommand}" is not in read-only whitelist`
                : undefined,
            params: step.params ?? {},
            context: {
                repositoryPath:
                    (typeof step.params?.repositoryPath === 'string' ? step.params.repositoryPath : undefined)
                    ?? (typeof context.repositoryPath === 'string' ? context.repositoryPath : undefined),
                workflowId: typeof context.workflowId === 'string' ? context.workflowId : undefined,
                sessionId: typeof context.sessionId === 'string' ? context.sessionId : undefined,
            },
        } satisfies GitStateAnalysisResult;
    });

    registry.register('git.merge-prs', async (step, context) => {
        const requestedCommand =
            typeof step.params?.command === 'string' && step.params.command.trim().length > 0
                ? step.params.command
                : 'merge';

        const requestedToken = normalizeCommandToken(requestedCommand);
        const mergeRequests = normalizeMergeRequests(step.params?.mergeRequests);
        const dryRun = normalizeDryRun(step.params?.dryRun);
        const timeoutMsPerMerge = normalizeTimeoutMsPerMerge(step.params?.timeoutMsPerMerge);

        let reason: string | undefined;
        if (!isMergePrCommand(requestedToken)) {
            reason = `Requested git command "${requestedCommand}" is not in merge whitelist`;
        } else if (mergeRequests.length > MERGE_PR_CAP) {
            reason = `Requested ${mergeRequests.length} merge requests exceeds cap ${MERGE_PR_CAP}`;
        }

        const blocked = typeof reason === 'string';

        return {
            action: 'git.merge-prs',
            stepId: step.id,
            timestampMs: resolveTimestampMs(step, context),
            requestedCommand,
            requestedToken,
            whitelist: GIT_MERGE_PR_COMMANDS,
            dryRun,
            timeoutMsPerMerge,
            mergeCap: MERGE_PR_CAP,
            mergeRequests,
            blocked,
            reason,
            context: {
                repositoryPath:
                    (typeof step.params?.repositoryPath === 'string' ? step.params.repositoryPath : undefined)
                    ?? (typeof context.repositoryPath === 'string' ? context.repositoryPath : undefined),
                workflowId: typeof context.workflowId === 'string' ? context.workflowId : undefined,
                sessionId: typeof context.sessionId === 'string' ? context.sessionId : undefined,
            },
        } satisfies GitMergePrsResult;
    });
}
