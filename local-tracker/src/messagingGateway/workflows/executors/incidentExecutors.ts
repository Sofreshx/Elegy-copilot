import type { ActionRegistry } from '../actionRegistry';

export function registerIncidentExecutors(registry: ActionRegistry): void {
    registry.register('incident.create', async (step, _context) => {
        return { incidentId: 'INC-' + Date.now(), created: true, ...step.params };
    });

    registry.register('incident.awaitResponse', async (step, context) => {
        return { acknowledged: (context.incidentAcknowledged as boolean | undefined) ?? false, ...step.params };
    });
}
