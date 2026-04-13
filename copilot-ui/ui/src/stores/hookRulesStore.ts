import {
  getHookRules,
  toggleHookRule,
  batchToggleHookRules,
  type HookRule,
  type HookRulesResponse,
} from '../lib/api/hooks';
import { createStore } from '../lib/store';

export interface HookRulesState {
  rules: HookRule[];
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: HookRulesState = {
  rules: [],
  loading: false,
  error: null,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Unable to load hook rules.';
}

function createHookRulesStore() {
  const store = createStore<HookRulesState>(INITIAL_STATE);

  let requestVersion = 0;

  async function refresh(): Promise<void> {
    const version = ++requestVersion;

    store.setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const data: HookRulesResponse = await getHookRules();

      store.setState((s) => {
        if (version !== requestVersion) return s;
        return { ...s, rules: data.rules, loading: false, error: null };
      });
    } catch (error) {
      store.setState((s) => {
        if (version !== requestVersion) return s;
        return { ...s, loading: false, error: toErrorMessage(error) };
      });
    }
  }

  async function toggle(ruleId: string, enabled: boolean): Promise<void> {
    // Optimistic update
    store.setState((s) => ({
      ...s,
      rules: s.rules.map((r) => (r.id === ruleId ? { ...r, enabled } : r)),
    }));

    try {
      await toggleHookRule(ruleId, enabled);
    } catch {
      // Revert on failure
      void refresh();
    }
  }

  async function enableAll(): Promise<void> {
    const updates = store.getState().rules.map((r) => ({ id: r.id, enabled: true }));
    store.setState((s) => ({
      ...s,
      rules: s.rules.map((r) => ({ ...r, enabled: true })),
    }));

    try {
      const data = await batchToggleHookRules(updates);
      store.setState((s) => ({ ...s, rules: data.rules }));
    } catch {
      void refresh();
    }
  }

  async function enableCategory(category: string): Promise<void> {
    const updates = store
      .getState()
      .rules.filter((r) => r.category === category)
      .map((r) => ({ id: r.id, enabled: true }));

    store.setState((s) => ({
      ...s,
      rules: s.rules.map((r) => (r.category === category ? { ...r, enabled: true } : r)),
    }));

    try {
      const data = await batchToggleHookRules(updates);
      store.setState((s) => ({ ...s, rules: data.rules }));
    } catch {
      void refresh();
    }
  }

  async function disableAll(): Promise<void> {
    const updates = store.getState().rules.map((r) => ({ id: r.id, enabled: false }));
    store.setState((s) => ({
      ...s,
      rules: s.rules.map((r) => ({ ...r, enabled: false })),
    }));

    try {
      const data = await batchToggleHookRules(updates);
      store.setState((s) => ({ ...s, rules: data.rules }));
    } catch {
      void refresh();
    }
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    refresh,
    toggle,
    enableAll,
    enableCategory,
    disableAll,
  };
}

export const hookRulesStore = createHookRulesStore();
