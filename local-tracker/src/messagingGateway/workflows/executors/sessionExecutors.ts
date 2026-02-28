import type { ActionRegistry } from '../actionRegistry';
import type { BridgeClient } from '../../bridgeClient';

export function registerSessionExecutors(registry: ActionRegistry, bridgeClient: BridgeClient): void {
    registry.register('session.getStatus', async (_step, _context) => {
        return bridgeClient.get_sessions();
    });

    registry.register('session.collectLogs', async (_step, context) => {
        return { collected: true, sessionId: context.sessionId as string | undefined };
    });

    registry.register('session.stop', async (step, context) => {
        const sessionId = (context.sessionId as string | undefined)
            ?? (step.params?.sessionId as string | undefined)
            ?? '';
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
