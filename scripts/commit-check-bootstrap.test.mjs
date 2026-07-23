#!/usr/bin/env node

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { orchestrate } from '../engine-assets/skills/commit-check-setup/scripts/commit-check-bootstrap.mjs';

const tempRoots = [];

function makeRepo(packageJson = { name: 'fixture', private: true }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-check-bootstrap-'));
  tempRoots.push(root);
  const init = spawnSync('git', ['init', root], { encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr);
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
});

describe('commit-check skill bootstrap coordinator', () => {
  it('bootstraps missing runtime files and reports repository health separately', () => {
    const root = makeRepo({
      name: 'fixture',
      private: true,
      devDependencies: { prettier: '^3.0.0' },
    });

    const result = orchestrate(root);

    assert.equal(result.setupSucceeded, true);
    assert.equal(result.repositoryChecksPassed, false);
    assert.equal(result.plan.mode, 'bootstrap');
    assert.equal(result.mutation.scriptsInstalled.length, 5);
    assert.equal(result.mutation.hooksInstalled.length, 2);
    assert.equal(result.plan.hooksToInstall.length, 2);
    assert.ok(result.checks.blockingFailures.length > 0);
  });

  it('updates with a backup and preserves user customizations', () => {
    const root = makeRepo();
    orchestrate(root);
    const configPath = path.join(root, '.copilot', 'commit-checks.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.threshold = 91;
    config.customProperty = 'keep-me';
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const beforeUpdate = fs.readFileSync(configPath, 'utf8');

    const result = orchestrate(root);
    const updated = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    assert.equal(result.plan.mode, 'update');
    assert.equal(result.mutation.scriptsInstalled.length, 0);
    assert.equal(updated.threshold, 91);
    assert.equal(updated.customProperty, 'keep-me');
    assert.equal(fs.readFileSync(`${configPath}.bak`, 'utf8'), beforeUpdate);
  });

  it('repairs only missing scripts and preserves existing script bytes', () => {
    const root = makeRepo();
    orchestrate(root);
    const preservedPath = path.join(root, 'scripts', 'commit-check-defaults.mjs');
    const missingPath = path.join(root, 'scripts', 'commit-check-run.mjs');
    fs.appendFileSync(preservedPath, '\n// local customization\n');
    const preserved = fs.readFileSync(preservedPath);
    fs.rmSync(missingPath);

    const result = orchestrate(root);

    assert.equal(result.plan.mode, 'repair');
    assert.deepEqual(fs.readFileSync(preservedPath), preserved);
    assert.equal(fs.existsSync(missingPath), true);
  });

  it('rolls back copied files when the preserved setup runtime is invalid', () => {
    const root = makeRepo();
    const scriptsDir = path.join(root, 'scripts');
    fs.mkdirSync(scriptsDir);
    const invalidSetup = path.join(scriptsDir, 'commit-check-setup.mjs');
    fs.writeFileSync(invalidSetup, 'this is not valid javascript\n');

    assert.throws(() => orchestrate(root), error => {
      assert.equal(error.rollbackCompleted, true);
      return true;
    });
    assert.deepEqual(fs.readdirSync(scriptsDir), ['commit-check-setup.mjs']);
    assert.equal(fs.existsSync(path.join(root, '.copilot')), false);
  });
});
