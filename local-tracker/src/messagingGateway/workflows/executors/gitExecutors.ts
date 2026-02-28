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

type ReadOnlyGitCommand = typeof READ_ONLY_GIT_COMMANDS[number];

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
}
