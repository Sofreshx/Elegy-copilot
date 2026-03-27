'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const obsidianRemoteSync = require('./obsidianRemoteSync');
const { ObsidianSyncService } = require('./obsidianSyncService');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

function createFixture() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-obsidian-sync-service-'));
  const copilotHomeAbs = path.join(tmpRoot, '.copilot');
  const repoPath = path.join(tmpRoot, 'workspace-repo');
  const vaultPath = path.join(copilotHomeAbs, 'planning-vault');
  const repo = {
    repoId: 'repo-workspace-repo',
    repoPath,
    repoLabel: 'workspace-repo',
  };

  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  fs.mkdirSync(vaultPath, { recursive: true });
  fs.mkdirSync(copilotHomeAbs, { recursive: true });
  fs.writeFileSync(path.join(copilotHomeAbs, 'obsidian-planning.json'), JSON.stringify({
    vaultPath,
    notesPathTemplate: 'Planning/{repoId}',
    remoteSyncUrl: 'https://notes.example.test/feed',
    remoteSyncPollIntervalMs: 60_000,
    remoteSyncTimeoutMs: 15_000,
  }, null, 2));

  return {
    tmpRoot,
    copilotHomeAbs,
    repoPath,
    vaultPath,
    repo,
  };
}

function createService(overrides = {}) {
  return new ObsidianSyncService({
    obsidianCli: overrides.obsidianCli || {
      async probeCli() {
        return {
          state: 'not-configured',
          message: 'No Obsidian CLI command contract is configured.',
        };
      },
      resolveCommand() {
        return [];
      },
      async runConfiguredCommand() {
        return {
          exitCode: 0,
          durationMs: 1,
        };
      },
    },
    obsidianSourceResolver: overrides.obsidianSourceResolver || {
      async resolveSourceSelection() {
        return {
          availableSources: [],
          activeSourceConfigured: false,
          activeSourceMatched: false,
          effectiveSource: null,
          requiresSource: false,
          resolved: true,
          message: 'No synced-note source is required for this feed.',
        };
      },
      async setActiveSourceSelection() {
        throw new Error('not implemented in this test');
      },
    },
    fetch: overrides.fetch,
    setTimeout: overrides.setTimeout,
    clearTimeout: overrides.clearTimeout,
  });
}

function writeRepoState(fixture, statePatch) {
  const config = {
    vaultPath: fixture.vaultPath,
    notesPathTemplate: 'Planning/{repoId}',
    remoteSyncUrl: 'https://notes.example.test/feed',
    remoteSyncPollIntervalMs: 60_000,
    remoteSyncTimeoutMs: 15_000,
  };
  const current = obsidianRemoteSync.readRepoSyncState({
    copilotHomeAbs: fixture.copilotHomeAbs,
    repo: fixture.repo,
    config,
  });
  const nextState = {
    ...current,
    ...statePatch,
    summary: {
      ...current.summary,
      ...(statePatch.summary || {}),
    },
  };
  obsidianRemoteSync.writeRepoSyncState({
    copilotHomeAbs: fixture.copilotHomeAbs,
    repo: fixture.repo,
    state: nextState,
  });
  return config;
}

function resolveLeasePath(fixture) {
  return path.join(
    obsidianRemoteSync.resolveSyncRoot(fixture.copilotHomeAbs),
    'leases',
    `${obsidianRemoteSync.deriveRepoSyncKey(fixture.repo)}.lock.json`,
  );
}

function writeLeaseFile(fixture, lease) {
  const leasePath = resolveLeasePath(fixture);
  fs.mkdirSync(path.dirname(leasePath), { recursive: true });
  fs.writeFileSync(leasePath, JSON.stringify(lease, null, 2) + '\n', 'utf8');
  return leasePath;
}

