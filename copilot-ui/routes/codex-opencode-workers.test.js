'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { register } = require('./codex');

function makeRoutes(temp, body = {}, envPatch = {}) {
  const sent = [];
  return {
    sent,
    routes: register({
      sendJson: (_res, code, obj) => sent.push({ code, obj }),
      readJsonBody: async () => body,
      opencodeWorkers: require('../lib/opencodeWorkers'),
      env: {
        ELEGY_OPENCODE_WORKERS_CONFIG: path.join(temp, 'config.json'),
        ELEGY_OPENCODE_WORKERS_JOURNAL: path.join(temp, 'jobs.jsonl'),
        ...envPatch,
      },
    }),
  };
}

test('OpenCode Workers routes expose config defaults and persist updates', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocw-routes-'));
  const initial = makeRoutes(temp);

  await initial.routes.find((route) => route.path === '/api/codex/opencode-workers').handler({
    res: {},
    u: new URL('http://localhost/api/codex/opencode-workers'),
  });
  assert.equal(initial.sent[0].code, 200);
  assert.equal(initial.sent[0].obj.config.defaultModelProfile, 'opencode-go-balanced');
  assert.equal(initial.sent[0].obj.config.allowPaidModels, false);
  assert.equal(initial.sent[0].obj.config.writeEnabled, false);
  assert.ok(initial.sent[0].obj.roles.includes('implementation'));
  assert.equal(initial.sent[0].obj.effectiveRolePolicies.implementation.mode, 'read-only');

  const updated = makeRoutes(temp, {
    config: {
      defaultModelProfile: 'deepseek-direct',
      allowPaidModels: true,
      writeEnabled: true,
      rolePolicies: {
        implementation: { profile: 'deepseek-direct', writeEnabled: true },
        review: { profile: 'opencode-zen-mixed', writeEnabled: false },
      },
      timeoutSeconds: 120,
    },
  });
  await updated.routes.find((route) => route.path === '/api/codex/opencode-workers/config').handler({
    req: {},
    res: {},
  });
  assert.equal(updated.sent[0].code, 200);
  assert.equal(updated.sent[0].obj.config.defaultModelProfile, 'opencode-go-balanced');
  assert.equal(updated.sent[0].obj.config.roleProfiles.review, undefined);
  assert.equal(updated.sent[0].obj.config.rolePolicies.implementation.writeEnabled, true);
  assert.equal(updated.sent[0].obj.effectiveRolePolicies.implementation.mode, 'read-write');
  assert.ok(updated.sent[0].obj.roleModelMatrix.implementation);
});

test('OpenCode Workers reject paid/direct profiles unless opted in', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocw-paid-'));
  const routes = makeRoutes(temp, {
    config: {
      defaultModelProfile: 'deepseek-direct',
      allowPaidModels: false,
      rolePolicies: {
        implementation: { profile: 'deepseek-direct', writeEnabled: true },
      },
      writeEnabled: true,
    },
  });

  await routes.routes.find((route) => route.path === '/api/codex/opencode-workers/config').handler({
    req: {},
    res: {},
  });

  assert.equal(routes.sent[0].code, 200);
  assert.equal(routes.sent[0].obj.config.defaultModelProfile, 'opencode-go-balanced');
  assert.equal(routes.sent[0].obj.config.rolePolicies.implementation?.profile, undefined);
  assert.equal(routes.sent[0].obj.config.rolePolicies.implementation?.writeEnabled, true);
});

test('OpenCode Workers usage summarizes journal records', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocw-usage-'));
  const journal = path.join(temp, 'jobs.jsonl');
  fs.writeFileSync(journal, `${JSON.stringify({
    entry: {
      type: 'result',
      result: {
        job: { id: 'ocw_1', state: 'completed', role: 'review', model: 'opencode/deepseek-v4-flash-free' },
        permissionRequests: [],
        evidence: { usage: { used: 9, cost: { amount: 0, currency: 'USD' } } },
      },
    },
  })}\n${JSON.stringify({
    entry: {
      type: 'result',
      result: {
        job: { id: 'ocw_2', state: 'policy_violation', role: 'research', model: 'deepseek/deepseek-v4-pro' },
        permissionRequests: [{ decision: 'denied' }],
        permissionRequestCount: 2,
        writeEvidence: { attempted: true, changedFiles: ['src/file.ts'], gitDirty: true },
        evidence: { usage: { used: 3, cost: { amount: 2, currency: 'USD' } } },
      },
    },
  })}\n`);
  const { routes, sent } = makeRoutes(temp);
  await routes.find((route) => route.path === '/api/codex/opencode-workers/usage').handler({
    res: {},
    u: new URL('http://localhost/api/codex/opencode-workers/usage'),
  });

  assert.equal(sent[0].code, 200);
  assert.equal(sent[0].obj.summary.runs, 2);
  assert.equal(sent[0].obj.summary.policyViolations, 1);
  assert.equal(sent[0].obj.summary.tokens, 12);
  assert.equal(sent[0].obj.summary.cost, 2);
  assert.equal(sent[0].obj.summary.permissionRequests, 2);
  assert.equal(sent[0].obj.summary.permissionDenials, 1);
  assert.equal(sent[0].obj.summary.writeAttempts, 1);
  assert.equal(sent[0].obj.summary.changedFiles, 1);
  assert.equal(sent[0].obj.summary.dirtyGitStates, 1);
  assert.equal(sent[0].obj.permissionEvidence.length, 1);
  assert.equal(sent[0].obj.byRole[0].name, 'research');
});

