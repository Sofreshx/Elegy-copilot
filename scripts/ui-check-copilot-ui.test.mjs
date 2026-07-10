import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  buildWorkspaceStorageSeed,
  getWorkspaceTabTarget,
  deriveSurfaceStatus,
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
  assert.deepEqual(getWorkspaceTabTarget('workspace-assets'), {
    routeId: 'workspace-assets-default',
    tabId: 'assets',
    tabSelector: '[data-testid="workspace-local-tab-assets"]',
    surfaceSelectors: [
      '[data-testid="workspace-assets-center"]',
    ],
  });
});

test('workspace evidence uses the three approved viewport sizes', async () => {
  const { getEvidenceViewports } = await import('./ui-check-copilot-ui.mjs');
  assert.deepEqual(getEvidenceViewports(), [
    { id: 'wide', width: 1440, height: 900 },
    { id: 'desktop', width: 1280, height: 800 },
    { id: 'compact', width: 960, height: 720 },
  ]);
});

test('unknown workspace target fails clearly', () => {
  assert.throws(
    () => getWorkspaceTabTarget('workspace-history'),
    /Unknown workspace tab target: "workspace-history"/,
  );
});

test('surface status fails unless readiness and diagnostics are clean', () => {
  assert.equal(deriveSurfaceStatus({ ready: true, consoleErrors: [], pageErrors: [], networkFailures: [] }), 'pass');
  assert.equal(deriveSurfaceStatus({ ready: false, consoleErrors: [], pageErrors: [], networkFailures: [] }), 'fail');
  assert.equal(deriveSurfaceStatus({ ready: true, consoleErrors: ['boom'], pageErrors: [], networkFailures: [] }), 'fail');
  assert.equal(deriveSurfaceStatus({ ready: true, consoleErrors: [], pageErrors: ['boom'], networkFailures: [] }), 'fail');
  assert.equal(deriveSurfaceStatus({ ready: true, consoleErrors: [], pageErrors: [], networkFailures: [{ url: '/api', status: 0 }] }), 'fail');
});

test('Pattern Atlas target is adapter-backed and route-aligned', () => {
  const config = JSON.parse(fs.readFileSync('.elegy/ui-check.json', 'utf8'));
  const target = config.targets['pattern-atlas'];
  assert.equal(target.evidenceRoot, './evidence/ui/pattern-atlas');
  assert.equal(target.runtimeReport, 'runtime-report.json');
  assert.equal(target.routes[0].id, 'pattern-atlas-view');
  assert.deepEqual(target.routes[0].states, ['default']);
  assert.ok(target.validationCommands.some((command) => command.command === 'node scripts/ui-check-copilot-ui.mjs'));
});
