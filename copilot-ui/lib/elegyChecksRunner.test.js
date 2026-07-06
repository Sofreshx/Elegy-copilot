'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
