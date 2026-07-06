#!/usr/bin/env node

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCommitCheckConfig,
  validateCommitCheckConfig,
} from './commit-check-defaults.mjs';
import { runChecks } from './commit-check-run.mjs';

const repoRoot = process.cwd();

function nodeExit(code) {
  return `node -e "process.exit(${code})"`;
}

describe('commit-check-run protocol', () => {
  it('fails when a selected blocking lane fails even when score passes threshold', () => {
    const result = runChecks({
      schemaVersion: 3,
      threshold: 1,
      weights: { passing: 1, blocking: 0 },
      lanes: {
        passing: {
          enabled: true,
          blocking: true,
          defaultProfiles: ['commit'],
          commands: [nodeExit(0)],
        },
        blocking: {
          enabled: true,
          blocking: true,
          defaultProfiles: ['commit'],
          commands: [nodeExit(1)],
        },
      },
    }, repoRoot);

    assert.equal(result.passesThreshold, true);
    assert.equal(result.overallPass, false);
    assert.deepEqual(result.blockingFailures, ['blocking']);
  });

  it('passes when only a non-blocking advisory lane fails', () => {
    const result = runChecks({
      schemaVersion: 3,
      threshold: 100,
      weights: { advisory: 1 },
      lanes: {
        advisory: {
          enabled: true,
          blocking: false,
          required: false,
          defaultProfiles: ['commit'],
          commands: [nodeExit(1)],
        },
      },
    }, repoRoot);

    assert.equal(result.lanes.advisory.status, 'FAIL');
    assert.equal(result.overallPass, true);
    assert.deepEqual(result.blockingFailures, []);
  });

  it('defaults to the commit profile', () => {
    const result = runChecks({
      schemaVersion: 3,
      lanes: {
        commitOnly: {
          enabled: true,
          blocking: true,
          defaultProfiles: ['commit'],
          commands: [nodeExit(0)],
        },
        ciOnly: {
          enabled: true,
          blocking: true,
          defaultProfiles: ['ci-local'],
          commands: [nodeExit(0)],
        },
      },
    }, repoRoot);

    assert.equal(result.profile, 'commit');
    assert.deepEqual(Object.keys(result.lanes), ['commitOnly']);
  });

  it('--all semantics include every enabled lane', () => {
    const result = runChecks({
      schemaVersion: 3,
      lanes: {
        commitOnly: {
          enabled: true,
          blocking: true,
          defaultProfiles: ['commit'],
          commands: [nodeExit(0)],
        },
        ciOnly: {
          enabled: true,
          blocking: true,
          defaultProfiles: ['ci-local'],
          commands: [nodeExit(0)],
        },
      },
    }, repoRoot, { runAll: true });

    assert.deepEqual(Object.keys(result.lanes), ['ciOnly', 'commitOnly']);
  });

  it('rejects malformed lane commands instead of normalizing them to a skip', () => {
    const validation = validateCommitCheckConfig(normalizeCommitCheckConfig({
      schemaVersion: 3,
      lanes: {
        malformed: {
          enabled: true,
          blocking: true,
          defaultProfiles: ['commit'],
          commands: 'node -e "process.exit(1)"',
        },
      },
    }));

    assert.equal(validation.valid, false);
    assert.match(validation.errors.join('\n'), /lane "malformed" commands must be an array/);
  });
});
