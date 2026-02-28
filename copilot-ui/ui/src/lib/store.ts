import { useSyncExternalStore } from 'react';

type Listener = () => void;

export interface Store<T> {
  getState: () => T;
  setState: (updater: T | ((state: T) => T)) => void;
  subscribe: (listener: Listener) => () => void;
}

type ReadableStore<T> = Pick<Store<T>, 'getState' | 'subscribe'>;

export function createStore<T>(initialState: T): Store<T> {
  let state = initialState;
  const listeners = new Set<Listener>();

  return {
    getState: () => state,
    setState: (updater) => {
      const nextState = typeof updater === 'function' ? (updater as (state: T) => T)(state) : updater;
      if (Object.is(state, nextState)) {
        return;
      }
      state = nextState;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useStoreValue<T>(store: ReadableStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
