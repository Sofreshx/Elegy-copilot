import type { ActionRegistry } from '../actionRegistry';

export function registerDiagnosticsExecutors(registry: ActionRegistry): void {
    registry.register('diagnostics.collect', async (_step, context) => {
        return { collected: true, timestamp: Date.now(), metrics: (context.diagnosticMetrics as Record<string, unknown> | undefined) ?? {} };
    });
}
