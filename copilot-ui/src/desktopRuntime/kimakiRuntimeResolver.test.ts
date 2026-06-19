import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveKimakiEntrypoint } from './kimakiRuntimeResolver';

test('resolves a hoisted development Kimaki entrypoint', () => {
  const expected = 'C:\\repo\\node_modules\\kimaki\\bin.js';
  const result = resolveKimakiEntrypoint({
    appPath: 'C:\\repo\\copilot-ui',
    runtimeRoot: 'C:\\repo',
    existsSync: (candidate) => candidate === expected,
  });

  assert.equal(result.available, true);
  assert.equal(result.entrypoint, expected);
});

test('prefers an explicit Kimaki entrypoint override', () => {
  const expected = 'C:\\custom\\kimaki\\bin.js';
  const result = resolveKimakiEntrypoint({
    appPath: 'C:\\repo\\copilot-ui',
    runtimeRoot: 'C:\\repo',
    explicitPath: expected,
    existsSync: (candidate) => candidate === expected,
  });

  assert.equal(result.entrypoint, expected);
});

test('reports every checked path when Kimaki is missing', () => {
  const result = resolveKimakiEntrypoint({
    appPath: 'C:\\repo\\copilot-ui',
    runtimeRoot: 'C:\\repo',
    existsSync: () => false,
  });

  assert.equal(result.available, false);
  assert.equal(result.reason, 'kimaki_entrypoint_missing');
  assert.ok(result.checkedPaths.length >= 2);
});
