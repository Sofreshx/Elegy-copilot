import { createStore } from '../../lib/store';

export type OverseerAvailability = 'unknown' | 'ready' | 'starting' | 'stopped' | 'unavailable' | 'degraded';

interface OverseerWorkShellState {
  attentionCount: number;
  availability: OverseerAvailability;
}

export const overseerWorkStore = createStore<OverseerWorkShellState>({
  attentionCount: 0,
  availability: 'unknown',
});

export function setOverseerWorkShellState(next: Partial<OverseerWorkShellState>): void {
  overseerWorkStore.setState((state) => ({ ...state, ...next }));
}
