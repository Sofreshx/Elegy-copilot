'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const codexSubagents = require('../lib/codexSubagents');

test('Codex subagent service lists managed agents and preserves Spark as optional explorer lane', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-subagents-'));
  const result = codexSubagents.listCodexSubagents({
    codexHome: tmp,
    engineRoot: path.resolve(__dirname, '..', '..'),
  });

  const explorer = result.agents.find((agent) => agent.name === 'explorer');
  assert.ok(explorer);
  assert.equal(explorer.model, 'gpt-5.4-mini');
  assert.equal(explorer.fastModel, 'gpt-5.3-codex-spark');
  assert.equal(explorer.allowSpark, true);
  assert.equal(explorer.missing, true);
});

test('Codex subagent service updates and resets a managed agent safely', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-subagents-'));
  const engineRoot = path.resolve(__dirname, '..', '..');

  codexSubagents.resetCodexSubagent('explorer', { codexHome: tmp, engineRoot });
  let result = codexSubagents.updateCodexSubagent('explorer', {
    model: 'gpt-5.3-codex-spark',
    model_reasoning_effort: 'low',
    routingMode: 'suggested',
  }, { codexHome: tmp, engineRoot });
  let explorer = result.agents.find((agent) => agent.name === 'explorer');
  assert.equal(explorer.model, 'gpt-5.3-codex-spark');
  assert.equal(explorer.routingMode, 'suggested');
  assert.equal(explorer.drift, true);

  result = codexSubagents.resetCodexSubagent('explorer', { codexHome: tmp, engineRoot });
  explorer = result.agents.find((agent) => agent.name === 'explorer');
  assert.equal(explorer.model, 'gpt-5.4-mini');
  assert.equal(explorer.drift, false);
});

test('Codex subagent settings patch native Codex agents config', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-subagents-'));
  fs.writeFileSync(path.join(tmp, 'config.toml'), [
    'model = "gpt-5.5"',
    '',
    '[agents.explorer]',
    'model = "gpt-5.4-mini"',
  ].join('\n'), 'utf8');

  const result = codexSubagents.saveSettings(tmp, {
    maxThreads: 2,
    maxDepth: 0,
    jobMaxRuntimeSeconds: 900,
  });

  const configText = fs.readFileSync(path.join(tmp, 'config.toml'), 'utf8');
  assert.equal(result.nativeConfig.changed, true);
  assert.equal(result.nativeConfig.matchesSettings, true);
  assert.ok(configText.includes('[agents]'), configText);
  assert.ok(configText.includes('max_threads = 2'), configText);
  assert.ok(configText.includes('max_depth = 0'), configText);
  assert.ok(configText.includes('job_max_runtime_seconds = 900'), configText);
  assert.ok(configText.includes('[agents.explorer]\nmodel = "gpt-5.4-mini"'), configText);
});

test('Codex subagent settings do not persist when native config patching fails', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-subagents-'));
  fs.writeFileSync(path.join(tmp, 'config.toml'), [
    'model = "gpt-5.5"',
    'broken = "unterminated',
  ].join('\n'), 'utf8');

  assert.throws(() => codexSubagents.saveSettings(tmp, {
    maxThreads: 2,
  }), /Codex config TOML validation failed/);

  assert.equal(fs.existsSync(path.join(tmp, '.elegy-copilot-codex-subagents.json')), false);
});
