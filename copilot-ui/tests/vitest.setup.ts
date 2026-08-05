import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

const jsdom = globalThis.jsdom as { window: Window } | undefined;

const installGlobalStorage = (
  key: 'localStorage' | 'sessionStorage',
  source: () => Storage | undefined,
) => {
  const current = globalThis[key];
  if (jsdom && typeof current?.clear !== 'function') {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      get: () => source(),
    });
  }
};

installGlobalStorage('localStorage', () => jsdom?.window.localStorage);
installGlobalStorage('sessionStorage', () => jsdom?.window.sessionStorage);

afterEach(() => {
  cleanup();
});
