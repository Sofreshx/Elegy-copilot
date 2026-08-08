import { useCallback, useRef, useSyncExternalStore } from 'react';

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

export function shallowEqual<T>(left: T, right: T): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return keys.length === Object.keys(rightRecord).length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(rightRecord, key)
      && Object.is(leftRecord[key], rightRecord[key]));
}

export function useStoreSelector<T, Selected>(
  store: ReadableStore<T>,
  selector: (state: T) => Selected,
  isEqual: (left: Selected, right: Selected) => boolean = Object.is,
): Selected {
  const selectorRef = useRef(selector);
  const equalityRef = useRef(isEqual);
  const cacheRef = useRef<{ state: T; selector: typeof selector; selected: Selected } | null>(null);
  selectorRef.current = selector;
  equalityRef.current = isEqual;

  const getSnapshot = useCallback(() => {
    const state = store.getState();
    const cached = cacheRef.current;
    if (cached && Object.is(cached.state, state) && cached.selector === selectorRef.current) {
      return cached.selected;
    }
    const selected = selectorRef.current(state);
    if (cached && equalityRef.current(cached.selected, selected)) {
      cacheRef.current = { state, selector: selectorRef.current, selected: cached.selected };
      return cached.selected;
    }
    cacheRef.current = { state, selector: selectorRef.current, selected };
    return selected;
  }, [store]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
