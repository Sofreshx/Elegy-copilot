'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { register } = require('./toolingUpdates');

function createResponse() {
  const state = {
    statusCode: null,
    headers: null,
    chunks: [],
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
    end(chunk) {
      if (chunk != null) {
        state.chunks.push(String(chunk));
      }
    },
  };
}

function findRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method === method && route.path === pathname) {
      return route;
    }
  }

  throw new Error(`Route not found for ${method} ${pathname}`);
}

async function invoke(routes, method, pathname, options = {}) {
  const route = findRoute(routes, method, pathname);
  const req = {
    method,
  };
  const res = createResponse();
  const u = new URL(`http://127.0.0.1${pathname}`);
  route.handler({
    req,
    res,
    u,
    pathname,
    engineRoot: options.engineRoot,
    copilotHomeAbs: options.copilotHomeAbs,
    codexHome: options.codexHome,
    codexSkillsHome: options.codexSkillsHome,
    geminiHome: options.geminiHome,
    antigravityHome: options.antigravityHome,
    antigravitySkillsHome: options.antigravitySkillsHome,
    opencodeHome: options.opencodeHome,
    opencodeSkillsHome: options.opencodeSkillsHome,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    statusCode: res.statusCode,
    body: JSON.parse(res.bodyText || '{}'),
  };
}

test('tooling updates status reports planning and elegy skills update availability', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-tooling-updates-'));
  const cliPath = path.join(tmpRoot, process.platform === 'win32' ? 'elegy-planning.cmd' : 'elegy-planning');
  fs.writeFileSync(cliPath, 'echo fake', 'utf8');

  const routes = register({
    env: {
      INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH: cliPath,
    },
    childProcess: {
      spawnSync() {
        return { stdout: 'elegy-planning 1.0.0', stderr: '' };
      },
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { tag_name: 'v1.1.0', assets: [] };
      },
    }),
    assets: {
      getManagedAssetStatuses() {
        return [
          {
            id: 'elegy-planning-skill',
            source: 'catalog-assets/shared-skills/elegy-planning',
            destination: '/tmp/skills/elegy-planning',
            installed: true,
            upToDate: false,
          },
          {
            id: 'other-skill',
            source: 'catalog-assets/shared-skills/other-skill',
            destination: '/tmp/skills/other-skill',
            installed: true,
            upToDate: true,
          },
        ];
      },
      syncAll() {
        return { ok: true };
      },
    },
  });

  const result = await invoke(routes, 'GET', '/api/tooling-updates/status', {
    engineRoot: '/repo',
    copilotHomeAbs: '/copilot-home',
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.elegyPlanningCli.currentVersion, '1.0.0');
  assert.equal(result.body.elegyPlanningCli.latestVersion, '1.1.0');
  assert.equal(result.body.elegyPlanningCli.updateAvailable, true);
  assert.equal(result.body.elegySkillsAssets.trackedCount, 1);
  assert.equal(result.body.elegySkillsAssets.outdatedCount, 1);
  assert.equal(result.body.elegySkillsAssets.updateAvailable, true);
});

test('tooling updates elegy-skills endpoint runs scoped sync for elegy skill assets', async () => {
  const calls = [];
  const routes = register({
    env: {},
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { tag_name: 'v1.1.0', assets: [] };
      },
    }),
    readJsonBody: async () => ({ force: true, targets: ['codex'] }),
    childProcess: {
      spawnSync() {
        return { stdout: '', stderr: '' };
      },
    },
    assets: {
      getManagedAssetStatuses() {
        return [];
      },
      syncAll(engineRoot, copilotHomeAbs, options) {
        calls.push({ kind: 'syncAll', engineRoot, copilotHomeAbs, options });
        return { ok: true };
      },
    },
  });

  const result = await invoke(routes, 'POST', '/api/tooling-updates/update/elegy-skills', {
    engineRoot: '/repo',
    copilotHomeAbs: '/copilot-home',
    codexHome: '/codex-home',
    codexSkillsHome: '/codex-skills-home',
    geminiHome: '/gemini-home',
    antigravityHome: '/antigravity-home',
    antigravitySkillsHome: '/antigravity-skills-home',
    opencodeHome: '/opencode-home',
    opencodeSkillsHome: '/opencode-skills-home',
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'syncAll');
  assert.equal(calls[0].options.force, true);
  assert.equal(typeof calls[0].options.assetFilter, 'function');
  assert.equal(
    calls[0].options.assetFilter({
      id: 'elegy-skills-discovery',
      source: 'catalog-assets/shared-skills/elegy-skills-discovery',
    }),
    true,
  );
  assert.equal(
    calls[0].options.assetFilter({
      id: 'unrelated-skill',
      source: 'catalog-assets/shared-skills/other-skill',
    }),
    false,
  );
});
