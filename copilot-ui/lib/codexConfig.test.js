'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  MANAGED_BLOCK_START,
  appendManagedBlock,
  applySoftReset,
  getStatus,
  hardReset,
  resolveBackupPath,
  resolveConfigPath,
  setMode,
  stripManagedBlock,
} = require('./codexConfig');

describe('codexConfig', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appendManagedBlock adds an Elegy-managed provider block', () => {
    const next = appendManagedBlock('model = "gpt-5.4"\n');
    assert.ok(next.nextText.includes(MANAGED_BLOCK_START));
    assert.ok(next.nextText.includes('model_provider = "instruction_engine_elegy"'));
  });

  it('stripManagedBlock removes only the managed block', () => {
    const text = appendManagedBlock('approval_policy = "on-request"\n').nextText;
    const stripped = stripManagedBlock(text);
    assert.ok(!stripped.includes(MANAGED_BLOCK_START));
    assert.ok(stripped.includes('approval_policy = "on-request"'));
  });

  it('applySoftReset removes the managed block and preserves unrelated text', () => {
    const text = appendManagedBlock('approval_policy = "on-request"\n').nextText;
    const reset = applySoftReset(text);
    assert.equal(reset, 'approval_policy = "on-request"\n');
  });

  it('setMode writes a backup and activates the Elegy provider', () => {
    const configPath = resolveConfigPath(tmpDir);
    fs.writeFileSync(configPath, 'approval_policy = "on-request"\n', 'utf8');

    const result = setMode(tmpDir, 'elegy-routed');
    const config = fs.readFileSync(configPath, 'utf8');

    assert.equal(result.activeMode, 'elegy-routed');
    assert.ok(config.includes('model_provider = "instruction_engine_elegy"'));
    assert.ok(fs.existsSync(resolveBackupPath(tmpDir)));
  });

  it('setMode native performs a soft reset without removing the backup', () => {
    const configPath = resolveConfigPath(tmpDir);
    fs.writeFileSync(configPath, 'approval_policy = "on-request"\n', 'utf8');
    setMode(tmpDir, 'elegy-routed');

    const result = setMode(tmpDir, 'native');
    const config = fs.readFileSync(configPath, 'utf8');

    assert.equal(result.activeMode, 'native');
    assert.ok(!config.includes(MANAGED_BLOCK_START));
    assert.ok(fs.existsSync(resolveBackupPath(tmpDir)));
  });

  it('hardReset restores the backup snapshot and removes state', () => {
    const configPath = resolveConfigPath(tmpDir);
    fs.writeFileSync(configPath, 'approval_policy = "never"\n', 'utf8');
    setMode(tmpDir, 'elegy-routed');
    fs.writeFileSync(configPath, appendManagedBlock('approval_policy = "on-request"\n').nextText, 'utf8');

    const result = hardReset(tmpDir);
    const restored = fs.readFileSync(configPath, 'utf8');

    assert.equal(result.activeMode, 'native');
    assert.equal(restored, 'approval_policy = "never"\n');
    assert.equal(fs.existsSync(resolveBackupPath(tmpDir)), false);
  });

  it('getStatus reports native mode when no managed block is present', () => {
    const configPath = resolveConfigPath(tmpDir);
    fs.writeFileSync(configPath, 'model = "gpt-5.4"\n', 'utf8');
    const status = getStatus(tmpDir);
    assert.equal(status.activeMode, 'native');
    assert.equal(status.providerId, 'openai');
  });

  it('activation replaces existing root model keys instead of duplicating them', () => {
    const configPath = resolveConfigPath(tmpDir);
    fs.writeFileSync(configPath, 'model = "gpt-5.4"\nmodel_provider = "openai"\n\n[profiles.demo]\nmodel = "gpt-5.4-mini"\n', 'utf8');

    setMode(tmpDir, 'elegy-routed');
    const config = fs.readFileSync(configPath, 'utf8');
    const rootSection = config.split('\n[profiles.demo]')[0] || config;

    assert.equal((rootSection.match(/^model\s*=/gm) || []).length, 1);
    assert.equal((rootSection.match(/^model_provider\s*=/gm) || []).length, 1);
    assert.ok(config.includes('[profiles.demo]'));
  });

  it('soft reset restores previous root model keys', () => {
    const configPath = resolveConfigPath(tmpDir);
    fs.writeFileSync(configPath, 'model = "gpt-5.4"\nmodel_provider = "openai"\n', 'utf8');

    setMode(tmpDir, 'elegy-routed');
    setMode(tmpDir, 'native');
    const config = fs.readFileSync(configPath, 'utf8');

    assert.ok(config.includes('model = "gpt-5.4"'));
    assert.ok(config.includes('model_provider = "openai"'));
    assert.ok(!config.includes('instruction_engine_elegy'));
  });

  it('hard reset removes config.toml when Elegy created it from scratch', () => {
    setMode(tmpDir, 'elegy-routed');
    hardReset(tmpDir);

    assert.equal(fs.existsSync(resolveConfigPath(tmpDir)), false);
  });

  it('setMode rejects changes that would produce invalid TOML', () => {
    const configPath = resolveConfigPath(tmpDir);
    fs.writeFileSync(configPath, 'approval_policy = "on-request"\n[profiles.demo\nmodel = "gpt-5.4"\n', 'utf8');

    assert.throws(
      () => setMode(tmpDir, 'elegy-routed'),
      /Codex config TOML validation failed after enabling Elegy Routed/,
    );
  });

  it('hard reset rejects invalid backup TOML before writing it back', () => {
    const configPath = resolveConfigPath(tmpDir);
    fs.writeFileSync(configPath, 'approval_policy = "never"\n', 'utf8');
    setMode(tmpDir, 'elegy-routed');
    fs.writeFileSync(resolveBackupPath(tmpDir), 'approval_policy = "never"\n[profiles.demo\n', 'utf8');

    assert.throws(
      () => hardReset(tmpDir),
      /Codex config TOML validation failed before hard restore/,
    );
    assert.ok(fs.existsSync(resolveBackupPath(tmpDir)));
    assert.ok(fs.existsSync(configPath));
  });
});
