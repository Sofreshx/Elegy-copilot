declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const beforeEach: (fn: () => void) => void;
declare const afterEach: (fn: () => void) => void;
interface ExpectMatchers {
  not: ExpectMatchers;
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
  toBeNull: () => void;
  toBeUndefined: () => void;
  toContain: (expected: unknown) => void;
  toBeGreaterThan: (expected: number) => void;
  toBeTruthy: () => void;
  toBeFalsy: () => void;
}

interface ExpectStatic {
  (value: unknown): ExpectMatchers;
  arrayContaining: (expected: unknown[]) => unknown;
}

declare const expect: ExpectStatic;
