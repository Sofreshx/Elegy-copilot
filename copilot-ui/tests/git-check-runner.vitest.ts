import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import real modules for mock creation
import fs from 'fs';
import { execFile as realExecFile } from 'child_process';

// We use dependency injection (__setDeps) to replace internal deps with mocks,
// avoiding the complexity of mocking CJS native module resolution.

import {
  discoverChecks,
  runAllChecks,
  runAllChecksWithProfile,
  resolveCommitCheckConfig,
  __setDeps,
} from '../lib/gitCheckRunner';

// Create mock functions
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockExecFile = vi.fn();

beforeEach(() => {
  // Inject mock dependencies before each test
  __setDeps({
    fs: { existsSync: mockExistsSync, readFileSync: mockReadFileSync } as any,
    execFile: mockExecFile as any,
  });
});

afterEach(() => {
  // Restore real deps after each test
  __setDeps({
    fs,
    execFile: realExecFile,
  });
});

// ─── Test 1: Prefers canonical config ────────────────────────────────────────

describe('discoverChecks', () => {
  it('prefers canonical config over legacy KNOWN_CHECKS', () => {
    // Mock: .copilot/commit-checks.json exists, legacy scripts do not
    mockExistsSync.mockImplementation((p: any) => {
      const pStr = String(p).replace(/\\/g, '/');
      if (pStr.includes('commit-checks.json')) return true;
      if (pStr.includes('scripts/commit-check-run.mjs')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
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

  it('returns empty when no canonical config and KNOWN_CHECKS is empty', () => {
    // Mock: No canonical config, no legacy scripts, no .githooks
    mockExistsSync.mockImplementation((p: any) => {
      const pStr = String(p).replace(/\\/g, '/');
      if (pStr.includes('commit-checks.json')) return false;
      return false;
    });

    const result = discoverChecks('/fake/repo');

    // KNOWN_CHECKS is empty — no legacy checks discovered
    expect(result.length).toBe(0);
  });

  it('discovers git-hooks when .githooks directory exists', () => {
    // Mock: No canonical config, KNOWN_CHECKS empty, but .githooks/ exists
    mockExistsSync.mockImplementation((p: any) => {
      const pStr = String(p).replace(/\\/g, '/');
      if (pStr.includes('commit-checks.json')) return false;
      if (pStr.endsWith('.githooks')) return true;
      if (pStr.endsWith('pre-commit')) return true;
      if (pStr.endsWith('pre-push')) return true;
      return false;
    });

    const result = discoverChecks('/fake/repo');

    // Should find pre-commit and pre-push from .githooks/
    expect(result.length).toBe(2);
    expect(result.find((c: any) => c.name === 'git-hooks-pre-commit')).toBeTruthy();
    expect(result.find((c: any) => c.name === 'git-hooks-pre-push')).toBeTruthy();
    result.forEach((c: any) => {
      expect(c.source).toBe('legacy');
    });
  });
});

// ─── Tests 3 & 4: runAllChecks with canonical config ─────────────────────────

describe('runAllChecks', () => {
  function setupCanonicalMocks(configLanes: Record<string, any>, scriptOutput: any) {
    mockExistsSync.mockImplementation((p: any) => {
      const pStr = String(p).replace(/\\/g, '/');
      if (pStr.includes('commit-checks.json')) return true;
      if (pStr.includes('scripts/commit-check-run.mjs')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ lanes: configLanes }));

    const outputJson = JSON.stringify(scriptOutput);
    mockExecFile.mockImplementation((...args: any[]) => {
      // execFile(command, args, options, callback) — callback is last arg
      const callback = args[args.length - 1];
      if (typeof callback === 'function') {
        callback(null, outputJson, '');
      }
      return { on: vi.fn() };
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

  it('uses lane timeout budget for full canonical runs', async () => {
    setupCanonicalMocks(
      {
        lint: { commands: ['npm run lint'], timeoutMs: 60000 },
        test: { commands: ['npm test'], timeoutMs: 120000 },
        release: { commands: ['npm run release'], timeoutMs: 300000 },
      },
      {
        timestamp: '2026-06-08T12:00:00.000Z',
        compositeScore: 100,
        overallPass: true,
        lanes: {
          lint: { status: 'PASS', score: 100, details: 'Clean', commands: [] },
          test: { status: 'PASS', score: 100, details: 'Passed', commands: [] },
          release: { status: 'PASS', score: 100, details: 'Passed', commands: [] },
        },
      },
    );

    await runAllChecks('/fake/repo');

    const options = mockExecFile.mock.calls[0][2];
    expect(options.timeout).toBeGreaterThan(120000);
    expect(options.timeout).toBe(510000);
  });

  it('orders skip reasons before skipped lane arguments for the canonical runner', async () => {
    setupCanonicalMocks(
      {
        lint: { commands: ['npm run lint'], defaultProfiles: ['commit'], skippable: true },
        test: { commands: ['npm test'], defaultProfiles: ['commit'] },
      },
      {
        timestamp: '2026-06-08T12:00:00.000Z',
        compositeScore: 100,
        overallPass: true,
        skippedLanes: { lint: 'known flaky' },
        lanes: {
          test: { status: 'PASS', score: 100, details: 'Passed', commands: [] },
        },
      },
    );

    await runAllChecksWithProfile('/fake/repo', {
      profile: 'commit',
      skipLanes: new Map([['lint', 'known flaky']]),
    });

    const args = mockExecFile.mock.calls[0][1];
    expect(args).toContain('--profile');
    expect(args).toContain('commit');
    expect(args).toContain('--reason');
    expect(args).toContain('known flaky');
    expect(args.indexOf('--reason')).toBeLessThan(args.indexOf('--skip'));
  });

  it('returns parse diagnostics when canonical output is invalid', async () => {
    mockExistsSync.mockImplementation((p: any) => {
      const pStr = String(p).replace(/\\/g, '/');
      if (pStr.includes('commit-checks.json')) return true;
      if (pStr.includes('scripts/commit-check-run.mjs')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      lanes: {
        lint: { commands: ['npm run lint'], timeoutMs: 60000 },
      },
    }));
    mockExecFile.mockImplementation((...args: any[]) => {
      const callback = args[args.length - 1];
      if (typeof callback === 'function') {
        callback(Object.assign(new Error('Command failed'), { killed: true }), '{"partial":', 'fatal stderr');
      }
      return { on: vi.fn() };
    });

    const result = await runAllChecks('/fake/repo');

    expect(result.allPassed).toBe(false);
    expect(result.message).toContain('Failed to parse commit-check output');
    expect(result.message).toContain('timed out');
    expect(result.errorOutput).toContain('fatal stderr');
    expect(result.errorOutput).toContain('stdout tail');
  });

  it('falls back to source:none when no canonical config exists and no legacy checks', async () => {
    mockExistsSync.mockImplementation((p: any) => {
      const pStr = String(p).replace(/\\/g, '/');
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
