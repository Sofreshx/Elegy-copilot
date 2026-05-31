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
    assert.ok(patched.includes('review_model = "gpt-5.4"'));
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
        'wire_api = "chat"',
        '',
        '[model_providers.opencode-go]',
        'name = "OpenCode Go"',
        'base_url = "https://opencode.ai/zen/go/v1"',
        'env_key = "OPENCODE_API_KEY"',
        'wire_api = "chat"',
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
    assert.ok(result.content.includes('review_model = "gpt-5.4"'));
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
    assert.ok(patched.includes('wire_api = "chat"'), patched);
  });
  });

  await test('patcher skips external providers when disabled', async () => {
  withTempDir((root) => {
    const configPath = path.join(root, 'config.toml');
    fs.writeFileSync(configPath, '', 'utf8');

    const result = patcher.patchConfigFile(configPath, { enableExternalProviders: false });
    assert.strictEqual(result.changed, true);

    const patched = fs.readFileSync(configPath, 'utf8');
    assert.ok(patched.includes('review_model = "gpt-5.4"'), patched);
    assert.ok(!patched.includes('model_providers'), patched);
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
