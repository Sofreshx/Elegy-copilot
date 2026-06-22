#!/usr/bin/env node
/**
 * ui-check.test.mjs — Comprehensive tests for ui-check.mjs runner
 *
 * Uses Node.js built-in test runner (node:test + node:assert/strict).
 * All tests are ESM and create/clean up temp directories as needed.
 *
 * Usage:
 *   node --test scripts/ui-check.test.mjs
 */

'use strict';

// ---------------------------------------------------------------------------
// IMPORTS
// ---------------------------------------------------------------------------

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const SCHEMA_DIR = path.join(REPO_ROOT, 'contracts', 'session-state');
const CONFIG_SCHEMA = path.join(SCHEMA_DIR, 'ui-check.schema.json');
const REPORT_SCHEMA = path.join(SCHEMA_DIR, 'ui-check-runtime-report.schema.json');

// ---------------------------------------------------------------------------
// LAZY LOADING — module imported once before all tests
// ---------------------------------------------------------------------------

let parseArgs;
let validateConfig;
let validatePaths;
let executeTargetCommands;
let validateRuntimeReport;
let generateReport;
let main;

before(async () => {
  const mod = await import('./ui-check.mjs');
  parseArgs = mod.parseArgs;
  validateConfig = mod.validateConfig;
  validatePaths = mod.validatePaths;
  executeTargetCommands = mod.executeTargetCommands;
  validateRuntimeReport = mod.validateRuntimeReport;
  generateReport = mod.generateReport;
  main = mod.main;
});

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/**
 * Create a unique temp directory and return its path.
 */
