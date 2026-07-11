'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const codexSubagents = require('../lib/codexSubagents');

test('Codex subagent service lists baseline Luna agents without a Spark lane', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-subagents-'));
  const result = codexSubagents.listCodexSubagents({
    codexHome: tmp,
    engineRoot: path.resolve(__dirname, '..', '..'),
  });

  const explorer = result.agents.find((agent) => agent.name === 'explorer');
  const testRunner = result.agents.find((agent) => agent.name === 'test-runner');
  assert.ok(explorer);
  assert.equal(explorer.model, 'gpt-5.6-luna');
  assert.equal(explorer.fastModel, null);
  assert.equal(explorer.allowSpark, false);
  assert.equal(explorer.missing, true);
  assert.ok(testRunner);
  assert.equal(testRunner.model, 'gpt-5.6-luna');
  assert.equal(testRunner.modelReasoningEffort, 'medium');
  assert.equal(testRunner.sandboxMode, 'workspace-write');
  assert.equal(testRunner.missing, true);
  assert.equal(result.summary.managed, 4);
  assert.equal(result.summary.missing, 4);
  assert.equal(result.summary.usable, 0);
});

test('Codex subagent service updates and resets a managed agent safely', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-subagents-'));
  const engineRoot = path.resolve(__dirname, '..', '..');

  codexSubagents.resetCodexSubagent('explorer', { codexHome: tmp, engineRoot });
  let result = codexSubagents.updateCodexSubagent('explorer', {
    model: 'gpt-5.6-luna',
    model_reasoning_effort: 'medium',
    routingMode: 'suggested',
  }, { codexHome: tmp, engineRoot });
  let explorer = result.agents.find((agent) => agent.name === 'explorer');
  assert.equal(explorer.model, 'gpt-5.6-luna');
  assert.equal(explorer.modelReasoningEffort, 'medium');
  assert.equal(explorer.routingMode, 'suggested');
  assert.equal(explorer.drift, true);

  result = codexSubagents.resetCodexSubagent('explorer', { codexHome: tmp, engineRoot });
  explorer = result.agents.find((agent) => agent.name === 'explorer');
  assert.equal(explorer.model, 'gpt-5.6-luna');
  assert.equal(explorer.drift, false);
});

test('Codex subagent service enforces the Luna model and effort cap', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-subagents-'));
  const engineRoot = path.resolve(__dirname, '..', '..');

  assert.throws(() => codexSubagents.updateCodexSubagent('explorer', {
    model: 'gpt-5.6-sol',
  }, { codexHome: tmp, engineRoot }), /gpt-5\.6-luna/);
  assert.throws(() => codexSubagents.updateCodexSubagent('explorer', {
    model_reasoning_effort: 'xhigh',
  }, { codexHome: tmp, engineRoot }), /low, medium, high, or max/);
  assert.throws(() => codexSubagents.updateCodexSubagent('explorer', {
    allowSpark: true,
  }, { codexHome: tmp, engineRoot }), /Spark is disabled/);
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

test('Codex subagent service reports summary and per-agent usage for the UI', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-subagents-'));
  const engineRoot = path.resolve(__dirname, '..', '..');

  codexSubagents.resetCodexSubagent('explorer', { codexHome: tmp, engineRoot });
  codexSubagents.resetCodexSubagent('reviewer', { codexHome: tmp, engineRoot });

  const result = codexSubagents.listCodexSubagents({
    codexHome: tmp,
    engineRoot,
    usageByAgent: [
      { name: 'explorer', count: 2, tokens: 1200, toolEvents: 9, errors: 0 },
      { name: 'reviewer', count: 1, tokens: 800, toolEvents: 2, errors: 1 },
    ],
  });

  const explorer = result.agents.find((agent) => agent.name === 'explorer');
  const reviewer = result.agents.find((agent) => agent.name === 'reviewer');

  assert.equal(result.summary.managed, 4);
  assert.equal(result.summary.installed, 2);
  assert.equal(result.summary.missing, 2);
  assert.equal(result.summary.usable, 2);
  assert.equal(result.summary.nativeConfigSynced, false);
  assert.equal(explorer.operationalStatus, 'ready');
  assert.equal(explorer.usable, true);
  assert.deepEqual(explorer.usageSummary, { runs: 2, tokens: 1200, toolEvents: 9, errors: 0 });
  assert.deepEqual(reviewer.usageSummary, { runs: 1, tokens: 800, toolEvents: 2, errors: 1 });
});
