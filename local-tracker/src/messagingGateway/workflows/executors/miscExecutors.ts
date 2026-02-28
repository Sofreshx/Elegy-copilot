import type { ActionRegistry } from '../actionRegistry';

export function registerMiscExecutors(registry: ActionRegistry): void {
    registry.register('git.checkPrStatus', async (step, context) => {
        return { prStatus: (context.prStatus as string | undefined) ?? 'unknown', ...step.params };
    });

    registry.register('report.generate', async (step, _context) => {
        return { reportGenerated: true, timestamp: Date.now(), ...step.params };
    });
}
