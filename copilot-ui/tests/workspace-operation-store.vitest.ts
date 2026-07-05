import { describe, expect, it } from 'vitest';
import { deriveWorkspaceOperationSnapshot } from '../ui/src/stores/workspaceOperationStore';

const repoPath = '/repo/project';

function cleanGit(overrides: Record<string, unknown> = {}) {
  return {
    committing: false,
    syncing: false,
    creatingPullRequest: false,
    checkFailed: false,
    status: { clean: true, behind: 0, ahead: 0 },
    summary: { clean: true, changedFiles: 0, stagedFiles: 0, behind: 0, ahead: 0 },
    ...overrides,
  } as any;
}

function checks(overrides: Record<string, unknown> = {}) {
  return {
    repoPath,
    runSession: null,
    runningChecks: false,
    checkResults: { allPassed: true },
    checkState: {
      lastRun: { overallPass: true, timestamp: '2026-07-05T00:00:00.000Z' },
      freshness: { fresh: true, reason: 'fresh' },
    },
    ciSync: null,
    discoveredChecks: null,
    loading: false,
    ...overrides,
  } as any;
}

function notes(overrides: Record<string, unknown> = {}) {
  return {
    vaultStatus: {
      ok: true,
      vaultPath: '/vault',
      vaultExists: true,
      fileCount: 1,
      configured: true,
      gitEnabled: true,
      gdriveEnabled: true,
      gdriveFolderName: 'DevVault',
    },
    driveSync: {
      ok: true,
      configured: true,
      vaultPath: '/vault',
      vaultExists: true,
      gdriveEnabled: true,
      gdriveFolderName: 'DevVault',
      rcloneInstalled: true,
      rclonePath: 'rclone',
      rcloneConfigured: true,
      authenticated: true,
      authenticatedEmail: 'test@example.com',
      driveFolderExists: true,
    },
    gitStatus: { ok: true, isClean: true, changes: [] },
    busyAction: null,
    ...overrides,
  } as any;
}

describe('workspace operation derivation', () => {
  it('blocks readiness when checks are stale', () => {
    const snapshot = deriveWorkspaceOperationSnapshot({
      repoPath,
      gitState: cleanGit(),
      checksState: checks({
        checkState: {
          lastRun: { overallPass: true, timestamp: '2026-07-05T00:00:00.000Z' },
          freshness: { fresh: false, reason: 'working tree changed' },
        },
      }),
      now: '2026-07-05T01:00:00.000Z',
    });

    expect(snapshot.status).toBe('blocked');
    expect(snapshot.blockers.map((blocker) => blocker.id)).toContain('checks.stale');
    expect(snapshot.nextAction?.id).toBe('checks.run');
  });

  it('marks failed checks as blocked', () => {
    const snapshot = deriveWorkspaceOperationSnapshot({
      repoPath,
      gitState: cleanGit(),
      checksState: checks({ checkResults: { allPassed: false } }),
    });

    expect(snapshot.status).toBe('blocked');
    expect(snapshot.blockers.map((blocker) => blocker.id)).toContain('checks.failed');
  });

  it('marks running checks as running', () => {
    const snapshot = deriveWorkspaceOperationSnapshot({
      repoPath,
      gitState: cleanGit(),
      checksState: checks({
        runningChecks: true,
        runSession: {
          id: '1',
          repoPath,
          profile: 'commit',
          label: 'commit',
          startedAt: '2026-07-05T00:00:00.000Z',
          endedAt: null,
          targetLanes: ['lint'],
          outcome: 'running',
          error: null,
          results: null,
        },
      }),
    });

    expect(snapshot.status).toBe('running');
    expect(snapshot.activeOperations).toContain('checks.run');
  });

  it('turns a behind branch into a pull next action', () => {
    const snapshot = deriveWorkspaceOperationSnapshot({
      repoPath,
      gitState: cleanGit({ summary: { clean: true, changedFiles: 0, stagedFiles: 0, behind: 2, ahead: 0 } }),
      checksState: checks(),
    });

    expect(snapshot.status).toBe('attention');
    expect(snapshot.blockers.map((blocker) => blocker.id)).toContain('git.behind');
    expect(snapshot.nextAction?.id).toBe('git.pull');
  });

  it('reports the first missing notes Drive setup prerequisite', () => {
    const snapshot = deriveWorkspaceOperationSnapshot({
      repoPath,
      notesState: notes({
        driveSync: {
          ok: true,
          configured: true,
          vaultPath: '/vault',
          vaultExists: true,
          gdriveEnabled: true,
          gdriveFolderName: 'DevVault',
          rcloneInstalled: false,
          rclonePath: null,
          rcloneConfigured: false,
          authenticated: false,
          authenticatedEmail: null,
          driveFolderExists: false,
        },
      }),
    });

    expect(snapshot.status).toBe('blocked');
    expect(snapshot.blockers[0].id).toBe('notes.drive.rclone-missing');
  });

  it('marks a clean repo with fresh checks as ready', () => {
    const snapshot = deriveWorkspaceOperationSnapshot({
      repoPath,
      gitState: cleanGit(),
      checksState: checks(),
      notesState: notes(),
    });

    expect(snapshot.status).toBe('ready');
    expect(snapshot.blockers).toHaveLength(0);
  });
});
