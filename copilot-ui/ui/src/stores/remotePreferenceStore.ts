import { createStore } from '../lib/store';
import { getRemotePreference, setRemotePreference } from '../lib/api/sdk';

export interface RemotePreferenceState {
  enabled: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  warning: string | null;
}

const INITIAL_STATE: RemotePreferenceState = {
  enabled: false,
  loading: false,
  saving: false,
  error: null,
  warning: null,
};

function createRemotePreferenceStore() {
  const store = createStore<RemotePreferenceState>(INITIAL_STATE);

  async function load(): Promise<void> {
    store.setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const result = await getRemotePreference();
      store.setState((s) => ({ ...s, enabled: result.enabled, loading: false }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load remote preference';
      store.setState((s) => ({ ...s, loading: false, error: message }));
    }
  }

  async function toggle(enabled: boolean): Promise<void> {
    store.setState((s) => ({ ...s, saving: true, error: null, warning: null }));
    try {
      const result = await setRemotePreference(enabled);
      store.setState((s) => ({
        ...s,
        enabled: result.enabled,
        saving: false,
        warning: result.warning || null,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update remote preference';
      store.setState((s) => ({ ...s, saving: false, error: message }));
    }
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    setState: store.setState,
    load,
    toggle,
  };
}

export const remotePreferenceStore = createRemotePreferenceStore();