async function run() {
  await test('syncNow respects an active persisted lease and deterministically recovers stale leases', async () => {
    const fixture = createFixture();
    let fetchCount = 0;
    const service = createService({
      fetch: async () => {
        fetchCount += 1;
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              nextCursor: 'cursor-001',
              notes: [],
            };
          },
        };
      },
    });

    const activeLease = {
      token: 'lease-active',
      acquiredAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      trigger: 'timer',
    };
    const config = writeRepoState(fixture, {
      syncLease: activeLease,
      summary: {
        state: 'syncing',
        syncing: true,
        message: 'Timer-based Obsidian sync poll is running.',
        leaseAcquiredAt: activeLease.acquiredAt,
        leaseExpiresAt: activeLease.expiresAt,
        leaseTrigger: activeLease.trigger,
      },
    });
    writeLeaseFile(fixture, activeLease);

    const blocked = await service.syncNow({ repo: fixture.repo, copilotHomeAbs: fixture.copilotHomeAbs }, 'manual');
    assert.equal(blocked.state, 'syncing');
    assert.equal(blocked.reason, 'lease_active');
    assert.equal(blocked.leaseExpiresAt, activeLease.expiresAt);
    assert.equal(fetchCount, 0);

    const staleLease = {
      token: 'lease-stale',
      acquiredAt: new Date(Date.now() - 180_000).toISOString(),
      expiresAt: new Date(Date.now() - 120_000).toISOString(),
      trigger: 'manual',
    };
    writeRepoState(fixture, {
      syncLease: staleLease,
      summary: {
        state: 'syncing',
        syncing: true,
        message: 'Manual Obsidian sync is running.',
        leaseAcquiredAt: staleLease.acquiredAt,
        leaseExpiresAt: staleLease.expiresAt,
        leaseTrigger: staleLease.trigger,
      },
    });
    writeLeaseFile(fixture, staleLease);

    const recovered = await service.syncNow({ repo: fixture.repo, copilotHomeAbs: fixture.copilotHomeAbs }, 'manual');
    assert.equal(recovered.state, 'success');
    assert.equal(recovered.retryCount, 0);
    assert.ok(recovered.lastStaleLeaseRecoveredAt);
    assert.equal(fetchCount, 1);

    const finalState = obsidianRemoteSync.readRepoSyncState({
      copilotHomeAbs: fixture.copilotHomeAbs,
      repo: fixture.repo,
      config,
    });
    assert.equal(finalState.syncLease, undefined);
    assert.equal(finalState.summary.state, 'success');
    assert.equal(finalState.summary.lastStaleLeaseRecoveredAt, recovered.lastStaleLeaseRecoveredAt);
  });

  await test('releaseRepoSyncLease only clears the file-backed lease for the owning token and tolerates missing lock files', async () => {
    const fixture = createFixture();
    const config = {
      vaultPath: fixture.vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
      remoteSyncUrl: 'https://notes.example.test/feed',
      remoteSyncPollIntervalMs: 60_000,
      remoteSyncTimeoutMs: 15_000,
    };
    const leasePath = resolveLeasePath(fixture);

    const acquired = obsidianRemoteSync.acquireRepoSyncLease({
      copilotHomeAbs: fixture.copilotHomeAbs,
      repo: fixture.repo,
      config,
      trigger: 'manual',
    });

    assert.equal(acquired.acquired, true);
    assert.equal(fs.existsSync(leasePath), true);

    const ignored = obsidianRemoteSync.releaseRepoSyncLease({
      copilotHomeAbs: fixture.copilotHomeAbs,
      repo: fixture.repo,
      config,
      leaseToken: 'different-lease-token',
      summaryPatch: {
        state: 'idle',
        message: 'ignored',
      },
    });

    assert.equal(fs.existsSync(leasePath), true);
    assert.equal(ignored.syncLease.token, acquired.activeLease.token);

    const released = obsidianRemoteSync.releaseRepoSyncLease({
      copilotHomeAbs: fixture.copilotHomeAbs,
      repo: fixture.repo,
      config,
      leaseToken: acquired.activeLease.token,
      summaryPatch: {
        state: 'idle',
        message: 'released',
      },
    });

    assert.equal(fs.existsSync(leasePath), false);
    assert.equal(released.syncLease, undefined);
    assert.equal(released.summary.state, 'idle');

    const reacquired = obsidianRemoteSync.acquireRepoSyncLease({
      copilotHomeAbs: fixture.copilotHomeAbs,
      repo: fixture.repo,
      config,
      trigger: 'manual',
    });

    assert.equal(reacquired.acquired, true);
    assert.equal(fs.existsSync(leasePath), true);
    fs.unlinkSync(leasePath);

    const missingLockRelease = obsidianRemoteSync.releaseRepoSyncLease({
      copilotHomeAbs: fixture.copilotHomeAbs,
      repo: fixture.repo,
      config,
      leaseToken: reacquired.activeLease.token,
      summaryPatch: {
        state: 'idle',
        message: 'released after missing lock file',
      },
    });

    assert.equal(fs.existsSync(leasePath), false);
    assert.equal(missingLockRelease.syncLease, undefined);
    assert.equal(missingLockRelease.summary.state, 'idle');
  });

  await test('timer sync failures persist retry metadata and immediate retries are cooled down until the next scheduled attempt', async () => {
    const fixture = createFixture();
    let fetchCount = 0;
    let shouldFail = true;
    const service = createService({
      fetch: async () => {
        fetchCount += 1;
        if (shouldFail) {
          throw new Error('network_down');
        }
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              nextCursor: 'cursor-002',
              notes: [],
            };
          },
        };
      },
    });

    const failed = await service.syncNow({ repo: fixture.repo, copilotHomeAbs: fixture.copilotHomeAbs }, 'timer');
    assert.equal(failed.state, 'error');
    assert.equal(failed.reason, 'timer_backoff_scheduled');
    assert.equal(failed.retryCount, 1);
    assert.ok(failed.nextAttemptAt);
    assert.equal(fetchCount, 1);

    const cooledDown = await service.syncNow({ repo: fixture.repo, copilotHomeAbs: fixture.copilotHomeAbs }, 'timer');
    assert.equal(cooledDown.reason, 'cooldown_active');
    assert.equal(fetchCount, 1);

    const config = writeRepoState(fixture, {
      summary: {
        nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
        cooldownUntil: new Date(Date.now() - 1_000).toISOString(),
      },
    });

    shouldFail = false;
    const recovered = await service.syncNow({ repo: fixture.repo, copilotHomeAbs: fixture.copilotHomeAbs }, 'timer');
    assert.equal(recovered.state, 'success');
    assert.equal(recovered.retryCount, 0);
    assert.ok(recovered.nextAttemptAt);
    assert.equal(fetchCount, 2);

    const finalState = obsidianRemoteSync.readRepoSyncState({
      copilotHomeAbs: fixture.copilotHomeAbs,
      repo: fixture.repo,
      config,
    });
    assert.equal(finalState.summary.retryCount, 0);
    assert.equal(finalState.summary.lastFailureReason, undefined);
  });

  await test('timer sync conflicts keep deterministic conflict metadata and do not enter retry backoff', async () => {
    const fixture = createFixture();
    const config = writeRepoState(fixture, {
      summary: {
        retryCount: 2,
        retryLimit: 4,
        nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
        cooldownUntil: new Date(Date.now() - 1_000).toISOString(),
      },
    });
    const service = createService({
      fetch: async () => {
        throw new obsidianRemoteSync.ObsidianSyncConflictError('Remote update conflicts with local edits.', {
          conflicts: ['daily-sync.md'],
        });
      },
    });

    const conflict = await service.syncNow({ repo: fixture.repo, copilotHomeAbs: fixture.copilotHomeAbs }, 'timer');
    assert.equal(conflict.state, 'conflict');
    assert.equal(conflict.reason, 'obsidian_sync_conflict');
    assert.equal(conflict.retryCount, 0);
    assert.ok(conflict.nextAttemptAt);

    const finalState = obsidianRemoteSync.readRepoSyncState({
      copilotHomeAbs: fixture.copilotHomeAbs,
      repo: fixture.repo,
      config,
    });
    assert.equal(finalState.summary.state, 'conflict');
    assert.equal(finalState.summary.reason, 'obsidian_sync_conflict');
    assert.equal(finalState.summary.retryCount, 0);
    assert.notEqual(finalState.summary.reason, 'timer_backoff_scheduled');
  });

  await test('poll scheduling honors persisted next-attempt backpressure instead of always starting a near-immediate timer', async () => {
    const fixture = createFixture();
    const scheduledDelays = [];
    writeRepoState(fixture, {
      summary: {
        nextAttemptAt: new Date(Date.now() + 45_000).toISOString(),
        cooldownUntil: new Date(Date.now() + 45_000).toISOString(),
      },
    });

    const service = createService({
      setTimeout(_fn, delayMs) {
        scheduledDelays.push(delayMs);
        return {
          unref() {
            return undefined;
          },
        };
      },
      clearTimeout() {
        return undefined;
      },
    });

    const status = await service.getStatus({ repo: fixture.repo, copilotHomeAbs: fixture.copilotHomeAbs });
    assert.equal(status.remoteSync.nextAttemptAt !== undefined, true);
    assert.equal(scheduledDelays.length, 1);
    assert.equal(scheduledDelays[0] > 40_000, true);
  });

  console.log(`\n${passed} tests passed`);
  if (process.exitCode) {
    console.error('Some tests FAILED');
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});