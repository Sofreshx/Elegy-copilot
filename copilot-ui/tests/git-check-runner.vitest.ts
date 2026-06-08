import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import real modules for mock creation
import fs from 'fs';
import { execFile as realExecFile } from 'child_process';

// We use dependency injection (__setDeps) to replace internal deps with mocks,
// avoiding the complexity of mocking CJS native module resolution.

import {
  discoverChecks,
  runAllChecks,
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

  it('falls back to legacy KNOWN_CHECKS when no config exists', () => {
    // Mock: No canonical config, but legacy scripts exist
    mockExistsSync.mockImplementation((p: any) => {
      const pStr = String(p).replace(/\\/g, '/');
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
    mockExistsSync.mockImplementation((p: any) => {
      const pStr = String(p).replace(/\\/g, '/');
      if (pStr.includes('commit-checks.json')) return true;
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
