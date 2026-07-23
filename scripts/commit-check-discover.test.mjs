#!/usr/bin/env node

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discover } from './commit-check-discover.mjs';

const tempRoots = [];

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

afterEach(() => {
  while (tempRoots.length > 0) fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
});

describe('commit-check discovery', () => {
  it('expands object-form wildcard workspaces without network-installing tools', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-check-discover-'));
    tempRoots.push(root);
    writeJson(path.join(root, 'package.json'), {
      name: 'fixture',
      private: true,
      workspaces: { packages: ['packages/*'] },
    });
    writeJson(path.join(root, 'packages', 'app', 'package.json'), {
      name: 'app',
      private: true,
      devDependencies: { typescript: '^5.0.0', vitest: '^3.0.0' },
    });
    writeJson(path.join(root, 'packages', 'app', 'tsconfig.json'), { compilerOptions: {} });

    const result = discover(root);

    assert.equal(result.lanes.test.found, true);
    assert.deepEqual(result.lanes.test.commands, ['npx --no-install vitest run']);
    assert.deepEqual(result.lanes.typecheck.commands, [
      'npx --no-install tsc -p "packages/app/tsconfig.json" --noEmit',
    ]);
  });
});
