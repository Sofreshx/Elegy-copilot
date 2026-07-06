'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { discoverCiWorkflows, mapCiToLocal } = require('./ciSync');

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
  }, { scope: 'pr' });

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
  }, { scope: 'pr' });

  assert.equal(result.summary.remoteOnly, 1);
  assert.equal(result.summary.gaps, 0);
  assert.equal(result.summary.readiness, 'ready');
});

test('main-push scope includes push-only main workflows as CI gaps', () => {
  const result = mapCiToLocal({
    workflows: [
      {
        fileName: 'docs-pages.yml',
        isPrRelevant: false,
        isMainPushRelevant: true,
        jobs: [
          { name: 'build', required: true },
        ],
      },
    ],
  }, {
    lanes: {},
  });

  assert.equal(result.summary.totalCiJobs, 1);
  assert.equal(result.summary.gaps, 1);
  assert.equal(result.summary.readiness, 'ci-gap');
  assert.equal(result.mappings[0].workflowFile, 'docs-pages.yml');
  assert.equal(result.mappings[0].jobName, 'build');
});

test('pr scope excludes push-only workflows', () => {
  const result = mapCiToLocal({
    workflows: [
      {
        fileName: 'docs-pages.yml',
        isPrRelevant: false,
        isMainPushRelevant: true,
        jobs: [
          { name: 'build', required: true },
        ],
      },
      {
        fileName: 'repo-ci.yml',
        isPrRelevant: true,
        isMainPushRelevant: true,
        jobs: [
          { name: 'build', required: true },
        ],
      },
    ],
  }, {
    lanes: {
      ci: { ciWorkflow: 'repo-ci.yml', ciJob: 'build' },
    },
  }, { scope: 'pr' });

  assert.equal(result.summary.totalCiJobs, 1);
  assert.equal(result.summary.gaps, 0);
  assert.equal(result.mappings[0].workflowFile, 'repo-ci.yml');
});

test('main-push scope excludes workflows with tag push filters', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-sync-release-'));
  try {
    const workflowsDir = path.join(repoRoot, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });
    fs.writeFileSync(path.join(workflowsDir, 'desktop-preview-release.yml'), [
      'name: Desktop Preview Release',
      'on:',
      '  push:',
      '    branches:',
      '      - main',
      '    tags:',
      "      - '*.*.*'",
      'jobs:',
      '  build-windows-preview:',
      '    runs-on: windows-latest',
    ].join('\n'));

    const workflows = discoverCiWorkflows(repoRoot);
    const workflow = workflows.workflows.find((entry) => entry.fileName === 'desktop-preview-release.yml');

    assert.equal(workflow.isMainPushRelevant, false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

console.log(`\n  ${passed} tests passed\n`);
