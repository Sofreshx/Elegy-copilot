#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

let patcher;

test.before(async () => {
  patcher = await import('./codex-config-patch.mjs');
});

function withTempConfig(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-config-'));
  const configPath = path.join(root, 'config.toml');
  try {
    return callback(root, configPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('patches the native [agents] receipt without provider tables', () => {
  const patched = patcher.patchCodexConfig('personality = "friendly"\n');
  assert.match(patched, /personality = "friendly"/);
  assert.match(patched, /\[agents\]/);
  assert.match(patched, /enabled = true/);
  assert.match(patched, /max_concurrent_threads_per_session = 6/);
  assert.match(patched, /default_subagent_model = "gpt-5\.6-luna"/);
  assert.match(patched, /default_subagent_reasoning_effort = "high"/);
  assert.match(patched, /max_depth = 1/);
  assert.match(patched, /job_max_runtime_seconds = 1800/);
  assert.doesNotMatch(patched, /model_provider\s*=|model_providers\.|deepseek|opencode/i);
});

test('removes known Elegy legacy blocks while preserving unrelated Codex configuration', () => {
  const source = [
    'approval_policy = "on-request"',
    'model_provider = "instruction_engine_deepseek"',
    '',
    '[model_providers.instruction_engine_deepseek]',
    'name = "DeepSeek V4 via Moon Bridge"',
    'base_url = "http://127.0.0.1:38440/v1"',
    '',
    '[model_providers.company]',
    'name = "Keep this provider"',
    'base_url = "https://example.test/v1"',
    '',
    '[profiles.instruction_engine_plan_review]',
    'model = "mimo-v2-pro"',
  ].join('\n');
  const patched = patcher.patchCodexConfig(source);
  assert.match(patched, /approval_policy = "on-request"/);
  assert.match(patched, /\[model_providers\.company\]/);
  assert.doesNotMatch(patched, /instruction_engine_deepseek|Moon Bridge|\[profiles\.instruction_engine_plan_review\]/);
});

test('removes a root-only known bridge reference without changing unrelated config', () => {
  const patched = patcher.patchCodexConfig([
    'approval_policy = "on-request"',
    'model_provider = "opencode_go_bridge"',
    'model = "gpt-5.6"',
  ].join('\n'));
  assert.doesNotMatch(patched, /opencode_go_bridge/);
  assert.match(patched, /approval_policy = "on-request"/);
  assert.match(patched, /model = "gpt-5\.6"/);
});

test('does not remove legacy-looking values from nested user profiles', () => {
  const patched = patcher.patchCodexConfig([
    'approval_policy = "on-request"',
    '',
    '[profiles.personal]',
    'model_provider = "opencode"',
    'model = "deepseek-v4-pro"',
  ].join('\n'));
  assert.match(patched, /\[profiles\.personal\]/);
  assert.match(patched, /model_provider = "opencode"/);
  assert.match(patched, /model = "deepseek-v4-pro"/);
});

test('patches an existing agents table without touching nested agent tables', () => {
  const source = [
    'model = "gpt-5.5"',
    '',
    '[agents]',
    'max_threads = 8',
    'max_depth = 2',
    'job_max_runtime_seconds = 60',
    'unknown = "preserved"',
    '',
    '[agents.explorer]',
    'model = "gpt-5.4-mini"',
  ].join('\n');
  const patched = patcher.patchCodexConfig(source, { maxThreads: 2, maxDepth: 0, jobMaxRuntimeSeconds: 900 });
  assert.match(patched, /max_concurrent_threads_per_session = 2/);
  assert.match(patched, /max_depth = 0/);
  assert.match(patched, /job_max_runtime_seconds = 900/);
  assert.match(patched, /unknown = "preserved"/);
  assert.doesNotMatch(patched, /max_threads\s*=/);
  assert.match(patched, /\[agents\.explorer\]\nmodel = "gpt-5\.4-mini"/);
});

test('config patching is idempotent and writes a separate provider-free profile', () => {
  withTempConfig((_root, configPath) => {
    const first = patcher.patchConfigFile(configPath);
    const once = fs.readFileSync(configPath, 'utf8');
    const second = patcher.patchConfigFile(configPath);
    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(fs.readFileSync(configPath, 'utf8'), once);

    const profile = patcher.writeProfileConfigFile(configPath);
    const profileText = fs.readFileSync(profile.path, 'utf8');
    assert.match(profileText, /model_reasoning_effort = "max"/);
    assert.match(profileText, /plan_mode_reasoning_effort = "xhigh"/);
    assert.doesNotMatch(profileText, /model_provider|opencode|deepseek/i);
  });
});

test('dry-run returns the modern config without writing it', () => {
  withTempConfig((_root, configPath) => {
    fs.writeFileSync(configPath, 'approval_policy = "on-request"\n', 'utf8');
    const result = patcher.patchConfigFile(configPath, { dryRun: true });
    assert.equal(result.changed, true);
    assert.equal(fs.readFileSync(configPath, 'utf8'), 'approval_policy = "on-request"\n');
    assert.match(result.content, /default_subagent_model = "gpt-5\.6-luna"/);
  });
});

test('parseArgs rejects removed provider and review-model switches', () => {
  assert.throws(() => patcher.parseArgs(['--config', 'config.toml', '--provider-id', 'opencode-go']), /Unknown arg/);
  assert.throws(() => patcher.parseArgs(['--config', 'config.toml', '--review-model', 'gpt-5.4-mini']), /Unknown arg/);
});