function createTempDir() {
  const tmp = path.join(os.tmpdir(), `ui-check-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

/**
 * Recursively remove a directory tree with retries.
 * On Windows, child process handles can cause EBUSY; retry with delay.
 */
function rmDir(dirPath, maxRetries = 3) {
  if (!fs.existsSync(dirPath)) return;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt === maxRetries - 1) {
        // Last attempt — warn and give up, temp dirs get cleaned by OS
        console.error(`Warning: could not remove temp dir ${dirPath}: ${err.message}`);
        return;
      }
      // Wait before retrying to let OS release file handles
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

/**
 * Build a minimal valid config object for use in tests.
 * All paths are relative to a repoRoot that owns the referenced files.
 */
function makeValidConfig(repoRoot) {
  // Ensure the paths exist
  const compRoot = path.join(repoRoot, 'src', 'components');
  const tokenFile = path.join(repoRoot, 'src', 'tokens.css');
  const iconRoot = path.join(repoRoot, 'src', 'icons');
  const patternDoc = path.join(repoRoot, 'docs', 'patterns');

  fs.mkdirSync(compRoot, { recursive: true });
  fs.mkdirSync(tokenFile.replace(/[^/\\]*$/, ''), { recursive: true });
  fs.writeFileSync(tokenFile, '', 'utf-8');
  fs.mkdirSync(iconRoot, { recursive: true });
  fs.mkdirSync(patternDoc, { recursive: true });

  return {
    schemaVersion: 1,
    inventory: {
      componentRoots: [{ path: 'src/components', description: 'Components' }],
      tokenFiles: [{ path: 'src/tokens.css', format: 'css' }],
      iconRoots: [{ path: 'src/icons', library: 'custom' }],
      patternDocs: [{ path: 'docs/patterns', description: 'Patterns' }],
    },
    targets: {
      'test-target': {
        lane: 'browser',
        workingDirectory: '.',
        validationCommands: [
          { id: 'test-cmd', command: 'node -e "console.log(\'ok\')"', description: 'Test command' },
        ],
        routes: [
          {
            id: 'test-route',
            path: '/test',
            viewports: ['desktop', 'mobile'],
            states: ['default', 'loading'],
            excludedStates: [
              { state: 'loading', reason: 'No loading state for test route' },
            ],
            description: 'Test route',
          },
        ],
        evidenceRoot: './evidence/test',
        runtimeReport: 'runtime-report.json',
      },
    },
  };
}

/**
 * Build a minimal valid runtime report for a given target config.
 */
function makeValidRuntimeReport(target) {
  const results = [];
  const routes = target.routes || [];
  const excludedSet = new Map();

  for (const route of routes) {
    for (const ex of route.excludedStates || []) {
      excludedSet.set(`${route.id}:${ex.state}`, true);
    }

    for (const vp of route.viewports || []) {
      for (const st of route.states || []) {
        const key = `${route.id}:${vp}:${st}`;
        const isExcluded = excludedSet.has(`${route.id}:${st}`);

        const entry = {
          routeId: route.id,
          viewport: vp,
          state: st,
          status: isExcluded ? 'excluded' : 'pass',
        };

        if (!isExcluded) {
          entry.screenshot = `screenshots/${route.id}-${vp}-${st}.png`;
        }

        results.push(entry);
      }
    }
  }

  return {
    schemaVersion: 1,
    targetId: 'test-target',
    surfaceResults: results,
  };
}

// Simple config that follows the schema but references non-existent paths
const MINIMAL_INVALID_SCHEMA_CONFIG = {
  schemaVersion: 1,
  inventory: {
    componentRoots: [{ path: 'src/components' }],
    tokenFiles: [{ path: 'src/tokens.css' }],
    iconRoots: [{ path: 'src/icons' }],
    patternDocs: [{ path: 'docs/patterns' }],
  },
  targets: {
    'test-target': {
      lane: 'browser',
      workingDirectory: '.',
      routes: [
        {
          id: 'test-route',
          path: '/test',
          viewports: ['desktop'],
          states: ['default'],
        },
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// 1. parseArgs TESTS
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('returns defaults when no arguments given', () => {
    const flags = parseArgs([]);
    assert.strictEqual(flags.config, null);
    assert.deepStrictEqual(flags.target, []);
    assert.strictEqual(flags.validateOnly, false);
    assert.strictEqual(flags.json, false);
    assert.strictEqual(flags.repo, null);
    assert.strictEqual(flags.timeout, 120000);
    assert.strictEqual(flags.help, false);
  });

  it('--config sets config path', () => {
    const flags = parseArgs(['--config', 'custom/path.json']);
    assert.strictEqual(flags.config, 'custom/path.json');
  });

  it('--target single populates targets array', () => {
    const flags = parseArgs(['--target', 'header']);
    assert.deepStrictEqual(flags.target, ['header']);
  });

  it('--target repeated populates targets array with multiple entries', () => {
    const flags = parseArgs(['--target', 'header', '--target', 'footer']);
    assert.deepStrictEqual(flags.target, ['header', 'footer']);
  });

  it('--validate-only sets flag', () => {
    const flags = parseArgs(['--validate-only']);
    assert.strictEqual(flags.validateOnly, true);
  });

  it('--json sets flag', () => {
    const flags = parseArgs(['--json']);
    assert.strictEqual(flags.json, true);
  });

  it('--repo sets repo path', () => {
    const flags = parseArgs(['--repo', '/some/repo']);
    assert.strictEqual(flags.repo, '/some/repo');
  });

  it('--timeout parses valid number', () => {
    const flags = parseArgs(['--timeout', '30000']);
    assert.strictEqual(flags.timeout, 30000);
  });

  it('--timeout with invalid value falls back to default', () => {
    const flags = parseArgs(['--timeout', 'not-a-number']);
    assert.strictEqual(flags.timeout, 120000);
  });

  it('--timeout with zero or negative falls back to default', () => {
    const flags1 = parseArgs(['--timeout', '0']);
    assert.strictEqual(flags1.timeout, 120000);

    const flags2 = parseArgs(['--timeout', '-100']);
    assert.strictEqual(flags2.timeout, 120000);
  });

  it('--help sets help flag', () => {
    const flags = parseArgs(['--help']);
    assert.strictEqual(flags.help, true);
  });

  it('-h (short form) sets help flag', () => {
    const flags = parseArgs(['-h']);
    assert.strictEqual(flags.help, true);
  });

  it('unknown flags are silently ignored', () => {
    const flags = parseArgs(['--unknown-flag', '--another-one']);
    assert.strictEqual(flags.config, null);
    assert.strictEqual(flags.help, false);
  });
});

// ---------------------------------------------------------------------------
// 2. validateConfig TESTS
// ---------------------------------------------------------------------------

describe('validateConfig', () => {
  let tmpDir;

  before(() => {
    tmpDir = createTempDir();
  });

  after(() => {
    rmDir(tmpDir);
  });

  it('valid config passes', () => {
    const config = makeValidConfig(tmpDir);
    const configPath = path.join(tmpDir, 'valid-config.json');
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf-8');

    const result = validateConfig(configPath, CONFIG_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
    assert.ok(result.config !== null);
  });

  it('missing config file returns valid:false with error', () => {
    const missingPath = path.join(tmpDir, 'does-not-exist.json');
    const result = validateConfig(missingPath, CONFIG_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors[0].includes('Cannot read config file'));
    assert.strictEqual(result.config, null);
  });

  it('invalid JSON config returns valid:false', () => {
    const configPath = path.join(tmpDir, 'bad-json.json');
    fs.writeFileSync(configPath, 'this is not json {', 'utf-8');

    const result = validateConfig(configPath, CONFIG_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors[0].includes('not valid JSON'));
    assert.strictEqual(result.config, null);
  });

  it('config missing required fields fails schema validation', () => {
    const configPath = path.join(tmpDir, 'missing-fields.json');
    // Missing "inventory" and "targets" (only schemaVersion present)
    fs.writeFileSync(configPath, JSON.stringify({ schemaVersion: 1 }), 'utf-8');

    const result = validateConfig(configPath, CONFIG_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it('config with "N/A" in states enum returns valid:false', () => {
    const configPath = path.join(tmpDir, 'na-state.json');
    const config = {
      schemaVersion: 1,
      inventory: {
        componentRoots: [{ path: 'src/components' }],
        tokenFiles: [{ path: 'src/tokens.css' }],
        iconRoots: [{ path: 'src/icons' }],
        patternDocs: [{ path: 'docs/patterns' }],
      },
      targets: {
        'test-target': {
          lane: 'browser',
          workingDirectory: '.',
          routes: [
            {
              id: 'test-route',
              path: '/test',
              viewports: ['desktop'],
              states: ['default', 'N/A'],
            },
          ],
        },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf-8');

    const result = validateConfig(configPath, CONFIG_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('states')));
  });

  it('config with excludedState missing reason field returns valid:false', () => {
    const configPath = path.join(tmpDir, 'no-reason.json');
    const config = {
      schemaVersion: 1,
      inventory: {
        componentRoots: [{ path: 'src/components' }],
        tokenFiles: [{ path: 'src/tokens.css' }],
        iconRoots: [{ path: 'src/icons' }],
        patternDocs: [{ path: 'docs/patterns' }],
      },
      targets: {
        'test-target': {
          lane: 'browser',
          workingDirectory: '.',
          routes: [
            {
              id: 'test-route',
              path: '/test',
              viewports: ['desktop'],
              states: ['default'],
              excludedStates: [
                { state: 'loading' }, // missing "reason"
              ],
            },
          ],
        },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf-8');

    const result = validateConfig(configPath, CONFIG_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('reason')));
  });

  it('config with unknown target key fails pattern validation', () => {
    const configPath = path.join(tmpDir, 'bad-target-key.json');
    const config = {
      schemaVersion: 1,
      inventory: {
        componentRoots: [{ path: 'src/components' }],
        tokenFiles: [{ path: 'src/tokens.css' }],
        iconRoots: [{ path: 'src/icons' }],
        patternDocs: [{ path: 'docs/patterns' }],
      },
      targets: {
        'UPPERCASE-Target': {
          // violates ^[a-z0-9]+(-[a-z0-9]+)*$
          lane: 'browser',
          workingDirectory: '.',
          routes: [
            {
              id: 'test-route',
              path: '/test',
              viewports: ['desktop'],
              states: ['default'],
            },
          ],
        },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf-8');

    const result = validateConfig(configPath, CONFIG_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, false);
  });

  it('config with invalid viewport enum value fails schema validation', () => {
    const configPath = path.join(tmpDir, 'bad-viewport.json');
    const config = {
      schemaVersion: 1,
      inventory: {
        componentRoots: [{ path: 'src/components' }],
        tokenFiles: [{ path: 'src/tokens.css' }],
        iconRoots: [{ path: 'src/icons' }],
        patternDocs: [{ path: 'docs/patterns' }],
      },
      targets: {
        'test-target': {
          lane: 'browser',
          workingDirectory: '.',
          routes: [
            {
              id: 'test-route',
              path: '/test',
              viewports: ['tablet'], // not in enum ["desktop", "mobile"]
              states: ['default'],
            },
          ],
        },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf-8');

    const result = validateConfig(configPath, CONFIG_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('viewports')));
  });
});

// ---------------------------------------------------------------------------
// 3. validatePaths TESTS
// ---------------------------------------------------------------------------

describe('validatePaths', () => {
  let tmpDir;

  before(() => {
    tmpDir = createTempDir();
  });

  after(() => {
    rmDir(tmpDir);
  });

  it('valid config with all existing paths passes', () => {
    const config = makeValidConfig(tmpDir);
    const result = validatePaths(config, tmpDir);
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.missingPaths, []);
  });

  it('missing component root returns valid:false with correct path label', () => {
    const config = {
      schemaVersion: 1,
      inventory: {
        componentRoots: [{ path: 'nonexistent-components' }],
        tokenFiles: [{ path: 'src/tokens.css' }],
        iconRoots: [{ path: 'src/icons' }],
        patternDocs: [{ path: 'docs/patterns' }],
      },
      targets: {
        'test-target': {
          lane: 'browser',
          workingDirectory: '.',
          routes: [
            {
              id: 'test-route',
              path: '/test',
              viewports: ['desktop'],
              states: ['default'],
            },
          ],
        },
      },
    };
    // Create only the token file so other paths exist
    fs.mkdirSync(path.dirname(path.join(tmpDir, 'src/tokens.css')), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src/tokens.css'), '', 'utf-8');
    fs.mkdirSync(path.join(tmpDir, 'src/icons'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'docs/patterns'), { recursive: true });

    const result = validatePaths(config, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.missingPaths.some((p) => p.includes('nonexistent-components')));
  });

  it('missing token file returns valid:false', () => {
    const config = {
      schemaVersion: 1,
      inventory: {
        componentRoots: [{ path: 'src/components' }],
        tokenFiles: [{ path: 'missing/tokens.css' }],
        iconRoots: [{ path: 'src/icons' }],
        patternDocs: [{ path: 'docs/patterns' }],
      },
      targets: {
        'test-target': {
          lane: 'browser',
          workingDirectory: '.',
          routes: [
            {
              id: 'test-route',
              path: '/test',
              viewports: ['desktop'],
              states: ['default'],
            },
          ],
        },
      },
    };
    // Ensure other referenced paths exist
    fs.mkdirSync(path.join(tmpDir, 'src/components'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src/icons'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'docs/patterns'), { recursive: true });

    const result = validatePaths(config, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.missingPaths.some((p) => p.includes('missing/tokens.css')));
  });

  it('missing working directory returns valid:false', () => {
    const config = {
      schemaVersion: 1,
      inventory: {
        componentRoots: [{ path: 'src/components' }],
        tokenFiles: [{ path: 'src/tokens.css' }],
        iconRoots: [{ path: 'src/icons' }],
        patternDocs: [{ path: 'docs/patterns' }],
      },
      targets: {
        'test-target': {
          lane: 'browser',
          workingDirectory: 'nonexistent/workdir',
          routes: [
            {
              id: 'test-route',
              path: '/test',
              viewports: ['desktop'],
              states: ['default'],
            },
          ],
        },
      },
    };
    // Ensure other referenced paths exist
    fs.mkdirSync(path.join(tmpDir, 'src/components'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src/tokens.css'), '', 'utf-8');
    fs.mkdirSync(path.join(tmpDir, 'src/icons'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'docs/patterns'), { recursive: true });

    const result = validatePaths(config, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.missingPaths.some((p) => p.includes('nonexistent/workdir')));
  });

  it('returns valid when config has no inventory (edge case)', () => {
    const result = validatePaths({}, tmpDir);
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.missingPaths, []);
  });

  it('returns valid when config is null (edge case)', () => {
    const result = validatePaths(null, tmpDir);
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.missingPaths, []);
  });

  it('reports multiple missing paths at once', () => {
    const config = {
      schemaVersion: 1,
      inventory: {
        componentRoots: [{ path: 'missing/a' }],
        tokenFiles: [{ path: 'missing/b.css' }],
        iconRoots: [{ path: 'missing/c' }],
        patternDocs: [{ path: 'missing/d' }],
      },
      targets: {
        'test-target': {
          lane: 'browser',
          workingDirectory: 'missing/e',
          routes: [
            {
              id: 'test-route',
              path: '/test',
              viewports: ['desktop'],
              states: ['default'],
            },
          ],
        },
      },
    };

    const result = validatePaths(config, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.missingPaths.length >= 5);
  });
});

// ---------------------------------------------------------------------------
// 4. executeTargetCommands TESTS
// ---------------------------------------------------------------------------

describe('executeTargetCommands', () => {
  let tmpDir;
  const runId = 'test-run-123';
  const targetId = 'test-target';

  before(() => {
    tmpDir = createTempDir();
  });

  after(() => {
    rmDir(tmpDir);
  });

  it('successful command returns exitCode 0 and no failure', () => {
    const target = {
      validationCommands: [
        { id: 'ok-cmd', command: 'node -e "console.log(\'ok\')"' },
      ],
    };
    const result = executeTargetCommands(target, targetId, runId, tmpDir, 5000, tmpDir, {});
    assert.strictEqual(result.failed, false);
    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.results[0].exitCode, 0);
    assert.strictEqual(result.results[0].skipped, undefined);
    assert.strictEqual(result.results[0].timedOut, false);
    assert.ok(typeof result.results[0].duration === 'number');
    assert.ok(result.results[0].stdout.includes('ok'));
  });

  it('failing command returns exitCode 1 and marks target failed', () => {
    const target = {
      validationCommands: [
        { id: 'fail-cmd', command: 'node -e "process.exit(1)"' },
      ],
    };
    const result = executeTargetCommands(target, targetId, runId, tmpDir, 5000, tmpDir, {});
    assert.strictEqual(result.failed, true);
    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.results[0].exitCode, 1);
    assert.strictEqual(result.results[0].timedOut, false);
  });

  it('skipped commands after a failure', () => {
    const target = {
      validationCommands: [
        { id: 'first-fail', command: 'node -e "process.exit(1)"' },
        { id: 'should-skip', command: 'node -e "console.log(\'never runs\')"' },
        { id: 'also-skip', command: 'node -e "console.log(\'also never runs\')"' },
      ],
    };
    const result = executeTargetCommands(target, targetId, runId, tmpDir, 5000, tmpDir, {});
    assert.strictEqual(result.failed, true);

    // First command failed
    assert.strictEqual(result.results[0].exitCode, 1);
    assert.strictEqual(result.results[0].skipped, undefined);

    // Subsequent commands skipped
    assert.strictEqual(result.results[1].skipped, true);
    assert.strictEqual(result.results[1].exitCode, null);
    assert.strictEqual(result.results[2].skipped, true);
    assert.strictEqual(result.results[2].exitCode, null);
  });

  it('command timeout is detected', { timeout: 5000 }, () => {
    const target = {
      validationCommands: [
        {
          id: 'timeout-cmd',
          command: 'node -e "const d=Date.now();while(Date.now()-d<10000){}"',
          timeout: 100,
        },
      ],
    };
    const result = executeTargetCommands(target, targetId, runId, tmpDir, 5000, tmpDir, {});
    assert.strictEqual(result.failed, true);
    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.results[0].timedOut, true);
  });

  it('environment variables are passed to the child process', () => {
    const target = {
      validationCommands: [
        {
          id: 'env-test',
          command: 'node -e "console.log(JSON.stringify({runId:process.env.UI_CHECK_RUN_ID,targetId:process.env.UI_CHECK_TARGET_ID,evidenceDir:process.env.UI_CHECK_EVIDENCE_DIR}))"',
        },
      ],
    };
    const result = executeTargetCommands(target, targetId, runId, tmpDir, 5000, tmpDir, {});
    assert.strictEqual(result.failed, false);

    let parsed;
    try {
      parsed = JSON.parse(result.results[0].stdout.trim());
    } catch {
      assert.fail('Could not parse env var output as JSON');
    }
    assert.strictEqual(parsed.runId, runId);
    assert.strictEqual(parsed.targetId, targetId);
    // evidenceDir should be the absolute tmpDir path (normalized)
    assert.strictEqual(parsed.evidenceDir, path.resolve(tmpDir));
  });

  it('empty commands array returns no results and no failure', () => {
    const target = {
      validationCommands: [],
    };
    const result = executeTargetCommands(target, targetId, runId, tmpDir, 5000, tmpDir, {});
    assert.strictEqual(result.failed, false);
    assert.deepStrictEqual(result.results, []);
  });

  it('undefined commands array returns no results and no failure', () => {
    const target = {};
    const result = executeTargetCommands(target, targetId, runId, tmpDir, 5000, tmpDir, {});
    assert.strictEqual(result.failed, false);
    assert.deepStrictEqual(result.results, []);
  });

  it('extra env vars are merged and override defaults', () => {
    const target = {
      validationCommands: [
        {
          id: 'custom-env',
          command: 'node -e "console.log(JSON.stringify({myVar:process.env.MY_CUSTOM_VAR,evDir:process.env.UI_CHECK_EVIDENCE_DIR}))"',
        },
      ],
    };
    const result = executeTargetCommands(target, targetId, runId, tmpDir, 5000, tmpDir, {
      MY_CUSTOM_VAR: 'custom-value',
    });
    assert.strictEqual(result.failed, false);

    let parsed;
    try {
      parsed = JSON.parse(result.results[0].stdout.trim());
    } catch {
      assert.fail('Could not parse custom env output');
    }
    assert.strictEqual(parsed.myVar, 'custom-value');
    assert.strictEqual(parsed.evDir, path.resolve(tmpDir));
  });

  it('target with workingDirectory resolves cwd correctly', () => {
    // Create a subdirectory for this test
    const subDir = path.join(tmpDir, 'sub-workdir');
    fs.mkdirSync(subDir, { recursive: true });
    // Write a marker file
    fs.writeFileSync(path.join(subDir, 'marker.txt'), 'present', 'utf-8');

    const target = {
      workingDirectory: 'sub-workdir',
      validationCommands: [
        {
          id: 'cwd-test',
          command: 'node -e "console.log(require(\'fs\').readdirSync(\'.\').filter(f=>f===\'marker.txt\').join(\',\'))"',
        },
      ],
    };
    const result = executeTargetCommands(target, targetId, runId, tmpDir, 5000, tmpDir, {});
    assert.strictEqual(result.failed, false);
    assert.ok(result.results[0].stdout.includes('marker.txt'));
  });
});

// ---------------------------------------------------------------------------
// 5. validateRuntimeReport TESTS
// ---------------------------------------------------------------------------

describe('validateRuntimeReport', () => {
  let tmpDir;
  let target;

  before(() => {
    tmpDir = createTempDir();

    // Build a target with routes matching the test data
    target = {
      routes: [
        {
          id: 'homepage',
          path: '/',
          viewports: ['desktop', 'mobile'],
          states: ['default', 'loading', 'empty', 'error'],
          excludedStates: [
            { state: 'loading', reason: 'No loading state for homepage' },
          ],
        },
      ],
    };
  });

  after(() => {
    rmDir(tmpDir);
  });

  function writeReport(data) {
    const reportPath = path.join(tmpDir, 'runtime-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(data), 'utf-8');
    return reportPath;
  }

  it('valid report with all entries passes', () => {
    const report = makeValidRuntimeReport(target);
    const reportPath = writeReport(report);
    const result = validateRuntimeReport(reportPath, target, REPORT_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  it('missing result for required route/viewport/state returns valid:false', () => {
    const report = makeValidRuntimeReport(target);
    // Remove one result
    report.surfaceResults = report.surfaceResults.filter(
      (r) => !(r.routeId === 'homepage' && r.viewport === 'desktop' && r.state === 'default')
    );
    const reportPath = writeReport(report);
    const result = validateRuntimeReport(reportPath, target, REPORT_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('Missing result')));
  });

  it('excluded state with status "excluded" passes', () => {
    const report = makeValidRuntimeReport(target);
    // The valid report already has excluded states with status "excluded"
    const reportPath = writeReport(report);
    const result = validateRuntimeReport(reportPath, target, REPORT_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, true);
  });

  it('excluded state with wrong status returns valid:false', () => {
    const report = makeValidRuntimeReport(target);
    // Change an excluded state to "pass"
    const loadingResult = report.surfaceResults.find(
      (r) => r.routeId === 'homepage' && r.state === 'loading' && r.status === 'excluded'
    );
    if (loadingResult) {
      loadingResult.status = 'pass';
    }
    const reportPath = writeReport(report);
    const result = validateRuntimeReport(reportPath, target, REPORT_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('excluded')));
  });

  it('missing screenshot on non-excluded state returns valid:false', () => {
    const report = makeValidRuntimeReport(target);
    // Remove screenshot from a non-excluded result
    const passResult = report.surfaceResults.find(
      (r) => r.routeId === 'homepage' && r.viewport === 'desktop' && r.state === 'default'
    );
    if (passResult) {
      delete passResult.screenshot;
    }
    const reportPath = writeReport(report);
    const result = validateRuntimeReport(reportPath, target, REPORT_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('missing screenshot')));
  });

  it('console errors on non-excluded state returns valid:false', () => {
    const report = makeValidRuntimeReport(target);
    // Add console errors to a non-excluded result
    const passResult = report.surfaceResults.find(
      (r) => r.routeId === 'homepage' && r.viewport === 'desktop' && r.state === 'default'
    );
    if (passResult) {
      passResult.consoleErrors = ['TypeError: x is undefined', 'Warning: useLayoutEffect'];
    }
    const reportPath = writeReport(report);
    const result = validateRuntimeReport(reportPath, target, REPORT_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('console error')));
  });

  it('network failures on non-excluded state returns valid:false', () => {
    const report = makeValidRuntimeReport(target);
    // Add network failures to a non-excluded result
    const passResult = report.surfaceResults.find(
      (r) => r.routeId === 'homepage' && r.viewport === 'desktop' && r.state === 'default'
    );
    if (passResult) {
      passResult.networkFailures = [
        { url: 'https://api.example.com/data', status: 500 },
      ];
    }
    const reportPath = writeReport(report);
    const result = validateRuntimeReport(reportPath, target, REPORT_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('network failure')));
  });

  it('invalid JSON report file returns valid:false', () => {
    const reportPath = path.join(tmpDir, 'bad-report.json');
    fs.writeFileSync(reportPath, 'not json at all', 'utf-8');
    const result = validateRuntimeReport(reportPath, target, REPORT_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('not valid JSON')));
  });

  it('report that fails schema validation returns valid:false', () => {
    // Missing required fields
    const badReport = { surfaceResults: [] };
    const reportPath = writeReport(badReport);
    const result = validateRuntimeReport(reportPath, target, REPORT_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('[schema]')));
  });

  it('missing report file returns valid:false', () => {
    const missingPath = path.join(tmpDir, 'no-such-report.json');
    const result = validateRuntimeReport(missingPath, target, REPORT_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('Cannot read runtime report')));
  });

  it('excluded state missing reason in config generates a warning', () => {
    // Create a target where excluded state has no reason
    const targetNoReason = {
      routes: [
        {
          id: 'homepage',
          path: '/',
          viewports: ['desktop'],
          states: ['default', 'loading'],
          excludedStates: [
            { state: 'loading' }, // missing reason
          ],
        },
      ],
    };
    const report = makeValidRuntimeReport(targetNoReason);
    const reportPath = writeReport(report);
    const result = validateRuntimeReport(reportPath, targetNoReason, REPORT_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, true);
    assert.ok(result.warnings.length > 0);
    assert.ok(result.warnings.some((w) => w.includes('missing a reason')));
  });

  it('excluded state that is missing from report results generates error', () => {
    const targetWithExcluded = {
      routes: [
        {
          id: 'homepage',
          path: '/',
          viewports: ['desktop'],
          states: ['default', 'loading'],
          excludedStates: [
            { state: 'loading', reason: 'Intentionally excluded' },
          ],
        },
      ],
    };
    // Report with NO results for the excluded state at all
    const report = {
      schemaVersion: 1,
      targetId: 'test-target',
      surfaceResults: [
        {
          routeId: 'homepage',
          viewport: 'desktop',
          state: 'default',
          status: 'pass',
          screenshot: 'screenshot.png',
        },
        // missing: loading/excluded result completely
      ],
    };
    const reportPath = writeReport(report);
    const result = validateRuntimeReport(reportPath, targetWithExcluded, REPORT_SCHEMA, tmpDir);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('Missing excluded result')));
  });
});

// ---------------------------------------------------------------------------
// 6. generateReport TESTS
// ---------------------------------------------------------------------------

describe('generateReport', () => {
  let tmpDir;

  before(() => {
    tmpDir = createTempDir();
  });

  after(() => {
    rmDir(tmpDir);
  });

  it('writes report.json and report.md to evidence dir', () => {
    const results = {
      runId: 'test-run-999',
      targets: {
        'header': {
          configValid: true,
          pathsValid: true,
          commandResults: [
            { id: 'test', command: 'echo ok', exitCode: 0, stdout: 'ok\n', stderr: '', timedOut: false, duration: 10 },
          ],
          runtimeReportResult: { valid: true, errors: [], warnings: [] },
          passed: true,
        },
      },
    };

    generateReport(results, tmpDir, '/fake/repo');

    const jsonPath = path.join(tmpDir, 'report.json');
    const mdPath = path.join(tmpDir, 'report.md');

    assert.strictEqual(fs.existsSync(jsonPath), true);
    assert.strictEqual(fs.existsSync(mdPath), true);
  });

  it('report.json contains runId, timestamp, and per-target results', () => {
    const results = {
      runId: 'test-run-abc',
      targets: {
        'header': {
          configValid: true,
          pathsValid: true,
          commandResults: [
            { id: 'test', command: 'echo ok', exitCode: 0, stdout: 'ok\n', stderr: '', timedOut: false, duration: 10 },
          ],
          runtimeReportResult: null,
          passed: true,
        },
      },
    };

    generateReport(results, tmpDir, '/fake/repo');

    const jsonContent = JSON.parse(fs.readFileSync(path.join(tmpDir, 'report.json'), 'utf-8'));
    assert.strictEqual(jsonContent.runId, 'test-run-abc');
    assert.ok(typeof jsonContent.timestamp === 'string');
    assert.ok(jsonContent.timestamp.length > 0);
    assert.ok(jsonContent.targets.hasOwnProperty('header'));
    assert.strictEqual(jsonContent.targets.header.passed, true);
  });

  it('report.md contains markdown table with target results', () => {
    const results = {
      runId: 'test-run-xyz',
      targets: {
        'header': {
          configValid: true,
          pathsValid: true,
          commandResults: [
            { id: 'test', command: 'echo ok', exitCode: 0, stdout: 'ok\n', stderr: '', timedOut: false, duration: 10 },
          ],
          runtimeReportResult: null,
          passed: true,
        },
      },
    };

    generateReport(results, tmpDir, '/fake/repo');

    const mdContent = fs.readFileSync(path.join(tmpDir, 'report.md'), 'utf-8');
    assert.ok(mdContent.includes('# UI Check Report'));
    assert.ok(mdContent.includes('| Target | Config | Paths | Commands | Report | Overall |'));
    assert.ok(mdContent.includes('test-run-xyz'));
    assert.ok(mdContent.includes('ALL PASSED'));
  });

  it('report.md marks failed targets correctly', () => {
    const results = {
      runId: 'test-run-fail',
      targets: {
        'broken-target': {
          configValid: false,
          configErrors: ['(root): must have required property targets'],
          pathsValid: true,
          commandResults: [],
          runtimeReportResult: null,
          passed: false,
        },
      },
    };

    generateReport(results, tmpDir, '/fake/repo');

    const mdContent = fs.readFileSync(path.join(tmpDir, 'report.md'), 'utf-8');
    assert.ok(mdContent.includes('SOME FAILED'));
    assert.ok(mdContent.includes('Config Validation Failed'));
    assert.ok(mdContent.includes('must have required property targets'));
  });

  it('returns jsonPath and mdPath', () => {
    const results = {
      runId: 'test-return',
      targets: {},
    };

    const paths = generateReport(results, tmpDir, '/fake/repo');
    assert.ok(paths.jsonPath);
    assert.ok(paths.mdPath);
    assert.strictEqual(paths.jsonPath, path.join(tmpDir, 'report.json'));
    assert.strictEqual(paths.mdPath, path.join(tmpDir, 'report.md'));
  });
});

// ---------------------------------------------------------------------------
// 7. main INTEGRATION TESTS (lightweight)
// ---------------------------------------------------------------------------

describe('main (integration)', () => {
  it('--help exits with code 0', async () => {
    const exitCode = await main({ help: true });
    assert.strictEqual(exitCode, 0);
  });

  it('--validate-only --json with invalid config exits with code 1', async () => {
    // Use a nonexistent config path
    const exitCode = await main({
      config: path.join(REPO_ROOT, 'nonexistent-config.json'),
      validateOnly: true,
      json: true,
      target: [],
      repo: null,
      timeout: 5000,
      help: false,
    });
    assert.strictEqual(exitCode, 1);
  });

  it('--validate-only with valid config exits with code 0', { timeout: 10000 }, async () => {
    // Create a temp config that references paths that actually exist in the repo
    const tmpDir = createTempDir();
    try {
      // Use paths that exist relative to repo root
      const config = {
        schemaVersion: 1,
        inventory: {
          componentRoots: [{ path: 'copilot-ui/ui/src/components' }],
          tokenFiles: [{ path: 'copilot-ui/ui/src/styles/tokens.css' }],
          iconRoots: [{ path: 'copilot-ui/ui/src/components/AppIcon.tsx' }],
          patternDocs: [{ path: 'docs/system/copilot-ui-guide.md' }],
        },
        targets: {
          'settings': {
            lane: 'browser',
            workingDirectory: '.',
            routes: [
              {
                id: 'settings-default',
                path: 'navigation:settings',
                viewports: ['desktop'],
                states: ['default'],
              },
            ],
          },
        },
      };

      const configPath = path.join(tmpDir, 'valid-integration-config.json');
      fs.writeFileSync(configPath, JSON.stringify(config), 'utf-8');

      const exitCode = await main({
        config: configPath,
        validateOnly: true,
        json: false,
        target: [],
        repo: REPO_ROOT,
        timeout: 5000,
        help: false,
      });
      assert.strictEqual(exitCode, 0);
    } finally {
      rmDir(tmpDir);
    }
  });
});
