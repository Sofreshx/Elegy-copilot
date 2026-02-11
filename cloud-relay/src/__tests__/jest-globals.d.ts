declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const beforeAll: (fn: () => void | Promise<void>) => void;
declare const afterAll: (fn: () => void | Promise<void>) => void;
declare const beforeEach: (fn: () => void | Promise<void>) => void;
declare const afterEach: (fn: () => void | Promise<void>) => void;
interface ExpectMatchers {
  not: ExpectMatchers;
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
  toBeNull: () => void;
  toBeUndefined: () => void;
  toBeDefined: () => void;
  toContain: (expected: unknown) => void;
  toMatch: (expected: string | RegExp) => void;
  toMatchObject: (expected: Record<string, unknown>) => void;
  toHaveLength: (expected: number) => void;
  toBeGreaterThan: (expected: number) => void;
  toBeTruthy: () => void;
  toBeFalsy: () => void;
}

interface ExpectStatic {
  (value: unknown): ExpectMatchers;
  arrayContaining: (expected: unknown[]) => unknown;
}

declare const expect: ExpectStatic;
