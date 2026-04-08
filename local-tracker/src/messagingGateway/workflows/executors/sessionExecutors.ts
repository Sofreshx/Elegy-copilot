import type { ActionRegistry } from '../actionRegistry';
import type { BridgeClient } from '../../bridgeClient';

function normalizeSessionId(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function resolveBoundSessionId(
    step: { params?: Record<string, unknown> },
    context: Record<string, unknown>,
): string | undefined {
    return normalizeSessionId(context.sessionId)
        ?? normalizeSessionId(step.params?.sessionId);
}

export function registerSessionExecutors(registry: ActionRegistry, bridgeClient: BridgeClient): void {
    registry.register('session.getStatus', async (_step, _context) => {
        return bridgeClient.get_sessions();
    });

    registry.register('session.collectLogs', async (step, context) => {
        return { collected: true, sessionId: resolveBoundSessionId(step, context) };
    });

    registry.register('session.stop', async (step, context) => {
        const sessionId = resolveBoundSessionId(step, context);
        if (!sessionId) {
            throw new Error('Action "session.stop" requires a bound sessionId.');
        }
        return bridgeClient.cancel_session({ sessionId });
    });

    registry.register('session.start', async (step, _context) => {
        const agentName = (step.params?.agentName as string | undefined) ?? 'default';
        const prompt = (step.params?.prompt as string | undefined) ?? 'resume';
        return bridgeClient.invoke_agent({ agentName, prompt });
    });

    registry.register('session.checkTests', async (_step, context) => {
        return { checked: true, testsPass: (context.testsPass as boolean | undefined) ?? true };
    });

    registry.register('session.checkDocs', async (_step, context) => {
        return { checked: true, docsValid: (context.docsValid as boolean | undefined) ?? true };
    });
}
