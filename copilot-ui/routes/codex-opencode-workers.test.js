'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { register } = require('./codex');

function makeRoutes(temp, body = {}) {
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
  assert.equal(initial.sent[0].obj.config.defaultModelProfile, 'opencode-zen-free');
  assert.equal(initial.sent[0].obj.config.allowPaidModels, false);

  const updated = makeRoutes(temp, {
    config: {
      defaultModelProfile: 'deepseek-direct',
      allowPaidModels: true,
      roleProfiles: { review: 'opencode-zen-mixed' },
      timeoutSeconds: 120,
    },
  });
  await updated.routes.find((route) => route.path === '/api/codex/opencode-workers/config').handler({
    req: {},
    res: {},
  });
  assert.equal(updated.sent[0].code, 200);
  assert.equal(updated.sent[0].obj.config.defaultModelProfile, 'deepseek-direct');
  assert.equal(updated.sent[0].obj.config.roleProfiles.review, 'opencode-zen-mixed');
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
  assert.equal(sent[0].obj.byRole[0].name, 'research');
});

test('OpenCode Workers install uses targeted Codex export and validates projection', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocw-install-'));
  const codexHome = path.join(temp, 'codex-home');
  const elegyRoot = path.join(temp, 'Elegy');
  const recordPath = path.join(temp, 'packaging-args.json');
  fs.mkdirSync(elegyRoot, { recursive: true });

  const fakePackagingJs = path.join(temp, 'fake-packaging.js');
  fs.writeFileSync(fakePackagingJs, `
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.FAKE_PACKAGING_RECORD, JSON.stringify(args));
const output = args[args.indexOf('--output') + 1];
const pluginRoot = path.join(output, 'plugins', 'elegy-opencode-workers');
fs.mkdirSync(path.join(pluginRoot, '.codex-plugin'), { recursive: true });
fs.mkdirSync(path.join(pluginRoot, 'bin'), { recursive: true });
fs.mkdirSync(path.join(pluginRoot, 'skills', 'opencode-worker-delegation'), { recursive: true });
fs.writeFileSync(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), '{}');
fs.writeFileSync(path.join(pluginRoot, 'bin', 'elegy-opencode-workers'), 'binary');
fs.writeFileSync(path.join(pluginRoot, 'skills', 'opencode-worker-delegation', 'SKILL.md'), 'skill');
process.exit(0);
`, 'utf8');

  let fakeCommand;
  if (process.platform === 'win32') {
    fakeCommand = path.join(temp, 'fake-packaging.cmd');
    fs.writeFileSync(fakeCommand, `@echo off\r\n"${process.execPath}" "${fakePackagingJs}" %*\r\n`, 'utf8');
  } else {
    fakeCommand = path.join(temp, 'fake-packaging.sh');
    fs.writeFileSync(fakeCommand, `#!/usr/bin/env sh\n"${process.execPath}" "${fakePackagingJs}" "$@"\n`, { mode: 0o755 });
  }

  const opencodeWorkers = require('../lib/opencodeWorkers');
  const result = opencodeWorkers.installPlugin({
    codexHome,
    elegyRoot,
    env: {
      ELEGY_PLUGIN_PACKAGING: fakeCommand,
      FAKE_PACKAGING_RECORD: recordPath,
    },
  });

  const args = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  assert.equal(result.ok, true);
  assert.equal(result.status.installed, true);
  assert.deepEqual(args.slice(0, 2), ['marketplace', 'export-codex']);
  assert.ok(args.includes('--plugin'));
  assert.equal(args[args.indexOf('--plugin') + 1], 'elegy-opencode-workers');
  assert.ok(args.includes('--overwrite'));
});