test('OpenCode Workers usage prefers cwd-scoped journal when repoPath is supplied', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocw-cwd-'));
  const repo = path.join(temp, 'repo');
  const journalDir = path.join(repo, '.opencode-workers');
  fs.mkdirSync(journalDir, { recursive: true });
  fs.writeFileSync(path.join(journalDir, 'jobs.jsonl'), `${JSON.stringify({
    entry: {
      type: 'result',
      result: {
        job: { id: 'ocw_repo', state: 'completed', role: 'exploration', model: 'opencode/deepseek-v4-flash-free' },
        permissionRequestCount: 0,
        evidence: { usage: { used: 4, cost: { amount: 0, currency: 'USD' } } },
      },
    },
  })}\n`);

  const { routes, sent } = makeRoutes(temp, {}, { ELEGY_OPENCODE_WORKERS_JOURNAL: '' });
  await routes.find((route) => route.path === '/api/codex/opencode-workers/usage').handler({
    res: {},
    u: new URL(`http://localhost/api/codex/opencode-workers/usage?repoPath=${encodeURIComponent(repo)}`),
  });

  assert.equal(sent[0].code, 200);
  assert.equal(sent[0].obj.journalScope, 'cwd');
  assert.equal(sent[0].obj.summary.runs, 1);
  assert.equal(sent[0].obj.source.path, path.resolve(repo, '.opencode-workers', 'jobs.jsonl'));
});

test('OpenCode Workers install delegates to Elegy Codex marketplace and validates projection', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocw-install-'));
  const codexHome = path.join(temp, 'codex-home');
  const archiveBuffer = Buffer.from('fake opencode workers marketplace');
  const sha = require('../lib/elegyPluginMarketplace').sha256Buffer(archiveBuffer);
  const calls = [];

  const opencodeWorkers = require('../lib/opencodeWorkers');
  const result = await opencodeWorkers.installPlugin({
    codexHome,
    target: 'x86_64-pc-windows-msvc',
    archiveBuffer,
    checksumText: sha,
    extractZip(_archive, destination) {
      const pluginRoot = path.join(destination, 'plugins', 'elegy-opencode-workers');
      fs.mkdirSync(path.join(destination, '.agents', 'plugins'), { recursive: true });
      fs.writeFileSync(path.join(destination, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({
        name: 'elegy',
        plugins: [{ name: 'elegy-opencode-workers', source: { source: 'local', path: './plugins/elegy-opencode-workers' } }],
      }), 'utf8');
      fs.mkdirSync(path.join(pluginRoot, '.codex-plugin'), { recursive: true });
      fs.mkdirSync(path.join(pluginRoot, 'bin'), { recursive: true });
      fs.mkdirSync(path.join(pluginRoot, 'skills', 'opencode-worker-delegation'), { recursive: true });
      fs.writeFileSync(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'elegy-opencode-workers', version: '0.1.0+codex.abcdef123456' }));
      fs.writeFileSync(path.join(pluginRoot, 'bin', 'elegy-opencode-workers.exe'), 'binary');
      fs.writeFileSync(path.join(pluginRoot, 'skills', 'opencode-worker-delegation', 'SKILL.md'), 'skill');
    },
    spawnSyncImpl(command, args) {
      calls.push([command, ...args]);
      if (args.includes('--available')) {
        return { status: 0, stdout: JSON.stringify({ plugins: [{ name: 'elegy-opencode-workers', version: '0.1.0+codex.abcdef123456' }] }), stderr: '' };
      }
      return { status: 0, stdout: JSON.stringify({ plugins: [{ name: 'elegy-opencode-workers', version: '0.1.0+codex.abcdef123456', installed: true }] }), stderr: '' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status.installed, true);
  assert.deepEqual(calls.map((call) => call.slice(0, 4)), [
    ['codex', 'plugin', 'marketplace', 'add'],
    ['codex', 'plugin', 'add', 'elegy-opencode-workers@elegy'],
    ['codex', 'plugin', 'list', '--marketplace'],
    ['codex', 'plugin', 'list', '--marketplace'],
  ]);
});
