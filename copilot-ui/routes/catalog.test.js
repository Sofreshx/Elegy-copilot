'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const assets = require('../lib/assets');
const { getRepoStateKey } = require('../lib/catalogProjectionService');
const { register } = require('./catalog');

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

function writeJson(absPath, value) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function writeText(absPath, text) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, text, 'utf8');
}

function createResponse() {
  const state = {
    statusCode: null,
    headers: null,
    chunks: [],
    ended: false,
  };

  return {
    get statusCode() {
      return state.statusCode;
    },
    get bodyText() {
      return state.chunks.join('');
    },
    writeHead(statusCode, headers) {
      state.statusCode = statusCode;
      state.headers = headers;
    },
    write(chunk) {
      state.chunks.push(String(chunk));
      return true;
    },
    end(chunk) {
      if (chunk != null) {
        state.chunks.push(String(chunk));
      }
      state.ended = true;
    },
  };
}

function parseJsonBody(response) {
  return JSON.parse(response.bodyText || '{}');
}

function findRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;
    if (typeof route.path === 'string' && route.path === pathname) {
      return { route, match: null };
    }
    if (route.path instanceof RegExp) {
      const match = pathname.match(route.path);
      if (match) {
        return { route, match };
      }
    }
  }
  throw new Error(`Route not found: ${method} ${pathname}`);
}

