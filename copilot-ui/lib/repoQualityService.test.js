'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildRepoQualityStatus,
  createRepoQualitySetupTask,
} = require('./repoQualityService');

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-quality-'));
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true }));
  return root;
}

test('dual check authorities require migration even when hooks are active', () => {
  const root = makeRepo();
  fs.mkdirSync(path.join(root, '.elegy'));
  fs.mkdirSync(path.join(root, '.copilot'));
  fs.mkdirSync(path.join(root, '.githooks'));
  fs.writeFileSync(path.join(root, '.elegy', 'checks.json'), '{"schemaVersion":2,"checks":{}}');
  fs.writeFileSync(path.join(root, '.copilot', 'commit-checks.json'), '{"schemaVersion":3,"lanes":{}}');
  fs.writeFileSync(path.join(root, '.githooks', 'pre-commit'), '#!/bin/sh\n');

  const status = buildRepoQualityStatus(root, {
    git: () => ({ status: 0, stdout: '.githooks\n', stderr: '' }),
    github: () => ({ available: false, reason: 'offline' }),
  });

  assert.equal(status.schemaVersion, 'repo-quality-status/v1');
  assert.equal(status.readiness, 'repair-required');
  assert.equal(status.nextAction.id, 'migrate-quality-setup');
  assert.equal(status.local.hooks.manager, 'elegy-legacy');
  assert.ok(status.drift.some((entry) => entry.id === 'dual-check-authority'));
});

test('existing lefthook setup is detected without requiring legacy hooks', () => {
  const root = makeRepo();
  fs.mkdirSync(path.join(root, '.elegy'));
  fs.writeFileSync(path.join(root, '.elegy', 'checks.json'), '{"schemaVersion":2,"checks":{}}');
  fs.writeFileSync(path.join(root, 'lefthook.yml'), 'pre-commit:\n  jobs: []\n');

  const status = buildRepoQualityStatus(root, {
    git: () => ({ status: 0, stdout: '.git/hooks\n', stderr: '' }),
    github: () => ({ available: false, reason: 'offline' }),
  });

  assert.equal(status.local.hooks.manager, 'lefthook');
  assert.equal(status.local.hooks.configured, true);
  assert.notEqual(status.readiness, 'setup-required');
});

test('setup task is scoped to the selected repository and stays non-mutating', async () => {
  const root = makeRepo();
  const before = fs.readdirSync(root).sort();

  const result = await createRepoQualitySetupTask(root, {
    launchTask: null,
    auditSummary: { readiness: 'setup-required', findings: ['hooks missing'] },
  });

  assert.equal(result.schemaVersion, 'repo-quality-setup-task/v1');
  assert.equal(result.launched, false);
  assert.equal(result.skill, 'repo-quality-setup');
  assert.match(result.prompt, /repo-quality-setup/);
  assert.ok(result.prompt.includes(root));
  assert.deepEqual(fs.readdirSync(root).sort(), before);
});

test('setup task uses an available launcher and returns its task id', async () => {
  const root = makeRepo();
  const calls = [];

  const result = await createRepoQualitySetupTask(root, {
    launchTask: async (request) => {
      calls.push(request);
      return { taskId: 'task-123' };
    },
    auditSummary: { readiness: 'repair-required', findings: [] },
  });

  assert.equal(result.launched, true);
  assert.equal(result.taskId, 'task-123');
  assert.equal(calls[0].cwd, root);
  assert.match(calls[0].prompt, /audit.*preview.*approval/i);
});
