'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { discoverCheckPlan } = require('./checkPlanService');

function makeFixture() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elegy-check-plan-'));
  fs.mkdirSync(path.join(repoRoot, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({
    workspaces: ['packages/*'],
    scripts: {
      test: 'node --test',
      lint: 'eslint .',
      typecheck: 'tsc --noEmit',
      build: 'vite build',
    },
  }), 'utf8');
  fs.mkdirSync(path.join(repoRoot, 'packages', 'web'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'packages', 'web', 'package.json'), JSON.stringify({
    scripts: { lint: 'eslint src' },
  }), 'utf8');
  fs.mkdirSync(path.join(repoRoot, '.githooks'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, '.githooks', 'pre-commit'), '#!/bin/sh\n', 'utf8');
  fs.writeFileSync(path.join(repoRoot, 'Cargo.toml'), '[workspace]\nmembers = ["app"]\n', 'utf8');
  fs.writeFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), [
    'name: CI',
    'jobs:',
    '  verify:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: npm run test',
  ].join('\n'), 'utf8');
  return repoRoot;
}

test('discovers deterministic local candidates and classifies workflows without executing them', () => {
  const repoRoot = makeFixture();
  try {
    const before = fs.readdirSync(repoRoot).sort();
    const plan = discoverCheckPlan(repoRoot, { action: 'commit' });
    const repeatedPlan = discoverCheckPlan(repoRoot, { action: 'commit' });

    assert.equal(plan.schemaVersion, 'check-plan/v1');
    assert.equal(plan.action, 'commit');
    assert.equal(plan.planHash, repeatedPlan.planHash);
    assert.ok(plan.candidates.some((check) => check.id === 'package.test'));
    assert.ok(plan.candidates.some((check) => check.id === 'package.packages-web.lint'));
    assert.ok(plan.candidates.some((check) => check.id === 'hook:legacy-pre-commit' && check.classification === 'manual'));
    assert.ok(plan.candidates.some((check) => check.id === 'cargo.fmt'));
    assert.ok(plan.candidates.some((check) => check.source === 'github-workflow' && check.classification === 'remote-only'));
    assert.ok(plan.candidates.every((check) => check.executionPolicy === 'local-command' || check.executionPolicy === 'never-auto-execute'));
    assert.deepEqual(fs.readdirSync(repoRoot).sort(), before);
    assert.equal(fs.existsSync(path.join(repoRoot, '.elegy', 'checks.json')), false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('uses adopted config as policy metadata while retaining native discovery provenance', () => {
  const repoRoot = makeFixture();
  try {
    fs.mkdirSync(path.join(repoRoot, '.elegy'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.elegy', 'checks.json'), JSON.stringify({
      schemaVersion: 2,
      profiles: { push: { label: 'Push', checks: ['typecheck'] } },
      checks: {
        typecheck: {
          enabled: true,
          commands: ['npm run typecheck'],
          defaultProfiles: ['push'],
          required: true,
          blocking: true,
        },
      },
    }), 'utf8');

    const plan = discoverCheckPlan(repoRoot, { action: 'push' });
    const typecheck = plan.candidates.find((check) => check.id === 'typecheck');

    assert.ok(typecheck);
    assert.equal(typecheck.provenance, 'adopted-policy');
    assert.equal(typecheck.required, true);
    assert.ok(plan.requiredChecks.some((check) => check.id === 'typecheck'));
    assert.ok(plan.recommendedChecks.some((check) => check.source === 'elegy-config'));
    assert.equal(plan.selectionMode, 'change-aware');
    assert.match(plan.selectionRationale, /push/i);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('surfaces inferred tools without turning missing scripts into executable commands', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elegy-inferred-tools-'));
  try {
    fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({
      devDependencies: { typescript: '^5.0.0', vitest: '^3.0.0' },
    }), 'utf8');
    fs.writeFileSync(path.join(repoRoot, 'tsconfig.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(repoRoot, 'Makefile'), 'test:\n\ttrue\n', 'utf8');

    const plan = discoverCheckPlan(repoRoot, { action: 'commit' });
    const inferred = plan.candidates.find((check) => check.id === 'tool.typescript');
    const testRunner = plan.candidates.find((check) => check.id === 'tool.test-runner');
    const manual = plan.candidates.find((check) => check.id === 'manual.makefile');

    assert.equal(inferred.classification, 'inferred');
    assert.equal(inferred.executionPolicy, 'never-auto-execute');
    assert.deepEqual(inferred.commands, []);
    assert.equal(testRunner.classification, 'inferred');
    assert.equal(manual.classification, 'manual');
    assert.ok(plan.omittedChecks.some((check) => check.id === 'tool.typescript'));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
