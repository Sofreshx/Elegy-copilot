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
  toThrow: (expected?: string | RegExp | Error) => void;
  toHaveBeenCalled: () => void;
  toHaveBeenCalledWith: (...args: unknown[]) => void;
  toHaveBeenCalledTimes: (expected: number) => void;
  toBeInstanceOf: (expected: unknown) => void;
  toBeGreaterThanOrEqual: (expected: number) => void;
  toBeLessThan: (expected: number) => void;
  toBeLessThanOrEqual: (expected: number) => void;
  toStrictEqual: (expected: unknown) => void;
  toHaveProperty: (key: string, value?: unknown) => void;
  resolves: ExpectMatchers;
  rejects: ExpectMatchers;
}

interface ExpectStatic {
  (value: unknown): ExpectMatchers;
  arrayContaining: (expected: unknown[]) => unknown;
}

declare const expect: ExpectStatic;
