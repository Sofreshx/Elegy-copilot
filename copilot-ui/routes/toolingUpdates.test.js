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
  await route.handler({
    req,
    res,
    u,
    pathname,
    engineRoot: options.engineRoot,
    elegyHomeAbs: options.elegyHomeAbs,
    codexHome: options.codexHome,
    codexSkillsHome: options.codexSkillsHome,
    geminiHome: options.geminiHome,
    antigravityHome: options.antigravityHome,
    antigravitySkillsHome: options.antigravitySkillsHome,
    opencodeHome: options.opencodeHome,
    opencodeSkillsHome: options.opencodeSkillsHome,
  });
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
      spawnSync(_cmd, args) {
        if (args && args.includes('health') && args.includes('--json')) {
          return { stdout: JSON.stringify({ status: 'ok', data: { schemaVersion: '1.0.0' } }), stderr: '' };
        }
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
    assets: {},
  });
  const result = await invoke(routes, 'GET', '/api/tooling-updates/status', {
    engineRoot: '/repo',
    elegyHomeAbs: '/copilot-home',
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.elegyPlanningCli.currentVersion, '1.0.0');
  assert.equal(result.body.elegyPlanningCli.latestVersion, '1.1.0');
  assert.equal(result.body.elegyPlanningCli.updateAvailable, true);
  assert.equal(result.body.elegySkillsAssets.source, 'github-source');
  assert.equal(result.body.elegySkillsAssets.trackedCount, 3);
  assert.equal(result.body.elegySkillsAssets.outdatedCount, 3);
  assert.equal(result.body.elegySkillsAssets.updateAvailable, true);
  assert.deepEqual(result.body.elegyPlanningCli.features.missing, [
    'session',
    'project-run',
    'root-search',
    'goal-update-status',
    'roadmap-update-status',
    'plan-update-status',
    'todo-update-status',
    'issue-update-status',
    'entity-search',
  ]);
});
test('tooling updates elegy-skills endpoint installs from managed GitHub source', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-tooling-github-skills-'));
  const elegyHome = path.join(tmpRoot, '.elegy');
  const opencodeHome = path.join(tmpRoot, '.opencode');
  const sourceRoot = path.join(elegyHome, 'managed-cli', 'planning', 'source', 'Elegy');
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
      execFile(command, args, options, callback) {
        assert.equal(command, 'git');
        assert.equal(args[0], 'clone');
        const destination = args[args.length - 1];
        fs.mkdirSync(path.join(destination, 'rust', 'crates', 'elegy-planning'), { recursive: true });
        fs.writeFileSync(path.join(destination, 'rust', 'Cargo.toml'), '[workspace]', 'utf8');
        fs.writeFileSync(path.join(destination, 'rust', 'crates', 'elegy-planning', 'Cargo.toml'), '[package]', 'utf8');
        for (const rel of [
          path.join('src', 'Elegy-planning', 'skills', 'elegy-planning'),
          path.join('src', 'Elegy-skills', 'skills', 'elegy-skills'),
          path.join('skills', 'elegy-obsidian'),
        ]) {
          fs.mkdirSync(path.join(destination, rel), { recursive: true });
          fs.writeFileSync(path.join(destination, rel, 'SKILL.md'), `# ${rel}`, 'utf8');
        }
        callback(null, '', '');
      },
      spawnSync() {
        return { status: 0, stdout: 'asset-head\n', stderr: '' };
      },
    },
    assets: {},
  });
  const result = await invoke(routes, 'POST', '/api/tooling-updates/update/elegy-skills', {
    engineRoot: '/repo',
    elegyHomeAbs: elegyHome,
    codexHome: '/codex-home',
    codexSkillsHome: '/codex-skills-home',
    geminiHome: '/gemini-home',
    antigravityHome: '/antigravity-home',
    antigravitySkillsHome: '/antigravity-skills-home',
    opencodeHome,
    opencodeSkillsHome: '/opencode-skills-home',
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.syncResult.source, 'github-source');
  assert.equal(result.body.syncResult.sourceRepoRoot, sourceRoot);
  assert.equal(result.body.syncResult.installed.length, 3);
  assert.ok(fs.existsSync(path.join(opencodeHome, 'skills', 'elegy-planning', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(opencodeHome, 'skills', 'elegy-skills', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(opencodeHome, 'skills', 'elegy-obsidian', 'SKILL.md')));
});
test('tooling updates elegy-planning endpoint installs from managed GitHub source', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-tooling-local-elegy-'));
  const engineRoot = path.join(tmpRoot, 'elegy-copilot');
  const elegyHome = path.join(tmpRoot, '.elegy');
  const elegyRoot = path.join(elegyHome, 'managed-cli', 'planning', 'source', 'Elegy');
  const rustRoot = path.join(elegyRoot, 'rust');
  fs.mkdirSync(engineRoot, { recursive: true });
  const exeName = process.platform === 'win32' ? 'elegy-planning.exe' : 'elegy-planning';
  const builtBinary = path.join(rustRoot, 'target', 'release', exeName);
  const helpByCommand = new Map([
    ['--help', 'Commands: goal roadmap plan todo issue review-point validate events health project session search project-run'],
    ['goal --help', 'Commands: create list show update-status search'],
    ['roadmap --help', 'Commands: create add-section add-work-point list show update-status search'],
    ['plan --help', 'Commands: create list show revise update-status search'],
    ['todo --help', 'Commands: create list update-status search'],
    ['issue --help', 'Commands: record list show update-status search'],
    ['project-run --help', 'Commands: claim activate release add-evidence list show'],
    ['session --help', 'Commands: init use show'],
  ]);
  const routes = register({
    env: {},
    childProcess: {
      execFile(command, args, options, callback) {
        if (command === 'git' && args[0] === 'clone') {
          const destination = args[args.length - 1];
          fs.mkdirSync(path.join(destination, 'rust', 'crates', 'elegy-planning'), { recursive: true });
          fs.writeFileSync(path.join(destination, 'rust', 'Cargo.toml'), '[workspace]', 'utf8');
          fs.writeFileSync(path.join(destination, 'rust', 'crates', 'elegy-planning', 'Cargo.toml'), '[package]', 'utf8');
          callback(null, '', '');
          return;
        }
        assert.equal(command, 'cargo');
        assert.equal(options.cwd, rustRoot);
        fs.mkdirSync(path.dirname(builtBinary), { recursive: true });
        fs.writeFileSync(builtBinary, 'binary', 'utf8');
        callback(null, '', '');
      },
      spawnSync(command, args) {
        if (command === 'git') {
          return { status: 0, stdout: 'source-head\n', stderr: '' };
        }
        if (args && args[0] === '--version') {
          return { status: 0, stdout: 'elegy-planning 0.1.0', stderr: '' };
        }
        const key = Array.isArray(args) ? args.join(' ') : '';
        return { status: 0, stdout: helpByCommand.get(key) || '', stderr: '' };
      },
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { tag_name: 'v0.1.0', assets: [] };
      },
    }),
    assets: {
      getManagedAssetStatuses() {
        return [];
      },
      syncAll() {
        return { ok: true };
      },
    },
  });
  const result = await invoke(routes, 'POST', '/api/tooling-updates/update/elegy-planning', {
    engineRoot,
    elegyHomeAbs: elegyHome,
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.match(result.body.downloadedPath, /managed-cli/);
  assert.equal(result.body.installMetadata.source, 'github-source');
  assert.equal(result.body.installMetadata.sourceGitHead, 'source-head');
  assert.match(result.body.installMetadata.sourceRemote, /github\.com\/Sofreshx\/Elegy/);
  assert.equal(result.body.status.elegyPlanningCli.features.complete, true);
  assert.equal(result.body.status.elegyPlanningCli.updateAvailable, false);
});
