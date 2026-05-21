'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { readDefaultDesktopRollbackPolicy } = require('./server');

test('server resolves the bundled desktop rollback policy from the repo root engine path', () => {
  const repoRoot = path.resolve(__dirname, '..');

  const rawPolicy = readDefaultDesktopRollbackPolicy(repoRoot);

  assert.ok(rawPolicy);
  assert.deepEqual(JSON.parse(rawPolicy), {
    updatesEnabled: true,
  });
});

test('server resolves the bundled desktop rollback policy from the copilot-ui workspace root', () => {
  const workspaceRoot = path.resolve(__dirname);

  const rawPolicy = readDefaultDesktopRollbackPolicy(workspaceRoot);

  assert.ok(rawPolicy);
  assert.deepEqual(JSON.parse(rawPolicy), {
    updatesEnabled: true,
  });
});
