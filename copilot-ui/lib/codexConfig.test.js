'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { getStatus, migrateLegacyCodexConfig } = require('./codexConfig');

test('legacy Codex cleanup backs up and removes only known Elegy provider blocks', () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-legacy-migration-'));
  try {
    const configPath = path.join(codexHome, 'config.toml');
    fs.writeFileSync(configPath, [
      'approval_policy = "on-request"',
      'model_provider = "instruction_engine_deepseek"',
      '',
      '[model_providers.instruction_engine_deepseek]',
      'name = "DeepSeek V4 via Moon Bridge"',
      'base_url = "http://127.0.0.1:38440/v1"',
      '',
      '[model_providers.my_company]',
      'name = "Keep this provider"',
      'base_url = "https://example.test/v1"',
      '',
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(codexHome, '.elegy-deepseek-state.json'), '{}', 'utf8');

    const result = migrateLegacyCodexConfig(codexHome);
    assert.equal(result.changed, true);
    assert.ok(result.backupPath);
    assert.equal(fs.existsSync(result.backupPath), true);
    const migrated = fs.readFileSync(configPath, 'utf8');
    assert.match(migrated, /approval_policy = "on-request"/);
    assert.match(migrated, /\[model_providers\.my_company\]/);
    assert.doesNotMatch(migrated, /instruction_engine_deepseek|Moon Bridge/);
    assert.equal(fs.existsSync(path.join(codexHome, '.elegy-deepseek-state.json')), false);

    const second = migrateLegacyCodexConfig(codexHome);
    assert.equal(second.changed, false);
  } finally {
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test('Codex status reports native ownership and legacy migration availability', () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-status-'));
  try {
    fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model_provider = "opencode_go_bridge"\n', 'utf8');
    const status = getStatus(codexHome);
    assert.equal(status.activeMode, 'native');
    assert.equal(status.providerId, 'openai');
    assert.equal(status.hasLegacyBlock, true);
    assert.equal(status.legacyMigration.required, true);
  } finally {
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test('legacy Codex cleanup removes a root-only bridge reference and preserves unrelated keys', () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-root-only-migration-'));
  try {
    const configPath = path.join(codexHome, 'config.toml');
    fs.writeFileSync(configPath, [
      'approval_policy = "on-request"',
      'model_provider = "opencode_go_bridge"',
      'model = "gpt-5.6"',
      '',
    ].join('\n'), 'utf8');

    const result = migrateLegacyCodexConfig(codexHome);
    assert.equal(result.changed, true);
    const migrated = fs.readFileSync(configPath, 'utf8');
    assert.doesNotMatch(migrated, /opencode_go_bridge/);
    assert.match(migrated, /approval_policy = "on-request"/);
    assert.match(migrated, /model = "gpt-5\.6"/);
    assert.ok(result.backupPath);
    assert.equal(fs.existsSync(result.backupPath), true);
  } finally {
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test('legacy Codex cleanup preserves unrelated TOML array tables', () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-array-table-migration-'));
  try {
    const configPath = path.join(codexHome, 'config.toml');
    fs.writeFileSync(configPath, [
      '[model_providers.opencode_go_bridge]',
      'base_url = "http://127.0.0.1:38441/v1"',
      '',
      '[[tools]]',
      'name = "keep-me"',
      '',
    ].join('\n'), 'utf8');

    migrateLegacyCodexConfig(codexHome);

    const migrated = fs.readFileSync(configPath, 'utf8');
    assert.match(migrated, /\[\[tools\]\]/);
    assert.match(migrated, /name = "keep-me"/);
    assert.doesNotMatch(migrated, /opencode_go_bridge/);
  } finally {
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test('legacy Codex cleanup preserves legacy-looking values in user profiles', () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-profile-migration-'));
  try {
    const configPath = path.join(codexHome, 'config.toml');
    fs.writeFileSync(configPath, [
      '[model_providers.company]',
      'base_url = "https://example.test/v1"',
      '',
      '[profiles.personal]',
      'model_provider = "opencode"',
      'model = "deepseek-v4-pro"',
      '',
    ].join('\n'), 'utf8');

    migrateLegacyCodexConfig(codexHome);

    const migrated = fs.readFileSync(configPath, 'utf8');
    assert.match(migrated, /\[profiles\.personal\]/);
    assert.match(migrated, /model_provider = "opencode"/);
    assert.match(migrated, /model = "deepseek-v4-pro"/);
  } finally {
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});
