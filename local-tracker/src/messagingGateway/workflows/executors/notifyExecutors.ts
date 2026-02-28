import type { ActionRegistry } from '../actionRegistry';

export function registerNotifyExecutors(registry: ActionRegistry): void {
    registry.register('notify.operator', async (step, context) => {
        const notifySink = context.notifySink as ((payload: Record<string, unknown>) => unknown) | undefined;
        if (!notifySink) {
            return { sent: false, reason: 'no-sink' };
        }
        notifySink({ type: 'operator', message: (step.params?.message as string | undefined) ?? step.name, ...step.params });
        return { sent: true };
    });

    registry.register('notify.team', async (step, context) => {
        const notifySink = context.notifySink as ((payload: Record<string, unknown>) => unknown) | undefined;
        if (!notifySink) {
            return { sent: false, reason: 'no-sink' };
        }
        notifySink({ type: 'team', message: (step.params?.message as string | undefined) ?? step.name, ...step.params });
        return { sent: true };
    });
}