async function invoke(routes, ctx, method, pathname, body) {
  const res = createResponse();
  const u = new URL(`http://127.0.0.1${pathname}`);
  const { route, match } = findRoute(routes, method, u.pathname);
  route.handler({
    ...ctx,
    req: { __body: body || {} },
    res,
    u,
    match,
    pathname: u.pathname,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { res, body: parseJsonBody(res) };
}

function createFixtureRoot() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-catalog-routes-'));
  const engineRoot = path.join(tmpRoot, 'engine');
  const copilotHomeAbs = path.join(tmpRoot, '.copilot');
  const repoPath = path.join(tmpRoot, 'workspace-repo');
  const manualRepoPath = path.join(tmpRoot, 'manual-repo');

  writeJson(path.join(engineRoot, 'engine-assets', 'manifest.json'), {
    assets: [
      {
        id: 'skill-core-guardrails',
        type: 'skill',
        source: 'engine-assets/skills/core-guardrails',
        destination: 'skills/core-guardrails',
        loadMode: 'always',
      },
      {
        id: 'skill-repo-helper',
        type: 'skill',
        source: 'engine-assets/skills/repo-helper',
        destination: 'skills/repo-helper',
        loadMode: 'on-demand',
      },
      {
        id: 'agent-repo-guide',
        type: 'agent',
        source: 'engine-assets/agents/repo-guide.agent.md',
        destination: 'agents/repo-guide.agent.md',
      },
    ],
  });
  writeJson(path.join(engineRoot, 'engine-assets', 'skills', 'skill-metadata-index.json'), {
    schemaVersion: 1,
    entries: [
      {
        skill: 'core-guardrails',
        name: 'core-guardrails',
        description: 'Always-loaded safety guidance.',
        triggersOn: ['safety', 'terminal'],
        tags: ['safety'],
        frameworks: ['node'],
        manifest: { loadMode: 'always' },
      },
      {
        skill: 'repo-helper',
        name: 'repo-helper',
        description: 'Repo helper for workspace tasks.',
        triggersOn: ['repo', 'workspace'],
        tags: ['repo'],
        frameworks: ['node'],
        manifest: { loadMode: 'on-demand' },
      },
    ],
  });
  writeText(path.join(engineRoot, 'engine-assets', 'skills', 'core-guardrails', 'SKILL.md'), '# Core Guardrails\n');
  writeText(path.join(engineRoot, 'engine-assets', 'skills', 'repo-helper', 'SKILL.md'), '# Repo Helper\n');
  writeText(path.join(engineRoot, 'engine-assets', 'agents', 'repo-guide.agent.md'), '# Repo Guide\n');
  fs.mkdirSync(path.join(engineRoot, '.git'), { recursive: true });
  writeJson(path.join(engineRoot, 'package.json'), {
    name: 'instruction-engine',
    private: true,
    workspaces: ['copilot-ui'],
    dependencies: {
      react: '^18.0.0',
    },
    devDependencies: {
      typescript: '^5.0.0',
    },
  });

  writeText(path.join(copilotHomeAbs, 'skills', 'core-guardrails', 'SKILL.md'), '# Installed Core Guardrails\n');
  writeText(path.join(copilotHomeAbs, 'skills-vault', 'repo-helper', 'SKILL.md'), '# Repo Helper Vault\n');
  writeText(path.join(copilotHomeAbs, 'agents', 'repo-guide.agent.md'), '# Repo Guide Installed\n');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  writeJson(path.join(repoPath, 'package.json'), {
    name: 'workspace-repo',
    dependencies: {
      react: '^18.0.0',
      express: '^4.0.0',
    },
    devDependencies: {
      typescript: '^5.0.0',
    },
  });
  writeText(path.join(repoPath, '.github', 'skills', 'repo-helper', 'SKILL.md'), '# Repo Helper Override\n');
  writeText(path.join(repoPath, '.github', 'agents', 'repo-guide.agent.md'), '# Repo Guide Override\n');
  const repoStateKey = getRepoStateKey(repoPath);
  writeJson(path.join(copilotHomeAbs, 'repo-state', repoStateKey.repoId, 'registry.json'), {
    skills: {
      enabled: ['repo-helper'],
    },
  });
  writeJson(path.join(copilotHomeAbs, 'repo-state', 'placeholder', 'registry.json'), {});
  writeJson(path.join(copilotHomeAbs, 'repo-state', 'orphan-repo-id', 'registry.json'), {
    skills: {
      disabled: ['ghost-skill'],
    },
  });
  fs.mkdirSync(path.join(manualRepoPath, '.git'), { recursive: true });
  writeText(path.join(manualRepoPath, 'pyproject.toml'), '[project]\nname = "manual-repo"\n');
  writeText(
    path.join(copilotHomeAbs, 'session-state', 'session-asset-1', 'events.jsonl'),
    [
      JSON.stringify({
        type: 'session.start',
        timestamp: '2026-03-01T00:00:00.000Z',
        payload: {
          cwd: repoPath,
          repo: repoPath,
        },
      }),
      JSON.stringify({
        type: 'assistant.message',
        timestamp: '2026-03-01T00:05:00.000Z',
        payload: {
          toolRequests: [
            {
              name: 'runAgent',
              arguments: JSON.stringify({ agent: 'repo-guide' }),
            },
          ],
        },
      }),
    ].join('\n') + '\n',
  );

  return { tmpRoot, engineRoot, copilotHomeAbs, repoPath, manualRepoPath };
}

async function run() {
  console.log('\nCatalog Route Tests\n');

  const { tmpRoot, engineRoot, copilotHomeAbs, repoPath, manualRepoPath } = createFixtureRoot();
  const runtimeState = {
    status: 'idle',
    refreshCount: 0,
    lastRequestedAt: null,
    lastCompletedAt: null,
    lastSuccessfulAt: null,
    lastDurationMs: null,
    lastReason: null,
    lastError: null,
    lastSnapshotPath: null,
  };

  const routes = register({
    catalogRuntimeState: runtimeState,
    readJsonBody: async (req) => req.__body || {},
    sendJson(res, code, payload) {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload, null, 2));
    },
  });
  const baseCtx = {
    engineRoot,
    copilotHomeAbs,
    changeTracker: {
      get() {
        return { version: 3, lastChangedMs: 1234 };
      },
    },
  };

  try {
    await test('GET /api/catalog/assets returns effective projection data without requiring a persisted snapshot', async () => {
      const response = await invoke(routes, baseCtx, 'GET', '/api/catalog/assets?kind=skill');

      assert.equal(response.res.statusCode, 200);
      assert.equal(response.body.kind, 'catalog.assets.list');
      assert.equal(response.body.snapshot.readMode, 'filesystem-fallback');
      assert.ok(Array.isArray(response.body.assets));
      assert.ok(response.body.assets.some((asset) => asset.assetId === 'skill-core-guardrails'));
      assert.ok(response.body.assets.some((asset) => asset.assetId === 'skill-repo-helper'));
    });

    await test('POST /api/catalog/refresh persists a snapshot and logs a catalog rebuild audit event', async () => {
      const response = await invoke(routes, baseCtx, 'POST', '/api/catalog/refresh', {});

      assert.equal(response.res.statusCode, 200);
      assert.equal(response.body.kind, 'catalog.refresh');
      assert.equal(response.body.refreshed, true);
      assert.equal(response.body.snapshot.readMode, 'persisted-snapshot');
      assert.equal(response.body.snapshot.storage.snapshotExists, true);
      assert.equal(runtimeState.status, 'ready');
      assert.ok(runtimeState.lastSuccessfulAt, 'expected refresh to stamp lastSuccessfulAt');

      const snapshotPath = response.body.snapshot.storage.snapshotPath;
      assert.ok(fs.existsSync(snapshotPath), 'expected persisted snapshot to exist');

      const auditPath = path.join(copilotHomeAbs, 'catalog', 'audit', 'events.jsonl');
      assert.ok(fs.existsSync(auditPath), 'expected audit log to exist after refresh');
      const auditText = fs.readFileSync(auditPath, 'utf8');
      assert.match(auditText, /"eventType":"catalog\.rebuilt"/);
    });

    await test('repo inventory routes register, list, select, refresh, and unregister repos outside active sessions', async () => {
      const registerResponse = await invoke(routes, baseCtx, 'POST', '/api/catalog/repos/register', {
        repoPath: manualRepoPath,
        label: 'Manual Repo',
      });

      assert.equal(registerResponse.res.statusCode, 200);
      assert.equal(registerResponse.body.kind, 'catalog.repos.register');
      assert.equal(registerResponse.body.registered, true);
      assert.equal(registerResponse.body.repo.repoPath, manualRepoPath);
      assert.equal(registerResponse.body.repo.registered, true);

      const listResponse = await invoke(routes, baseCtx, 'GET', `/api/catalog/repos?repoPath=${encodeURIComponent(manualRepoPath)}`);

      assert.equal(listResponse.res.statusCode, 200);
      assert.equal(listResponse.body.kind, 'catalog.repos.list');
      assert.ok(Array.isArray(listResponse.body.repos));
      const workspaceRepo = listResponse.body.repos.find((repo) => repo.repoPath === repoPath);
      assert.ok(workspaceRepo, 'expected workspace repo inventory entry');
      assert.ok(workspaceRepo.sources.includes('session-state'));
      assert.ok(workspaceRepo.sources.includes('workspace') === false);
      assert.equal(workspaceRepo.assets.hasRepoAssets, true);
      assert.deepEqual(workspaceRepo.hints.frameworks, ['express', 'react']);
      assert.deepEqual(workspaceRepo.hints.targets, ['backend', 'frontend']);

      const orphanRepo = listResponse.body.repos.find((repo) => repo.repoId === 'orphan-repo-id');
      assert.ok(orphanRepo, 'expected repo-state-only orphan entry');
      assert.equal(orphanRepo.scanStatus, 'unresolved');

      const selectResponse = await invoke(routes, baseCtx, 'POST', '/api/catalog/repos/select', {
        repoPath,
      });
      assert.equal(selectResponse.res.statusCode, 200);
      assert.equal(selectResponse.body.kind, 'catalog.repos.select');
      assert.equal(selectResponse.body.repo.selected, true);
      assert.equal(selectResponse.body.selectedRepo.repoPath, repoPath);

      const refreshResponse = await invoke(routes, baseCtx, 'POST', '/api/catalog/repos/refresh', {
        repoPath,
      });
      assert.equal(refreshResponse.res.statusCode, 200);
      assert.equal(refreshResponse.body.kind, 'catalog.repos.refresh');
      assert.equal(refreshResponse.body.refreshed, true);
      assert.equal(refreshResponse.body.repo.repoPath, repoPath);
      assert.equal(refreshResponse.body.repo.scanStatus, 'ready');
      assert.equal(refreshResponse.body.snapshot.repoContext.repoPath, repoPath);
      assert.equal(refreshResponse.body.snapshot.storage.snapshotExists, true);
      assert.ok(refreshResponse.body.audit.logged, 'expected repo refresh audit to log');

      const unregisterResponse = await invoke(routes, baseCtx, 'POST', '/api/catalog/repos/unregister', {
        repoPath: manualRepoPath,
      });
      assert.equal(unregisterResponse.res.statusCode, 200);
      assert.equal(unregisterResponse.body.kind, 'catalog.repos.unregister');
      assert.equal(unregisterResponse.body.removed, true);
      assert.equal(unregisterResponse.body.repo.repoPath, manualRepoPath);
    });

    await test('catalog mutation routes create, update, and delete user-global skills on authoritative paths', async () => {
      const createResponse = await invoke(routes, baseCtx, 'POST', '/api/catalog/assets/create', {
        authoringScope: 'user-global',
        kind: 'skill',
        assetKey: 'custom-helper',
        loadMode: 'on-demand',
        title: 'Custom Helper',
        description: 'User-global vault skill.',
        content: '## Usage\n\nUse this for custom work.\n',
        triggersOn: ['custom helper', 'user global'],
      });

      assert.equal(createResponse.res.statusCode, 200);
      assert.equal(createResponse.body.kind, 'catalog.asset.create');
      assert.equal(createResponse.body.action, 'created');
      assert.ok(createResponse.body.audit.logged);
      assert.ok(fs.existsSync(path.join(copilotHomeAbs, 'skills-vault', 'custom-helper', 'SKILL.md')));

      const updateResponse = await invoke(routes, baseCtx, 'POST', '/api/catalog/assets/update', {
        authoringScope: 'user-global',
        kind: 'skill',
        assetKey: 'custom-helper',
        loadMode: 'always',
        expectedHash: createResponse.body.contentHash,
        title: 'Custom Helper',
        description: 'User-global always-loaded skill.',
        content: '## Updated\n\nNow always loaded.\n',
      });

      assert.equal(updateResponse.res.statusCode, 200);
      assert.equal(updateResponse.body.kind, 'catalog.asset.update');
      assert.equal(updateResponse.body.loadMode, 'always');
      assert.ok(fs.existsSync(path.join(copilotHomeAbs, 'skills', 'custom-helper', 'SKILL.md')));
      assert.equal(fs.existsSync(path.join(copilotHomeAbs, 'skills-vault', 'custom-helper')), false);

      const deleteResponse = await invoke(routes, baseCtx, 'POST', '/api/catalog/assets/delete', {
        authoringScope: 'user-global',
        kind: 'skill',
        assetKey: 'custom-helper',
        loadMode: 'always',
        expectedHash: updateResponse.body.contentHash,
      });

      assert.equal(deleteResponse.res.statusCode, 200);
      assert.equal(deleteResponse.body.kind, 'catalog.asset.delete');
      assert.equal(deleteResponse.body.action, 'deleted');
      assert.equal(fs.existsSync(path.join(copilotHomeAbs, 'skills', 'custom-helper')), false);
    });

    await test('catalog mutation routes create shared skills and install shipped assets through safe backend APIs', async () => {
      const createResponse = await invoke(routes, baseCtx, 'POST', '/api/catalog/assets/create', {
        authoringScope: 'shared',
        authoringRepoPath: engineRoot,
        kind: 'skill',
        assetKey: 'shared-authoring',
        loadMode: 'always',
        title: 'Shared Authoring',
        description: 'New shipped skill.',
        content: '## Shared\n\nCreated from the backend mutation API.\n',
      });

      assert.equal(createResponse.res.statusCode, 200);
      assert.equal(createResponse.body.kind, 'catalog.asset.create');
      assert.ok(fs.existsSync(path.join(engineRoot, 'engine-assets', 'skills', 'shared-authoring', 'SKILL.md')));

      const manifest = JSON.parse(fs.readFileSync(path.join(engineRoot, 'engine-assets', 'manifest.json'), 'utf8'));
      assert.ok(
        manifest.assets.some((asset) => asset.id === 'skill-shared-authoring' && asset.loadMode === 'always'),
        'expected shared skill manifest entry',
      );

      const installResponse = await invoke(routes, baseCtx, 'POST', '/api/catalog/assets/install', {
        assetId: 'skill-shared-authoring',
      });

      assert.equal(installResponse.res.statusCode, 200);
      assert.equal(installResponse.body.kind, 'catalog.asset.install');
      assert.equal(installResponse.body.action, 'installed');
      assert.ok(fs.existsSync(path.join(copilotHomeAbs, 'skills', 'shared-authoring', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(copilotHomeAbs, 'skills-vault', 'shared-authoring', 'SKILL.md')));
    });

    await test('catalog mutation routes disable and enable repo overlays via repo-state only', async () => {
      const disableResponse = await invoke(routes, baseCtx, 'POST', '/api/catalog/assets/disable', {
        kind: 'skill',
        assetKey: 'repo-helper',
        repoPath,
      });

      assert.equal(disableResponse.res.statusCode, 200);
      assert.equal(disableResponse.body.kind, 'catalog.asset.disable');
      assert.equal(disableResponse.body.action, 'disabled');
      assert.ok(disableResponse.body.audit.logged);

      const disabledAssets = await invoke(routes, baseCtx, 'GET', `/api/catalog/assets?kind=skill&repoPath=${encodeURIComponent(repoPath)}`);
      const disabledRepoHelper = disabledAssets.body.assets.find((asset) => asset.assetId === 'skill-repo-helper');
      assert.equal(disabledRepoHelper.enabled, false);

      const enableResponse = await invoke(routes, baseCtx, 'POST', '/api/catalog/assets/enable', {
        kind: 'skill',
        assetKey: 'repo-helper',
        repoPath,
        expectedRegistryHash: disableResponse.body.registryHash,
      });

      assert.equal(enableResponse.res.statusCode, 200);
      assert.equal(enableResponse.body.kind, 'catalog.asset.enable');
      assert.equal(enableResponse.body.action, 'enabled');

      const enabledAssets = await invoke(routes, baseCtx, 'GET', `/api/catalog/assets?kind=skill&repoPath=${encodeURIComponent(repoPath)}`);
      const enabledRepoHelper = enabledAssets.body.assets.find((asset) => asset.assetId === 'skill-repo-helper');
      assert.equal(enabledRepoHelper.enabled, true);

      const registryPath = path.join(copilotHomeAbs, 'repo-state', enableResponse.body.repoId, 'registry.json');
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      assert.deepEqual(registry.skills.enabled, ['repo-helper']);
      assert.equal(Array.isArray(registry.skills.disabled), false);
    });

    await test('POST /api/search/query ranks projection-backed search results and writes audit events', async () => {
      const response = await invoke(routes, baseCtx, 'POST', '/api/search/query', {
        query: 'repo',
        kind: 'skill',
        includeVaultOnly: true,
        frameworks: ['node'],
        limit: 5,
        repoPath,
        sessionId: 'session-asset-1',
      });

      assert.equal(response.res.statusCode, 200);
      assert.equal(response.body.kind, 'catalog.search.query');
      assert.ok(response.body.count >= 1);
      assert.equal(response.body.results[0].assetId, 'skill-repo-helper');
      assert.ok(Array.isArray(response.body.results[0].explanations));
      assert.ok(response.body.audit.logged, 'expected search audit logging to succeed');
    });

    await test('POST /api/search/selection persists selection telemetry for backend/UI consumers', async () => {
      const searchResponse = await invoke(routes, baseCtx, 'POST', '/api/search/query', {
        query: 'repo helper',
        kind: 'skill',
        includeVaultOnly: true,
        repoPath,
        sessionId: 'session-asset-1',
      });

      const response = await invoke(routes, baseCtx, 'POST', '/api/search/selection', {
        query: searchResponse.body.query,
        result: searchResponse.body.results[0],
        resultCount: searchResponse.body.count,
      });

      assert.equal(response.res.statusCode, 200);
      assert.equal(response.body.kind, 'catalog.search.selection');
      assert.equal(response.body.recorded, true);
      assert.ok(response.body.telemetry.eventId);
      assert.ok(response.body.audit.logged);
    });

    await test('catalog audit analytics aggregates lifecycle, search, and session usage by asset', async () => {
      const initialRefresh = await invoke(routes, baseCtx, 'POST', '/api/catalog/refresh?repoPath=' + encodeURIComponent(repoPath), {});
      const repoId = initialRefresh.body.snapshot.repoContext.repoId;
      writeJson(path.join(copilotHomeAbs, 'repo-state', repoId, 'registry.json'), {
        skills: {
          disabled: ['repo-helper'],
        },
      });
      await invoke(routes, baseCtx, 'POST', '/api/catalog/refresh?repoPath=' + encodeURIComponent(repoPath), {});

      const installResult = assets.syncAsset(engineRoot, copilotHomeAbs, 'skill-repo-helper', {
        pointerMode: false,
        force: true,
      });
      const removalResult = assets.removeAsset(copilotHomeAbs, installResult, { force: true });
      assert.equal(removalResult.action, 'removed');

      const response = await invoke(routes, baseCtx, 'GET', '/api/audit/assets?limit=20');

      assert.equal(response.res.statusCode, 200);
      assert.equal(response.body.kind, 'catalog.audit.assets');
      const repoHelper = response.body.analytics.assets.find((asset) => asset.assetId === 'skill-repo-helper');
      assert.ok(repoHelper, 'expected repo-helper analytics');
      assert.ok(repoHelper.search.sampled.resultCount >= 1, 'expected sampled result count');
      assert.ok(repoHelper.search.sampled.selectedCount >= 1, 'expected sampled selection count');
      assert.ok(repoHelper.lifecycle.counts.disabled >= 1, 'expected disabled lifecycle count');
      assert.ok(repoHelper.lifecycle.counts.removed >= 1, 'expected canonical removal lifecycle count');
      const repoGuide = response.body.analytics.assets.find((asset) => asset.assetId === 'agent-repo-guide');
      assert.ok(repoGuide, 'expected repo-guide analytics');
      assert.ok(repoGuide.usage.invocationCount >= 1, 'expected session-derived usage');
      assert.ok(
        response.body.analytics.repos.some((repo) => repo.repoId === repoId),
        'expected repo rollup to include refreshed repo context',
      );
      assert.ok(
        response.body.analytics.recentEvents.some((event) => event.eventType === 'asset.removed'),
        'expected lifecycle removal event in recent analytics feed',
      );
    });

    await test('GET /api/audit/events returns typed audit responses for catalog/search activity', async () => {
      const response = await invoke(routes, baseCtx, 'GET', '/api/audit/events?limit=10');

      assert.equal(response.res.statusCode, 200);
      assert.equal(response.body.kind, 'catalog.audit.events.list');
      assert.ok(Array.isArray(response.body.events));
      assert.ok(response.body.events.length >= 3, 'expected rebuild + search audit events');
      assert.ok(response.body.events.some((event) => event.eventType === 'catalog.rebuilt'));
      assert.ok(response.body.events.some((event) => event.eventType === 'asset.search.query'));
    });

    await test('GET /api/runtime/catalog-health surfaces projection and audit health details', async () => {
      const response = await invoke(routes, baseCtx, 'GET', '/api/runtime/catalog-health');

      assert.equal(response.res.statusCode, 200);
      assert.equal(response.body.kind, 'runtime.catalog-health');
      assert.equal(response.body.ok, true);
      assert.equal(response.body.projection.storage.snapshotExists, true);
      assert.equal(response.body.projection.freshness.status, 'fresh');
      assert.ok(response.body.audit.exists);
      assert.deepEqual(response.body.changes, { version: 3, lastChangedMs: 1234 });
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
