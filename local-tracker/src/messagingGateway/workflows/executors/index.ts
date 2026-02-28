import { ActionRegistry } from '../actionRegistry';
import type { BridgeClient } from '../../bridgeClient';
import { registerSessionExecutors } from './sessionExecutors';
import { registerNotifyExecutors } from './notifyExecutors';
import { registerIncidentExecutors } from './incidentExecutors';
import { registerDiagnosticsExecutors } from './diagnosticsExecutors';
import { registerMiscExecutors } from './miscExecutors';

export function createDefaultRegistry(bridgeClient: BridgeClient): ActionRegistry {
    const registry = new ActionRegistry();
    registerSessionExecutors(registry, bridgeClient);
    registerNotifyExecutors(registry);
    registerIncidentExecutors(registry);
    registerDiagnosticsExecutors(registry);
    registerMiscExecutors(registry);
    return registry;
}

export { registerSessionExecutors } from './sessionExecutors';
export { registerNotifyExecutors } from './notifyExecutors';
export { registerIncidentExecutors } from './incidentExecutors';
export { registerDiagnosticsExecutors } from './diagnosticsExecutors';
export { registerMiscExecutors } from './miscExecutors';
