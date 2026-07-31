'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const codexSubagents = require('../lib/codexSubagents');

test('Codex subagent service lists bounded Luna agents and the strong Sol reviewer without a Spark lane', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-subagents-'));
  const result = codexSubagents.listCodexSubagents({
    codexHome: tmp,
    engineRoot: path.resolve(__dirname, '..', '..'),
  });

  const explorer = result.agents.find((agent) => agent.name === 'explorer');
  const worker = result.agents.find((agent) => agent.name === 'worker');
  const strongReviewer = result.agents.find((agent) => agent.name === 'reviewer_strong');
  const testRunner = result.agents.find((agent) => agent.name === 'test-runner');
  assert.ok(explorer);
  assert.equal(explorer.model, 'gpt-5.6-luna');
  assert.equal(explorer.modelReasoningEffort, null);
  assert.equal(explorer.fastModel, null);
  assert.equal(explorer.allowSpark, false);
  assert.equal(explorer.missing, true);
  assert.ok(testRunner);
  assert.equal(testRunner.model, 'gpt-5.6-luna');
  assert.equal(testRunner.modelReasoningEffort, null);
  assert.equal(testRunner.sandboxMode, 'workspace-write');
  assert.equal(testRunner.missing, true);
  assert.ok(worker);
  assert.equal(worker.model, 'gpt-5.6-luna');
  assert.equal(worker.modelReasoningEffort, null);
  assert.equal(worker.sandboxMode, 'workspace-write');
  assert.equal(worker.missing, true);
  assert.ok(strongReviewer);
  assert.equal(strongReviewer.model, 'gpt-5.6-sol');
  assert.equal(strongReviewer.sandboxMode, 'read-only');
  assert.equal(strongReviewer.missing, true);
  assert.equal(result.summary.managed, 6);
  assert.equal(result.summary.missing, 6);
  assert.equal(result.summary.usable, 0);
  assert.equal(result.summary.routingMode, 'manual');
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
  const installedText = fs.readFileSync(path.join(tmp, 'agents', 'explorer.toml'), 'utf8');
  assert.doesNotMatch(installedText, /^\[elegy\]$/m);
  const settings = JSON.parse(fs.readFileSync(path.join(tmp, '.elegy-copilot-codex-subagents.json'), 'utf8'));
  assert.equal(settings.agentRouting.explorer, 'suggested');

  result = codexSubagents.resetCodexSubagent('explorer', { codexHome: tmp, engineRoot });
  explorer = result.agents.find((agent) => agent.name === 'explorer');
  assert.equal(explorer.model, 'gpt-5.6-luna');
  assert.equal(explorer.drift, false);
  assert.equal(explorer.routingMode, 'manual');
  const resetSettings = JSON.parse(fs.readFileSync(path.join(tmp, '.elegy-copilot-codex-subagents.json'), 'utf8'));
  assert.equal(resetSettings.agentRouting?.explorer, undefined);
});

test('Codex subagent service enforces the Luna model and supported effort range', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-subagents-'));
  const engineRoot = path.resolve(__dirname, '..', '..');

  assert.throws(() => codexSubagents.updateCodexSubagent('explorer', {
    model: 'gpt-5.6-sol',
  }, { codexHome: tmp, engineRoot }), /gpt-5\.6-luna/);
  const elevated = codexSubagents.updateCodexSubagent('explorer', {
    model_reasoning_effort: 'xhigh',
  }, { codexHome: tmp, engineRoot });
  assert.equal(elevated.agents.find((agent) => agent.name === 'explorer').modelReasoningEffort, 'xhigh');
  assert.throws(() => codexSubagents.updateCodexSubagent('explorer', {
    model_reasoning_effort: 'ultra',
  }, { codexHome: tmp, engineRoot }), /low, medium, high, xhigh, or max/);
  assert.throws(() => codexSubagents.updateCodexSubagent('explorer', {
    allowSpark: true,
  }, { codexHome: tmp, engineRoot }), /Spark is disabled/);
});

test('Codex subagent service preserves the managed Sol model for the strong reviewer', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-subagents-'));
  const engineRoot = path.resolve(__dirname, '..', '..');

  const updated = codexSubagents.updateCodexSubagent('reviewer_strong', {
    model: 'gpt-5.6-sol',
    model_reasoning_effort: 'xhigh',
  }, { codexHome: tmp, engineRoot });
  const strongReviewer = updated.agents.find((agent) => agent.name === 'reviewer_strong');
  assert.equal(strongReviewer.model, 'gpt-5.6-sol');
  assert.equal(strongReviewer.modelReasoningEffort, 'xhigh');
  assert.throws(() => codexSubagents.updateCodexSubagent('reviewer_strong', {
    model: 'gpt-5.6-luna',
  }, { codexHome: tmp, engineRoot }), /gpt-5\.6-sol/);
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
  assert.ok(configText.includes('max_concurrent_threads_per_session = 2'), configText);
  assert.ok(!configText.includes('max_threads ='), configText);
  assert.ok(configText.includes('max_depth = 0'), configText);
  assert.ok(configText.includes('job_max_runtime_seconds = 900'), configText);
  assert.ok(configText.includes('[agents.explorer]\nmodel = "gpt-5.4-mini"'), configText);
});

test('Codex subagent service falls back to manual routing for invalid persisted settings', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-subagents-'));
  fs.writeFileSync(path.join(tmp, '.elegy-copilot-codex-subagents.json'), JSON.stringify({
    routingMode: 'not-a-real-mode',
  }), 'utf8');

  const result = codexSubagents.listCodexSubagents({
    codexHome: tmp,
    engineRoot: path.resolve(__dirname, '..', '..'),
  });

  assert.equal(result.settings.routingMode, 'manual');
  assert.equal(result.summary.routingMode, 'manual');
});

test('legacy off routing remains informational and does not disable installed agents', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-subagents-'));
  const engineRoot = path.resolve(__dirname, '..', '..');
  codexSubagents.resetCodexSubagent('explorer', { codexHome: tmp, engineRoot });
  fs.writeFileSync(path.join(tmp, '.elegy-copilot-codex-subagents.json'), JSON.stringify({
    routingMode: 'off',
    agentRouting: { explorer: 'off' },
  }), 'utf8');

  const result = codexSubagents.listCodexSubagents({ codexHome: tmp, engineRoot });
  const explorer = result.agents.find((agent) => agent.name === 'explorer');
  assert.equal(explorer.routingMode, 'off');
  assert.equal(explorer.operationalStatus, 'ready');
  assert.equal(explorer.usable, true);
  assert.equal(result.summary.disabled, 0);
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

  assert.equal(result.summary.managed, 6);
  assert.equal(result.summary.installed, 2);
  assert.equal(result.summary.missing, 4);
  assert.equal(result.summary.usable, 2);
  assert.equal(result.summary.nativeConfigSynced, false);
  assert.equal(explorer.operationalStatus, 'ready');
  assert.equal(explorer.usable, true);
  assert.deepEqual(explorer.usageSummary, { runs: 2, tokens: 1200, toolEvents: 9, errors: 0 });
  assert.deepEqual(reviewer.usageSummary, { runs: 1, tokens: 800, toolEvents: 2, errors: 1 });
});
