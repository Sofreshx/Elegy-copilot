import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  buildWorkspaceStorageSeed,
  getWorkspaceTabTarget,
  resolveWorkspaceEvidenceRepoPath,
} from './ui-check-copilot-ui.mjs';

const originalRepoPath = process.env.UI_CHECK_REPO_PATH;

test.afterEach(() => {
  if (originalRepoPath === undefined) {
    delete process.env.UI_CHECK_REPO_PATH;
  } else {
    process.env.UI_CHECK_REPO_PATH = originalRepoPath;
  }
});

test('workspace repo path fallback resolves the current repo root', () => {
  delete process.env.UI_CHECK_REPO_PATH;
  const repoRoot = path.resolve('.');

  assert.equal(resolveWorkspaceEvidenceRepoPath(repoRoot), repoRoot);
});

test('workspace repo path honors UI_CHECK_REPO_PATH', () => {
  process.env.UI_CHECK_REPO_PATH = 'copilot-ui';

  assert.equal(resolveWorkspaceEvidenceRepoPath(path.resolve('.')), path.resolve('copilot-ui'));
});

test('workspace localStorage seed contains repo path and label', () => {
  const repoPath = path.resolve('copilot-ui');
  const seed = buildWorkspaceStorageSeed(repoPath, 123);

  assert.deepEqual(seed, {
    tabs: [
      {
        repoPath,
        repoLabel: 'copilot-ui',
        openedAt: 123,
      },
    ],
    activeWorkspaceId: repoPath,
  });
});

test('workspace tab targets map to the expected selectors', () => {
  assert.deepEqual(getWorkspaceTabTarget('workspace-git'), {
    routeId: 'workspace-git-default',
    tabId: 'git',
    tabSelector: '[data-testid="workspace-local-tab-git"]',
    surfaceSelectors: [
      '[data-testid="workspace-git-tab"]',
      '[data-testid="workspace-operation-banner"]',
    ],
  });
  assert.deepEqual(getWorkspaceTabTarget('workspace-checks'), {
    routeId: 'workspace-checks-default',
    tabId: 'checks',
    tabSelector: '[data-testid="workspace-local-tab-checks"]',
    surfaceSelectors: [
      '[data-testid="workspace-checks-tab"]',
      '[data-testid="workspace-operation-banner"]',
    ],
  });
  assert.deepEqual(getWorkspaceTabTarget('workspace-notes'), {
    routeId: 'workspace-notes-default',
    tabId: 'notes',
    tabSelector: '[data-testid="workspace-local-tab-notes"]',
    surfaceSelectors: [
      '[data-testid="notes-tab"]',
      '[data-testid="workspace-operation-banner"]',
    ],
  });
});

test('unknown workspace target fails clearly', () => {
  assert.throws(
    () => getWorkspaceTabTarget('workspace-history'),
    /Unknown workspace tab target: "workspace-history"/,
  );
});
