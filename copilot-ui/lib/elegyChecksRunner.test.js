'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile: realExecFile, execFileSync: realExecFileSync } = require('child_process');

const elegyChecks = require('./elegyChecksRunner');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elegy-checks-runner-'));
  fs.mkdirSync(path.join(root, '.elegy'), { recursive: true });
  fs.writeFileSync(path.join(root, '.elegy', 'checks.json'), JSON.stringify({
    schemaVersion: 1,
    defaultProfile: 'commit',
    profiles: { commit: { label: 'Commit' } },
    checks: {
      lint: {
        commands: ['cargo clippy'],
        description: 'Lint',
        defaultProfiles: ['commit'],
        blocking: true,
        required: true,
        ciWorkflow: 'repo-ci.yml',
        ciJob: 'build',
        ciRequired: true,
      },
    },
  }, null, 2));
  return root;
}

async function run() {
  console.log('\nElegy Checks Runner Tests\n');

  await test('discovers checks from .elegy/checks.json', () => {
    const repo = makeRepo();
    const checks = elegyChecks.discoverChecks(repo);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].name, 'lint');
    assert.equal(checks[0].source, 'elegy-checks');
    assert.equal(checks[0].ciWorkflow, 'repo-ci.yml');
  });

  await test('transforms rust run output to existing checks response shape', () => {
    const result = elegyChecks.transformRunResult('/repo', {
      runId: 'run-1',
      timestamp: '2026-07-06T00:00:00Z',
      overallPass: false,
      blockingFailures: ['lint'],
      lanes: {
        lint: {
          status: 'FAIL',
          exitCode: 1,
          durationMs: 12,
          details: 'failed',
          blocking: true,
          commands: [{ command: 'cargo clippy', exitCode: 1 }],
        },
      },
    });
    assert.equal(result.source, 'elegy-checks');
    assert.equal(result.allPassed, false);
    assert.equal(result.checksFailed, 1);
    assert.equal(result.results[0].checkName, 'lint');
    assert.equal(result.results[0].error, 'failed');
  });

  await test('transforms advisory warnings without failing the gate', () => {
    const result = elegyChecks.transformRunResult('/repo', {
      runId: 'run-2',
      timestamp: '2026-07-06T00:00:00Z',
      overallPass: true,
      blockingFailures: [],
      lanes: {
        readme: {
          status: 'WARN',
          exitCode: 1,
          durationMs: 12,
          details: 'README missing',
          blocking: false,
          gateStrength: 'advisory',
          commands: [{ command: 'node check.js', exitCode: 1 }],
        },
      },
    });
    assert.equal(result.allPassed, true);
    assert.equal(result.checksFailed, 1);
    assert.equal(result.results[0].status, 'WARN');
  });

  await test('preserves evidence context and lane taxonomy from the run contract', () => {
    const result = elegyChecks.transformRunResult('/repo', {
      runId: 'run-context',
      timestamp: '2026-07-06T00:00:00Z',
      overallPass: true,
      branch: 'feature/proof',
      head: 'abc123',
      dirtyHash: 'dirty123',
      configHash: 'config123',
      planHash: 'plan123',
      action: 'push',
      selectionMode: 'change-aware',
      runnerVersion: '0.2.0',
      source: 'local',
      lanes: {
        lint: {
          status: 'PASS',
          details: 'Passed',
          gateStrength: 'blocking',
          determinism: 'deterministic-runnable',
          sourcePack: 'node-typescript',
          tags: ['lint'],
          severity: 'error',
          promotionState: 'enforced',
          owner: 'repo',
        },
      },
    });
    assert.equal(result.branch, 'feature/proof');
    assert.equal(result.planHash, 'plan123');
    assert.equal(result.results[0].gateStrength, 'blocking');
    assert.equal(result.results[0].sourcePack, 'node-typescript');
  });

  await test('normalizes Rust evidence field names for existing API clients', () => {
    const result = elegyChecks.transformRunResult('/repo', {
      runId: 'run-rust-fields',
      timestamp: '2026-07-06T00:00:00Z',
      overallPass: true,
      dirtyTreeFingerprint: 'dirty-rust',
      planIdentity: { path: '/tmp/check-plan.json', hash: 'plan-rust' },
      lanes: {},
    });
    assert.equal(result.dirtyHash, 'dirty-rust');
    assert.equal(result.planHash, 'plan-rust');
  });

  await test('passes an explicit all-enabled selection to the Elegy runner', async () => {
    const repo = makeRepo();
    const configFile = path.join(repo, '.elegy', 'checks.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    config.checks.integration = {
      commands: ['npm run integration'],
      defaultProfiles: ['ci-local'],
      timeoutMs: 300000,
    };
    fs.writeFileSync(configFile, JSON.stringify(config), 'utf8');
    const previousBinary = process.env.ELEGY_CHECKS_BIN;
    const calls = [];
    process.env.ELEGY_CHECKS_BIN = path.join(repo, 'elegy-checks-test.exe');
    elegyChecks.__setDeps({
      execFile: (...args) => {
        calls.push(args);
        const callback = args[args.length - 1];
        callback(null, JSON.stringify({
          runId: 'run-all',
          timestamp: '2026-07-06T00:00:00Z',
          overallPass: true,
          lanes: { lint: { status: 'PASS', details: 'Passed', commands: [] } },
        }), '');
        return { on() {} };
      },
    });
    try {
      await elegyChecks.runAllChecksWithProfile(repo, { runAll: true, planPath: '/tmp/check-plan.json' });
      assert.ok(calls[0][1].includes('--all'));
      assert.equal(calls[0][1].includes('--profile'), false);
      assert.deepEqual(calls[0][1].slice(calls[0][1].indexOf('--plan'), calls[0][1].indexOf('--plan') + 2), ['--plan', '/tmp/check-plan.json']);
      assert.ok(calls[0][2].timeout >= 400000);
    } finally {
      if (previousBinary === undefined) delete process.env.ELEGY_CHECKS_BIN;
      else process.env.ELEGY_CHECKS_BIN = previousBinary;
      elegyChecks.__setDeps({ execFile: realExecFile });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  await test('does not send explicit checks together with --all', async () => {
    const repo = makeRepo();
    const previousBinary = process.env.ELEGY_CHECKS_BIN;
    const calls = [];
    process.env.ELEGY_CHECKS_BIN = path.join(repo, 'elegy-checks-test.exe');
    elegyChecks.__setDeps({
      execFile: (...args) => {
        calls.push(args);
        const callback = args[args.length - 1];
        callback(null, JSON.stringify({
          runId: 'run-all-selected',
          timestamp: '2026-07-06T00:00:00Z',
          overallPass: true,
          lanes: { lint: { status: 'PASS', details: 'Passed', commands: [] } },
        }), '');
        return { on() {} };
      },
    });
    try {
      await elegyChecks.runAllChecksWithProfile(repo, {
        runAll: true,
        selectedLanes: ['lint'],
        planPath: '/tmp/check-plan.json',
      });
      const args = calls[0][1];
      assert.ok(args.includes('--all'));
      assert.equal(args.includes('--check'), false);
    } finally {
      if (previousBinary === undefined) delete process.env.ELEGY_CHECKS_BIN;
      else process.env.ELEGY_CHECKS_BIN = previousBinary;
      elegyChecks.__setDeps({ execFile: realExecFile });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  await test('forwards the requested evidence action to the Elegy runner', async () => {
    const repo = makeRepo();
    const previousBinary = process.env.ELEGY_CHECKS_BIN;
    const calls = [];
    process.env.ELEGY_CHECKS_BIN = path.join(repo, 'elegy-checks-test.exe');
    elegyChecks.__setDeps({
      execFile: (...args) => {
        calls.push(args);
        const callback = args[args.length - 1];
        callback(null, JSON.stringify({
          runId: 'run-push',
          timestamp: '2026-07-06T00:00:00Z',
          overallPass: true,
          lanes: { lint: { status: 'PASS', details: 'Passed', commands: [] } },
        }), '');
        return { on() {} };
      },
    });
    try {
      await elegyChecks.runAllChecksWithProfile(repo, { action: 'push' });
      const args = calls[0][1];
      assert.deepEqual(args.slice(args.indexOf('--action'), args.indexOf('--action') + 2), ['--action', 'push']);
    } finally {
      if (previousBinary === undefined) delete process.env.ELEGY_CHECKS_BIN;
      else process.env.ELEGY_CHECKS_BIN = previousBinary;
      elegyChecks.__setDeps({ execFile: realExecFile });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  await test('runs zero-config discovered local proof without writing repository policy', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'elegy-checks-zero-config-'));
    const previousBinary = process.env.ELEGY_CHECKS_BIN;
    const binary = path.join(__dirname, '..', '..', 'elegy-checks', 'target', 'debug', process.platform === 'win32' ? 'elegy-checks.exe' : 'elegy-checks');
    process.env.ELEGY_CHECKS_BIN = binary;
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
      scripts: { test: 'node -e "process.exit(0)"' },
    }), 'utf8');
    try {
      const { discoverCheckPlan } = require('./checkPlanService');
      const plan = discoverCheckPlan(repo, { action: 'ci-local', selectionMode: 'explicit-all' });
      const result = await elegyChecks.runAllChecks(repo);
      assert.equal(result.source, 'elegy-checks');
      assert.equal(result.allPassed, true);
      assert.equal(result.planHash, plan.planHash);
      assert.ok(result.results.some((lane) => lane.checkName === 'package.test'));
      assert.equal(fs.existsSync(path.join(repo, '.elegy', 'checks.json')), false);
    } finally {
      if (previousBinary === undefined) delete process.env.ELEGY_CHECKS_BIN;
      else process.env.ELEGY_CHECKS_BIN = previousBinary;
      const { deriveRepoId, getStatePath } = require('./checkState');
      fs.rmSync(path.dirname(path.dirname(getStatePath(deriveRepoId(repo)))), { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  await test('hydrates the latest lanes and paged history from the state contract', () => {
    const repo = makeRepo();
    const previousBinary = process.env.ELEGY_CHECKS_BIN;
    process.env.ELEGY_CHECKS_BIN = path.join(repo, 'elegy-checks-test.exe');
    elegyChecks.__setDeps({
      execFileSync: () => JSON.stringify({
        repoId: 'repo-1',
        repoPath: repo,
        hasState: true,
        lastRun: {
          runId: 'run-latest',
          timestamp: '2026-07-06T00:00:00Z',
          profile: 'push',
          overallPass: true,
          configHash: 'config',
          branch: 'feature/proof',
          head: 'abc123',
          dirtyTreeFingerprint: 'dirty123',
          planIdentity: { path: '/tmp/check-plan.json', hash: 'plan123' },
          lanes: { lint: { status: 'PASS', details: 'Passed', commands: [] } },
        },
        history: [{ runId: 'run-previous', profile: 'commit', overallPass: false }],
        freshness: { fresh: true, reason: 'fresh' },
      }),
    });
    try {
      const state = elegyChecks.getState(repo);
      assert.equal(state.lastRun.lanes.lint.status, 'PASS');
      assert.equal(state.lastRun.branch, 'feature/proof');
      assert.equal(state.lastRun.dirtyHash, 'dirty123');
      assert.equal(state.lastRun.planHash, 'plan123');
      assert.equal(state.history[0].runId, 'run-previous');
    } finally {
      if (previousBinary === undefined) delete process.env.ELEGY_CHECKS_BIN;
      else process.env.ELEGY_CHECKS_BIN = previousBinary;
      elegyChecks.__setDeps({ execFileSync: realExecFileSync });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  await test('refreshes state using the selection mode from the last run', () => {
    const repo = makeRepo();
    const previousBinary = process.env.ELEGY_CHECKS_BIN;
    const previousElegyHome = process.env.ELEGY_HOME;
    const tempElegyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'elegy-check-state-home-'));
    const calls = [];
    process.env.ELEGY_CHECKS_BIN = path.join(repo, 'elegy-checks-test.exe');
    process.env.ELEGY_HOME = tempElegyHome;
    elegyChecks.__setDeps({
      execFileSync: (_binary, args) => {
        calls.push(args);
        if (args[1] === '--help') return 'state --plan';
        if (args.includes('--plan')) {
          const planPath = args[args.indexOf('--plan') + 1];
          const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
          calls.planSelectionMode = plan.selectionMode;
        }
        return JSON.stringify({
          repoId: 'repo-1',
          repoPath: repo,
          hasState: true,
          lastRun: {
            runId: 'run-ai-selected',
            timestamp: '2026-07-06T00:00:00Z',
            action: 'commit',
            selectionMode: 'ai-selected',
            overallPass: true,
            lanes: {},
          },
          history: [],
          freshness: { fresh: true, reason: 'fresh' },
        });
      },
    });
    try {
      elegyChecks.getState(repo);
      assert.equal(calls.planSelectionMode, 'ai-selected');
    } finally {
      if (previousBinary === undefined) delete process.env.ELEGY_CHECKS_BIN;
      else process.env.ELEGY_CHECKS_BIN = previousBinary;
      if (previousElegyHome === undefined) delete process.env.ELEGY_HOME;
      else process.env.ELEGY_HOME = previousElegyHome;
      elegyChecks.__setDeps({ execFileSync: realExecFileSync });
      fs.rmSync(tempElegyHome, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  await test('reads bundled check packs through the CLI', () => {
    const repo = path.resolve(__dirname, '..', '..');
    const result = elegyChecks.packsList(repo);
    assert.ok(Array.isArray(result.packs));
    assert.ok(result.packs.some((pack) => pack.id === 'core'));
  });

  await test('syncCiState maps local checks to workflow jobs', () => {
    const repo = makeRepo();
    fs.mkdirSync(path.join(repo, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.github', 'workflows', 'repo-ci.yml'), [
      'name: Repo CI',
      'on:',
      '  pull_request:',
      '    branches: [main]',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '',
    ].join('\n'));
    const result = elegyChecks.syncCiState(repo, { scope: 'pr' });
    assert.equal(result.syncResult.summary.mapped, 1);
    assert.equal(result.syncResult.summary.gaps, 0);
  });

  console.log(`\n  ${passed} tests passed\n`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
