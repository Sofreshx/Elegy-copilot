'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  PROVIDER_MODES,
  OPENCODE_GO_BASE_URL,
  DEEPSEEK_DIRECT_BASE_URL,
  getStatus,
  setMode,
  resetToVanilla,
  restoreFromBackup,
  saveDeepseekApiKey,
  readDeepseekKey,
  readSettings,
  _testing,
} = require('./claudeCodeConfig');

describe('claudeCodeConfig', () => {
  let tmpDir;
  let originalXdgDataHome;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-code-config-test-'));
    originalXdgDataHome = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = path.join(tmpDir, 'xdg-data');
    const nativeAuthDir = path.join(process.env.XDG_DATA_HOME, 'opencode');
    fs.mkdirSync(nativeAuthDir, { recursive: true });
    fs.writeFileSync(
      path.join(nativeAuthDir, 'auth.json'),
      JSON.stringify({
        deepseek: { key: 'native-deepseek-key' },
        'opencode-go': { key: 'native-opencode-go-key' },
      }),
      'utf8',
    );
  });

  afterEach(() => {
    if (originalXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('readSettings', () => {
    it('returns empty object when settings.json does not exist', () => {
      const settings = readSettings(tmpDir);
      assert.deepStrictEqual(settings, {});
    });

    it('returns parsed settings when settings.json exists', () => {
      const settingsPath = _testing.resolveSettingsPath(tmpDir);
      fs.writeFileSync(settingsPath, JSON.stringify({ env: { FOO: 'bar' } }), 'utf8');
      const settings = readSettings(tmpDir);
      assert.deepStrictEqual(settings, { env: { FOO: 'bar' } });
    });
  });

  describe('getStatus', () => {
    it('detects vanilla mode when no settings.json exists', () => {
      const status = getStatus(tmpDir);
      assert.equal(status.activeMode, 'vanilla');
      assert.equal(status.baseUrl, null);
      assert.equal(status.hasBackup, false);
      assert.equal(status.settingsExists, false);
    });

    it('detects vanilla mode when settings.json has no ANTHROPIC_BASE_URL', () => {
      const settingsPath = _testing.resolveSettingsPath(tmpDir);
      fs.writeFileSync(settingsPath, JSON.stringify({ env: {} }), 'utf8');
      const status = getStatus(tmpDir);
      assert.equal(status.activeMode, 'vanilla');
      assert.equal(status.baseUrl, null);
    });

    it('detects opencode-go mode', () => {
      const settingsPath = _testing.resolveSettingsPath(tmpDir);
      fs.writeFileSync(settingsPath, JSON.stringify({
        env: { ANTHROPIC_BASE_URL: OPENCODE_GO_BASE_URL, ANTHROPIC_API_KEY: 'test-key' },
      }), 'utf8');
      const status = getStatus(tmpDir);
      assert.equal(status.activeMode, 'opencode-go');
      assert.equal(status.baseUrl, OPENCODE_GO_BASE_URL);
    });

    it('detects deepseek-direct mode', () => {
      const settingsPath = _testing.resolveSettingsPath(tmpDir);
      fs.writeFileSync(settingsPath, JSON.stringify({
        env: { ANTHROPIC_BASE_URL: DEEPSEEK_DIRECT_BASE_URL, ANTHROPIC_API_KEY: 'ds-key' },
      }), 'utf8');
      const status = getStatus(tmpDir);
      assert.equal(status.activeMode, 'deepseek-direct');
      assert.equal(status.baseUrl, DEEPSEEK_DIRECT_BASE_URL);
    });

    it('detects custom mode for unknown base URL', () => {
      const settingsPath = _testing.resolveSettingsPath(tmpDir);
      fs.writeFileSync(settingsPath, JSON.stringify({
        env: { ANTHROPIC_BASE_URL: 'https://custom.example.com' },
      }), 'utf8');
      const status = getStatus(tmpDir);
      assert.equal(status.activeMode, 'custom');
      assert.equal(status.baseUrl, 'https://custom.example.com');
    });
  });

  describe('setMode', () => {
    it('setMode vanilla removes all provider env vars', () => {
      const settingsPath = _testing.resolveSettingsPath(tmpDir);
      fs.writeFileSync(settingsPath, JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: OPENCODE_GO_BASE_URL,
          ANTHROPIC_API_KEY: 'key',
          ANTHROPIC_MODEL: 'deepseek-v4-pro',
          ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro',
          ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
          CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4-flash',
          CLAUDE_CODE_EFFORT_LEVEL: 'max',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          USER_SETTING: 'keep-me',
        },
      }), 'utf8');

      const result = setMode(tmpDir, 'vanilla');
      assert.equal(result.activeMode, 'vanilla');
      assert.equal(result.baseUrl, null);

      const settings = readSettings(tmpDir);
      assert.equal(settings.env.ANTHROPIC_BASE_URL, undefined);
      assert.equal(settings.env.ANTHROPIC_API_KEY, undefined);
      assert.equal(settings.env.ANTHROPIC_MODEL, undefined);
      assert.equal(settings.env.USER_SETTING, 'keep-me');
    });

    it('setMode deepseek-direct writes correct env vars', () => {
      saveDeepseekApiKey(tmpDir, 'my-ds-key');
      const result = setMode(tmpDir, 'deepseek-direct');
      assert.equal(result.activeMode, 'deepseek-direct');
      assert.equal(result.baseUrl, DEEPSEEK_DIRECT_BASE_URL);

      const settings = readSettings(tmpDir);
      assert.equal(settings.env.ANTHROPIC_BASE_URL, DEEPSEEK_DIRECT_BASE_URL);
      assert.equal(settings.env.ANTHROPIC_API_KEY, 'my-ds-key');
      assert.equal(settings.env.ANTHROPIC_MODEL, 'deepseek-v4-pro');
      assert.equal(settings.env.CLAUDE_CODE_EFFORT_LEVEL, 'max');
    });

    it('setMode deepseek-direct uses native auth key as fallback when no explicit key provided', () => {
      const result = setMode(tmpDir, 'deepseek-direct');
      assert.equal(result.activeMode, 'deepseek-direct');
      assert.equal(readSettings(tmpDir).env.ANTHROPIC_API_KEY, 'native-deepseek-key');
    });

    it('setMode deepseek-direct uses explicit key over fallback', () => {
      saveDeepseekApiKey(tmpDir, 'explicit-key');
      const result = setMode(tmpDir, 'deepseek-direct', { apiKey: 'explicit-key' });
      assert.equal(result.activeMode, 'deepseek-direct');
      const settings = readSettings(tmpDir);
      assert.equal(settings.env.ANTHROPIC_API_KEY, 'explicit-key');
    });

    it('setMode opencode-go uses native auth key as fallback when no resolver provided', () => {
      const result = setMode(tmpDir, 'opencode-go');
      assert.equal(result.activeMode, 'opencode-go');
      assert.equal(readSettings(tmpDir).env.ANTHROPIC_API_KEY, 'native-opencode-go-key');
    });

    it('setMode opencode-go succeeds with key resolver', () => {
      const resolveKey = () => ({ value: 'ocg-key', source: 'keychain' });
      const result = setMode(tmpDir, 'opencode-go', { resolveOpenCodeGoApiKey: resolveKey });
      assert.equal(result.activeMode, 'opencode-go');
      assert.equal(result.baseUrl, OPENCODE_GO_BASE_URL);

      const settings = readSettings(tmpDir);
      assert.equal(settings.env.ANTHROPIC_BASE_URL, OPENCODE_GO_BASE_URL);
      assert.equal(settings.env.ANTHROPIC_API_KEY, 'ocg-key');
    });

    it('creates backup on first switch', () => {
      const settingsPath = _testing.resolveSettingsPath(tmpDir);
      fs.writeFileSync(settingsPath, JSON.stringify({ env: { EXISTING: 'value' } }), 'utf8');

      setMode(tmpDir, 'vanilla');

      const backupPath = _testing.resolveBackupPath(tmpDir);
      assert.ok(fs.existsSync(backupPath));
      const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      assert.equal(backup.env.EXISTING, 'value');
    });

    it('does not overwrite existing backup', () => {
      const settingsPath = _testing.resolveSettingsPath(tmpDir);
      fs.writeFileSync(settingsPath, JSON.stringify({ env: { V1: 'a' } }), 'utf8');
      setMode(tmpDir, 'vanilla');

      // Change settings and switch again
      fs.writeFileSync(settingsPath, JSON.stringify({ env: { V2: 'b' } }), 'utf8');
      setMode(tmpDir, 'vanilla');

      const backupPath = _testing.resolveBackupPath(tmpDir);
      const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      assert.equal(backup.env.V1, 'a');
      assert.equal(backup.env.V2, undefined);
    });
  });

  describe('resetToVanilla', () => {
    it('clears all provider env vars and returns vanilla status', () => {
      const settingsPath = _testing.resolveSettingsPath(tmpDir);
      fs.writeFileSync(settingsPath, JSON.stringify({
        env: { ANTHROPIC_BASE_URL: DEEPSEEK_DIRECT_BASE_URL, OTHER: 'keep' },
      }), 'utf8');

      const result = resetToVanilla(tmpDir);
      assert.equal(result.activeMode, 'vanilla');
      assert.equal(result.baseUrl, null);

      const settings = readSettings(tmpDir);
      assert.equal(settings.env.ANTHROPIC_BASE_URL, undefined);
      assert.equal(settings.env.OTHER, 'keep');
    });
  });

  describe('restoreFromBackup', () => {
    it('restores settings from backup', () => {
      const settingsPath = _testing.resolveSettingsPath(tmpDir);
      fs.writeFileSync(settingsPath, JSON.stringify({
        env: { ANTHROPIC_BASE_URL: DEEPSEEK_DIRECT_BASE_URL },
      }), 'utf8');
      setMode(tmpDir, 'vanilla');

      // Now modify settings again
      fs.writeFileSync(settingsPath, JSON.stringify({
        env: { ANTHROPIC_BASE_URL: 'https://something-else.com' },
      }), 'utf8');

      const result = restoreFromBackup(tmpDir);
      assert.equal(result.activeMode, 'deepseek-direct');
      assert.equal(result.baseUrl, DEEPSEEK_DIRECT_BASE_URL);
    });

    it('throws when no backup exists', () => {
      assert.throws(() => {
        restoreFromBackup(tmpDir);
      }, /No backup found/);
    });
  });

  describe('deepseek API key persistence', () => {
    it('saves and reads DeepSeek API key', () => {
      const result = saveDeepseekApiKey(tmpDir, '  my-secret-key  ');
      assert.equal(result.ok, true);

      const key = readDeepseekKey(tmpDir);
      assert.equal(key, 'my-secret-key');
    });

    it('throws on empty key', () => {
      assert.throws(() => {
        saveDeepseekApiKey(tmpDir, '');
      }, /API key is required/);
    });

    it('throws on whitespace-only key', () => {
      assert.throws(() => {
        saveDeepseekApiKey(tmpDir, '   ');
      }, /API key is required/);
    });

    it('returns null when no key saved', () => {
      const key = readDeepseekKey(tmpDir);
      assert.equal(key, null);
    });
  });

  describe('state tracking', () => {
    it('records lastAppliedAt on setMode', () => {
      const result = setMode(tmpDir, 'vanilla');
      assert.ok(result.lastAppliedAt);
    });

    it('records lastResetAt on resetToVanilla', () => {
      const result = resetToVanilla(tmpDir);
      assert.ok(result.lastResetAt);
    });
  });
});
