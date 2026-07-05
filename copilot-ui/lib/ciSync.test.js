'use strict';

const assert = require('node:assert/strict');
const { mapCiToLocal } = require('./ciSync');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

console.log('\nCI Sync Tests\n');

test('maps configured CI jobs and reports remote-only jobs separately from gaps', () => {
  const result = mapCiToLocal({
    workflows: [
      {
        fileName: 'repo-ci.yml',
        isPrRelevant: true,
        jobs: [
          { name: 'build', required: true },
          { name: 'desktop-tauri-preview', required: true },
          { name: 'unmapped', required: true },
        ],
      },
    ],
  }, {
    lanes: {
      test: { ciWorkflow: 'repo-ci.yml', ciJob: 'build' },
    },
    ciRemoteOnly: [
      {
        workflow: 'repo-ci.yml',
        job: 'desktop-tauri-preview',
        reason: 'windows-only',
      },
    ],
  });

  assert.equal(result.summary.totalCiJobs, 3);
  assert.equal(result.summary.mapped, 1);
  assert.equal(result.summary.remoteOnly, 1);
  assert.equal(result.summary.gaps, 1);
  assert.equal(result.summary.readiness, 'ci-gap');
  assert.equal(result.mappings.find((m) => m.jobName === 'desktop-tauri-preview').status, 'remote-only');
});

test('remote-only jobs do not make readiness fail when no true gaps remain', () => {
  const result = mapCiToLocal({
    workflows: [
      {
        fileName: 'repo-ci.yml',
        isPrRelevant: true,
        jobs: [
          { name: 'desktop-tauri-preview', required: true },
        ],
      },
    ],
  }, {
    lanes: {},
    ciRemoteOnly: [
      { workflow: 'repo-ci.yml', job: 'desktop-tauri-preview' },
    ],
  });

  assert.equal(result.summary.remoteOnly, 1);
  assert.equal(result.summary.gaps, 0);
  assert.equal(result.summary.readiness, 'ready');
});

console.log(`\n  ${passed} tests passed\n`);
