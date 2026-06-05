#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

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

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-config-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const modulePath = pathToFileURL(path.resolve(__dirname, 'codex-config-patch.mjs')).href;
  const patcher = await import(modulePath);

  await test('patcher adds review_model and managed profile without replacing unrelated settings', async () => {
  withTempDir((root) => {
    const configPath = path.join(root, 'config.toml');
    fs.writeFileSync(configPath, 'personality = "friendly"\n', 'utf8');

    const result = patcher.patchConfigFile(configPath);
    assert.strictEqual(result.changed, true);

    const patched = fs.readFileSync(configPath, 'utf8');
    assert.ok(patched.includes('personality = "friendly"'));
    assert.ok(patched.includes('review_model = "deepseek-v4-pro"'));
    assert.ok(patched.includes('[profiles.instruction_engine_plan_review]'));
    assert.ok(patched.includes('plan_mode_reasoning_effort = "xhigh"'));
  });
  });

  await test('patcher preserves an existing review_model and existing managed-profile name', async () => {
  withTempDir((root) => {
    const configPath = path.join(root, 'config.toml');
    fs.writeFileSync(
      configPath,
      [
        'model = "gpt-5.5"',
        'model_provider = "openai"',
        'review_model = "gpt-5.4-mini"',
        '',
        '[profiles.instruction_engine_plan_review]',
        'personality = "friendly"',
        '',
        '[model_providers.opencode]',
        'name = "OpenCode Zen"',
        'base_url = "https://opencode.ai/zen/v1"',
        'env_key = "OPENCODE_API_KEY"',
        '',
        '[model_providers.opencode-chat]',
        'name = "OpenCode Zen Chat"',
        'base_url = "https://opencode.ai/zen/v1"',
        'env_key = "OPENCODE_API_KEY"',
        'wire_api = "responses"',
        '',
        '[model_providers.opencode-go]',
        'name = "OpenCode Go"',
        'base_url = "https://opencode.ai/zen/go/v1"',
        'env_key = "OPENCODE_API_KEY"',
        'wire_api = "responses"',
      ].join('\n'),
      'utf8',
    );

    const result = patcher.patchConfigFile(configPath);
    assert.ok(typeof result.changed === 'boolean');

    const patched = fs.readFileSync(configPath, 'utf8');
    const reviewMatches = patched.match(/review_model\s*=/g) || [];
    const profileMatches = patched.match(/\[profiles\.instruction_engine_plan_review\]/g) || [];
    assert.strictEqual(reviewMatches.length, 1, patched);
    assert.strictEqual(profileMatches.length, 1, patched);
    assert.ok(!patched.includes('# BEGIN instruction-engine managed codex defaults'), patched);
  });
  });

  await test('patcher is idempotent across repeated runs', async () => {
  withTempDir((root) => {
    const configPath = path.join(root, 'config.toml');
    fs.writeFileSync(configPath, '', 'utf8');

    const first = patcher.patchConfigFile(configPath);
    assert.strictEqual(first.changed, true);
    const once = fs.readFileSync(configPath, 'utf8');

    const second = patcher.patchConfigFile(configPath);
    assert.strictEqual(second.changed, false);
    const twice = fs.readFileSync(configPath, 'utf8');

    assert.strictEqual(twice, once);
    assert.ok(twice.includes('# BEGIN instruction-engine managed codex defaults'));
  });
  });

  await test('patcher dry-run prints patched content without writing the file', async () => {
  withTempDir((root) => {
    const configPath = path.join(root, 'config.toml');
    fs.writeFileSync(configPath, 'personality = "pragmatic"\n', 'utf8');

    const result = patcher.patchConfigFile(configPath, { dryRun: true });
    assert.strictEqual(result.changed, true);

    const current = fs.readFileSync(configPath, 'utf8');
    assert.strictEqual(current, 'personality = "pragmatic"\n');
    assert.ok(result.content.includes('review_model = "deepseek-v4-pro"'));
  });
  });

  await test('patcher adds external providers by default', async () => {
  withTempDir((root) => {
    const configPath = path.join(root, 'config.toml');
    fs.writeFileSync(configPath, '', 'utf8');

    const result = patcher.patchConfigFile(configPath, { enableExternalProviders: true });
    assert.strictEqual(result.changed, true);

    const patched = fs.readFileSync(configPath, 'utf8');
    assert.ok(patched.includes('[model_providers.opencode]'), patched);
    assert.ok(patched.includes('[model_providers.opencode-chat]'), patched);
    assert.ok(patched.includes('[model_providers.opencode-go]'), patched);
    assert.ok(patched.includes('wire_api = "responses"'), patched);
  });
  });

  await test('patcher skips external providers when disabled', async () => {
  withTempDir((root) => {
    const configPath = path.join(root, 'config.toml');
    fs.writeFileSync(configPath, '', 'utf8');

    const result = patcher.patchConfigFile(configPath, { enableExternalProviders: false });
    assert.strictEqual(result.changed, true);

    const patched = fs.readFileSync(configPath, 'utf8');
    assert.ok(patched.includes('review_model = "deepseek-v4-pro"'), patched);
    assert.ok(!patched.includes('[model_providers.'), patched);
  });
  });

  await test('patcher does not duplicate existing providers when all present', async () => {
  withTempDir((root) => {
    const configPath = path.join(root, 'config.toml');
    fs.writeFileSync(configPath, '', 'utf8');

    const result = patcher.patchConfigFile(configPath, { enableExternalProviders: true });
    assert.strictEqual(result.changed, true);
    const first = result.content;

    const result2 = patcher.patchCodexConfig(first, { enableExternalProviders: true });
    assert.strictEqual(result2, first);
  });
  });

  await test('patcher places root-level keys before the first TOML table', async () => {
  withTempDir((root) => {
    const configPath = path.join(root, 'config.toml');
    const configText = [
      'approval_policy = "on-request"',
      '',
      '[windows]',
      'shell = "pwsh"',
      '',
      '[projects."my-project"]',
      'trust_level = "trusted"',
    ].join('\n');
    fs.writeFileSync(configPath, configText, 'utf8');

    const result = patcher.patchConfigFile(configPath);
    assert.strictEqual(result.changed, true);

    const patched = fs.readFileSync(configPath, 'utf8');

    // Root-level keys (model, model_provider, review_model) must appear before the first table header
    const firstTableIndex = Math.min(
      patched.indexOf('[windows]'),
      patched.indexOf('[projects.'),
      patched.indexOf('[profiles.'),
      patched.indexOf('[model_providers.'),
    );

    const modelIndex = patched.indexOf('model = "');
    const providerIndex = patched.indexOf('model_provider = "');
    const reviewIndex = patched.indexOf('review_model = "');

    // At least some root keys should be present (model_provider or review_model)
    assert.ok(modelIndex >= 0 || providerIndex >= 0 || reviewIndex >= 0, 'expected root keys in output');

    // Each root key we find must appear before the first table
    if (modelIndex >= 0) {
      assert.ok(modelIndex < firstTableIndex, `model = must appear before first table; model at ${modelIndex}, first table at ${firstTableIndex}`);
    }
    if (providerIndex >= 0) {
      assert.ok(providerIndex < firstTableIndex, `model_provider = must appear before first table; provider at ${providerIndex}, first table at ${firstTableIndex}`);
    }
    if (reviewIndex >= 0) {
      assert.ok(reviewIndex < firstTableIndex, `review_model = must appear before first table; review at ${reviewIndex}, first table at ${firstTableIndex}`);
    }

    // Original tables must be preserved
    assert.ok(patched.includes('[windows]'), patched);
    assert.ok(patched.includes('shell = "pwsh"'), patched);
    assert.ok(patched.includes('[projects."my-project"]'), patched);
  });
  });

  await test('patcher is idempotent on config with existing TOML tables', async () => {
  withTempDir((root) => {
    const configPath = path.join(root, 'config.toml');
    const configText = [
      'personality = "pragmatic"',
      '',
      '[windows]',
      'shell = "pwsh"',
    ].join('\n');
    fs.writeFileSync(configPath, configText, 'utf8');

    const first = patcher.patchConfigFile(configPath);
    assert.strictEqual(first.changed, true);
    const once = fs.readFileSync(configPath, 'utf8');

    const second = patcher.patchConfigFile(configPath);
    assert.strictEqual(second.changed, false);
    const twice = fs.readFileSync(configPath, 'utf8');

    assert.strictEqual(twice, once);
    assert.ok(twice.includes('review_model = "deepseek-v4-pro"'));
    assert.ok(twice.includes('[windows]'));
  });
  });

  await test('patcher preserves unrelated config tables without duplicating managed defaults', async () => {
  withTempDir((root) => {
    const configPath = path.join(root, 'config.toml');
    const configText = [
      'approval_policy = "on-request"',
      '',
      '[plugin.markdown]',
      'enabled = true',
      '',
      '[mcp_servers.my-server]',
      'command = "node"',
    ].join('\n');
    fs.writeFileSync(configPath, configText, 'utf8');

    const result = patcher.patchConfigFile(configPath);
    const patched = fs.readFileSync(configPath, 'utf8');

    assert.ok(patched.includes('approval_policy = "on-request"'));
    assert.ok(patched.includes('[plugin.markdown]'));
    assert.ok(patched.includes('[mcp_servers.my-server]'));
    assert.ok(patched.includes('review_model = "deepseek-v4-pro"'));

    // Verify the managed block END marker exists
    assert.ok(patched.includes('# END instruction-engine managed codex defaults'), patched);

    // Verify no duplicate managed blocks
    const beginCount = (patched.match(/# BEGIN instruction-engine managed codex defaults/g) || []).length;
    assert.strictEqual(beginCount, 1);
  });
  });

  await test('patcher migrates existing instruction-engine block to correct positions', async () => {
  withTempDir((root) => {
    const configPath = path.join(root, 'config.toml');
    // Simulate a config with the old-style managed block (root keys inside the managed block)
    const configText = [
      'approval_policy = "on-request"',
      '',
      '[windows]',
      'shell = "pwsh"',
      '',
      '# BEGIN instruction-engine managed codex defaults',
      'model = "mimo-v2-pro"',
      '',
      'model_provider = "opencode-go"',
      '',
      '[profiles.instruction_engine_plan_review]',
      'model_provider = "opencode-go"',
      'model = "mimo-v2-pro"',
      '# END instruction-engine managed codex defaults',
    ].join('\n');
    fs.writeFileSync(configPath, configText, 'utf8');

    const result = patcher.patchConfigFile(configPath);
    const patched = fs.readFileSync(configPath, 'utf8');

    // After migration, the old style should be gone (managed block only contains tables now)
    const beginMarkers = (patched.match(/# BEGIN instruction-engine managed codex defaults/g) || []);
    assert.strictEqual(beginMarkers.length, 1, 'exactly one managed block');

    // Root keys must be before first table header
    const firstTableIdx = Math.min(
      patched.indexOf('[windows]'),
      patched.indexOf('[profiles.'),
      patched.indexOf('[model_providers.'),
    );
    const providerIdx = patched.indexOf('model_provider = "');
    assert.ok(providerIdx < firstTableIdx, 'model_provider must appear before first table');

    // Original user config preserved
    assert.ok(patched.includes('[windows]'), patched);
    assert.ok(patched.includes('shell = "pwsh"'), patched);
    assert.ok(patched.includes('approval_policy = "on-request"'), patched);
  });
  });

  console.log(`\n${passed} tests passed`);
  if (process.exitCode) {
    console.error('Some tests FAILED');
  } else {
    console.log('All tests passed');
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
