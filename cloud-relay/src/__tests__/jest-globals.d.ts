declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
interface ExpectMatchers {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
  toBeUndefined: () => void;
  toContain: (expected: unknown) => void;
}

interface ExpectStatic {
  (value: unknown): ExpectMatchers;
  arrayContaining: (expected: unknown[]) => unknown;
}

declare const expect: ExpectStatic;
