import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Node.js built-in modules used by gitCheckRunner.js before importing.
// Factory must be self-contained (hoisted before import evaluation).
// Use 'fs' not 'node:fs' to match CJS require('fs') in gitCheckRunner.js.
vi.mock('fs', () => {
  const m = { existsSync: vi.fn(), readFileSync: vi.fn() };
  return { default: m, ...m };
});

vi.mock('child_process', () => {
  const m = { execFile: vi.fn() };
  return { default: m, ...m };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
import { discoverChecks, runAllChecks } from '../lib/gitCheckRunner';
import fs from 'fs';
import cp from 'child_process';

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

beforeEach(() => {
  vi.clearAllMocks();
});

// Quick debug: verify the mock is actually intercepting fs calls
it('mock verification: fs.existsSync mock is wired to CJS require', () => {
  // This test verifies that the CJS module (gitCheckRunner.js) sees the same
  // mock that the test file imports. Call a function from gitCheckRunner that
  // uses fs.existsSync in a controlled way.
  const path = require('path');

  // Manually test the mock through the module's dependent code
  (fs.existsSync as any).mockImplementation((p: any) => {
    return String(p).includes('commit-checks.json');
  });
  (fs.readFileSync as any).mockReturnValue(JSON.stringify({
    lanes: { lint: { commands: ['npm run lint'] } },
  }));

  // Import resolveCommitCheckConfig directly
  const { resolveCommitCheckConfig } = require('../lib/gitCheckRunner');
  const result = resolveCommitCheckConfig('/fake/repo');

  console.log('DEBUG existsSync calls:', (fs.existsSync as any).mock.calls);
  console.log('DEBUG readFileSync calls:', (fs.readFileSync as any).mock.calls);
  console.log('DEBUG resolveCommitCheckConfig result:', JSON.stringify(result));

  // This check tells us if the CJS require sees the mock
  expect(result.exists).toBe(true);
});

describe('discoverChecks', () => {
  it('prefers canonical config over legacy KNOWN_CHECKS', () => {
    const existsMock = (fs.existsSync as any);
    const readMock = (fs.readFileSync as any);

    // Mock: .copilot/commit-checks.json exists, legacy scripts do not
    existsMock.mockImplementation((p: any) => {
      const pStr = normalizePath(String(p));
      if (pStr.includes('commit-checks.json')) return true;
      // For all other paths (legacy scripts, .githooks), return false
      return false;
    });
    readMock.mockReturnValue(JSON.stringify({
      lanes: {
        lint: { commands: ['npm run lint'] },
        format: { commands: ['npm run format'] },
        coverage: { commands: ['npm run coverage'], enabled: false },
      },
    }));

    const result = discoverChecks('/fake/repo');

    // Should find 2 enabled lanes from canonical config
    expect(result).toHaveLength(2);
    expect(result[0].source).toBe('commit-check');
    expect(result[0].name).toBe('lint');
    expect(result[0].path).toContain('npm run lint');
    expect(result[1].name).toBe('format');

    // No legacy checks included
    const legacyNames = result.filter((c: any) => c.source === 'legacy');
    expect(legacyNames).toHaveLength(0);
  });

  it('falls back to legacy KNOWN_CHECKS when no config exists', () => {
    const existsMock = (fs.existsSync as any);

    // Mock: No canonical config, but legacy scripts exist
    existsMock.mockImplementation((p: any) => {
      const pStr = normalizePath(String(p));
      if (pStr.includes('commit-checks.json')) return false;
      if (pStr.includes('validate-')) return true;
      return false;
    });

    const result = discoverChecks('/fake/repo');

    // Should find legacy KNOWN_CHECKS
    expect(result.length).toBeGreaterThan(0);
    // All entries should have source === 'legacy'
    result.forEach((c: any) => {
      expect(c.source).toBe('legacy');
    });
  });
});

// ─── Tests 3 & 4: runAllChecks with canonical config ─────────────────────────

describe('runAllChecks', () => {
  function setupCanonicalMocks(configLanes: Record<string, any>, scriptOutput: any) {
    (fs.existsSync as any).mockImplementation((p: any) => {
      const pStr = normalizePath(String(p));
      if (pStr.includes('commit-checks.json')) return true;
      return false;
    });
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({ lanes: configLanes }));

    const outputJson = JSON.stringify(scriptOutput);
    (cp.execFile as any).mockImplementation((...args: any[]) => {
      const callback = args[args.length - 1];
      if (typeof callback === 'function') {
        callback(null, outputJson, '');
      }
      return { on: vi.fn(), stdout: { on: vi.fn() }, stderr: { on: vi.fn() } };
    });
  }

  it('response includes source and checkedAt fields', async () => {
    setupCanonicalMocks(
      { lint: { commands: ['npm run lint'] } },
      {
        timestamp: '2026-06-08T12:00:00.000Z',
        compositeScore: 90,
        overallPass: true,
        lanes: {
          lint: { status: 'PASS', score: 100, details: 'No issues', commands: [] },
        },
      },
    );

    const result = await runAllChecks('/fake/repo');

    expect(result).toHaveProperty('source', 'commit-check');
    expect(result).toHaveProperty('checkedAt');
    expect(typeof result.checkedAt).toBe('string');
    expect(result.checkedAt.length).toBeGreaterThan(0);
    expect(result).toHaveProperty('checksAvailable');
    expect(result).toHaveProperty('checksRun');
    expect(result).toHaveProperty('checksPassed');
    expect(result).toHaveProperty('checksFailed');
    expect(result).toHaveProperty('allPassed');
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('message');
  });

  it('transforms canonical script output to API response shape', async () => {
    setupCanonicalMocks(
      {
        lint: { commands: ['npm run lint'] },
        test: { commands: ['npm test'] },
      },
      {
        timestamp: '2026-06-08T12:00:00.000Z',
        compositeScore: 50,
        overallPass: false,
        lanes: {
          lint: { status: 'PASS', score: 100, details: 'Clean', commands: [] },
          test: { status: 'FAIL', score: 0, details: '1 failed, 10 passed', commands: [] },
        },
      },
    );

    const result = await runAllChecks('/fake/repo');

    // Top-level shape
    expect(result.source).toBe('commit-check');
    expect(result.checksAvailable).toBe(2);
    expect(result.checksRun).toBe(2);
    expect(result.checksPassed).toBe(1);
    expect(result.checksFailed).toBe(1);
    expect(result.allPassed).toBe(false);

    // Results array
    expect(result.results).toHaveLength(2);

    // PASS → passed: true, no error
    const lintResult = result.results.find((r: any) => r.checkName === 'lint');
    expect(lintResult).toBeDefined();
    expect(lintResult!.passed).toBe(true);
    expect(lintResult!.error).toBeUndefined();
    expect(lintResult!.output).toBe('Clean');

    // FAIL → passed: false, error set
    const testResult = result.results.find((r: any) => r.checkName === 'test');
    expect(testResult).toBeDefined();
    expect(testResult!.passed).toBe(false);
    expect(testResult!.error).toBe('1 failed, 10 passed');
    expect(testResult!.output).toBe('1 failed, 10 passed');
  });

  it('handles SKIP status as passed with no error', async () => {
    setupCanonicalMocks(
      { coverage: { commands: [] } },
      {
        timestamp: '2026-06-08T12:00:00.000Z',
        compositeScore: null,
        overallPass: true,
        lanes: {
          coverage: { status: 'SKIP', score: null, details: 'No commands configured', commands: [] },
        },
      },
    );

    const result = await runAllChecks('/fake/repo');

    expect(result.checksAvailable).toBe(1);
    expect(result.checksRun).toBe(1);
    expect(result.checksPassed).toBe(1);
    expect(result.checksFailed).toBe(0);
    expect(result.allPassed).toBe(true);

    const coverageResult = result.results[0];
    expect(coverageResult.passed).toBe(true);
    expect(coverageResult.error).toBeUndefined();
    expect(coverageResult.output).toBe('No commands configured');
  });

  it('falls back to source:none when no canonical config exists and no legacy checks', async () => {
    (fs.existsSync as any).mockImplementation((p: any) => {
      const pStr = normalizePath(String(p));
      if (pStr.includes('commit-checks.json')) return false;
      if (pStr.includes('validate-')) return false;
      return false;
    });

    const result = await runAllChecks('/fake/repo');

    // No checks discovered → source: 'none'
    expect(result.source).toBe('none');
    expect(result.checksAvailable).toBe(0);
    expect(result.checkedAt).toBeDefined();
  });
});
