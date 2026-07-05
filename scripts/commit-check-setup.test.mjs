#!/usr/bin/env node

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup } from './commit-check-setup.mjs';
import { validateCommitCheckConfig } from './commit-check-defaults.mjs';

const tempRoots = [];

function makeTempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-check-setup-'));
  tempRoots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture',
    private: true,
    devDependencies: {
      typescript: '^5.0.0',
      vitest: '^3.0.0',
      eslint: '^9.0.0',
    },
    scripts: {
      test: 'vitest run',
      typecheck: 'tsc --noEmit',
      lint: 'eslint .',
    },
  }, null, 2));
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }));
  fs.writeFileSync(path.join(root, 'eslint.config.mjs'), 'export default [];\n');
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

describe('commit-check-setup protocol', () => {
  it('generates a valid schema v3 config with lane metadata', async () => {
    const root = makeTempRepo();
    const { configPath, config } = await setup(root, { force: true, noScript: true });
    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const validation = validateCommitCheckConfig(onDisk);

    assert.equal(config.schemaVersion, 3);
    assert.equal(onDisk.schemaVersion, 3);
    assert.equal(validation.valid, true, validation.errors.join('; '));
    assert.equal(onDisk.lanes.test.blocking, true);
    assert.deepEqual(onDisk.lanes.test.defaultProfiles, ['commit', 'ci-local']);
    assert.equal(onDisk.lanes.typecheck.blocking, true);
  });
});
