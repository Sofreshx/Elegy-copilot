'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  MANAGED_DEEPSEEK_BLOCK_START,
  getStatus,
  hardReset,
  resolveBackupPath,
  resolveConfigPath,
  resolveDeepseekCatalogPath,
  setMode,
  stripDeepseekManagedBlock,
  appendDeepseekManagedBlock,
  applyDeepseekSoftReset,
  getDeepseekStatus,
  saveDeepseekSettings,
  getBootstrapState,
  saveBootstrapState,
} = require('./codexConfig');
describe('codexConfig', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-config-test-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  describe('deepseek-bridge', () => {
    it('appendDeepseekManagedBlock adds a DeepSeek managed block without env_key', () => {
      const next = appendDeepseekManagedBlock('model = "gpt-5.4"\n', tmpDir);
      assert.ok(next.nextText.includes(MANAGED_DEEPSEEK_BLOCK_START));
      assert.ok(next.nextText.includes('model_provider = "instruction_engine_deepseek"'));
      assert.ok(next.nextText.includes('deepseek-v4-pro'));
      // Should NOT include env_key (rely on Moon Bridge config)
      assert.ok(!next.nextText.includes('env_key'));
    });
    it('stripDeepseekManagedBlock removes only the deepseek block', () => {
      const text = appendDeepseekManagedBlock('approval_policy = "on-request"\n', tmpDir).nextText;
      const stripped = stripDeepseekManagedBlock(text);
      assert.ok(!stripped.includes(MANAGED_DEEPSEEK_BLOCK_START));
      assert.ok(stripped.includes('approval_policy = "on-request"'));
    });
    it('applyDeepseekSoftReset removes the deepseek block and preserves unrelated text', () => {
      const text = appendDeepseekManagedBlock('approval_policy = "on-request"\n', tmpDir).nextText;
      const reset = applyDeepseekSoftReset(text);
      assert.equal(reset, 'approval_policy = "on-request"\n');
    });
    it('setMode deepseek-bridge activates DeepSeek and writes catalog', () => {
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, 'approval_policy = "on-request"\n', 'utf8');
      const result = setMode(tmpDir, 'deepseek-bridge');
      const config = fs.readFileSync(configPath, 'utf8');
      assert.equal(result.activeMode, 'deepseek-bridge');
      assert.ok(config.includes('model_provider = "instruction_engine_deepseek"'));
      assert.ok(config.includes('deepseek-v4-pro'));
      assert.ok(fs.existsSync(resolveBackupPath(tmpDir)));
      const catalogPath = resolveDeepseekCatalogPath(tmpDir);
      assert.ok(fs.existsSync(catalogPath));
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      assert.ok(Array.isArray(catalog.models));
      assert.equal(catalog.models.length, 2);
      const pro = catalog.models.find((m) => m.slug === 'deepseek-v4-pro');
      const flash = catalog.models.find((m) => m.slug === 'deepseek-v4-flash');
      assert.ok(pro);
      assert.equal(pro.default_reasoning_level, 'high');
      assert.equal(pro.context_window, 262144);
      assert.ok(pro.supported_reasoning_levels);
      assert.ok(Array.isArray(pro.supported_reasoning_levels));
      assert.ok(flash);
      assert.equal(flash.default_reasoning_level, 'medium');
    });
    it('setMode native deactivates DeepSeek and restores previous state', () => {
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, 'model = "gpt-5.4"\nmodel_provider = "openai"\n', 'utf8');
      setMode(tmpDir, 'deepseek-bridge');
      setMode(tmpDir, 'native');
      const config = fs.readFileSync(configPath, 'utf8');
      assert.ok(config.includes('model = "gpt-5.4"'));
      assert.ok(config.includes('model_provider = "openai"'));
      assert.ok(!config.includes('instruction_engine_deepseek'));
      assert.ok(!config.includes(MANAGED_DEEPSEEK_BLOCK_START));
    });
    it('getStatus reports deepseek-bridge mode when deepseek managed block is present', () => {
      setMode(tmpDir, 'deepseek-bridge');
      const status = getStatus(tmpDir);
      assert.equal(status.activeMode, 'deepseek-bridge');
      assert.equal(status.providerId, 'instruction_engine_deepseek');
      assert.ok(status.deepseek);
    });
    it('getStatus reports native mode when no managed block is present', () => {
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, 'model = "gpt-5.4"\n', 'utf8');
      const status = getStatus(tmpDir);
      assert.equal(status.activeMode, 'native');
      assert.equal(status.providerId, 'openai');
    });
    it('getStatus reports hasLegacyBlock when IE managed block is present', () => {
      const configPath = resolveConfigPath(tmpDir);
      const legacyContent = '# BEGIN instruction-engine managed codex defaults\nmodel_provider = "old-provider"\n# END instruction-engine managed codex defaults\nmodel = "gpt-5.4"\n';
      fs.writeFileSync(configPath, legacyContent, 'utf8');
      const status = getStatus(tmpDir);
      assert.equal(status.activeMode, 'native');
      assert.equal(status.hasLegacyBlock, true);
    });
    it('getStatus reports hasLegacyBlock when old elegy managed block is present', () => {
      const configPath = resolveConfigPath(tmpDir);
      const oldBlock = '# BEGIN elegy managed codex provider\n[model_providers.instruction_engine_elegy]\nname = "Elegy Routed"\n# END elegy managed codex provider\nmodel = "gpt-5.4"\n';
      fs.writeFileSync(configPath, oldBlock, 'utf8');
      const status = getStatus(tmpDir);
      assert.equal(status.activeMode, 'native');
      assert.equal(status.hasLegacyBlock, true);
    });
    it('setMode deepseek-bridge strips legacy IE block before activating', () => {
      const configPath = resolveConfigPath(tmpDir);
      const legacyContent = '# BEGIN instruction-engine managed codex defaults\nmodel_provider = "old-provider"\n# END instruction-engine managed codex defaults\nmodel = "gpt-5.4"\n';
      fs.writeFileSync(configPath, legacyContent, 'utf8');
      setMode(tmpDir, 'deepseek-bridge');
      const config = fs.readFileSync(configPath, 'utf8');
      assert.ok(config.includes(MANAGED_DEEPSEEK_BLOCK_START));
      assert.ok(!config.includes('instruction-engine managed codex defaults'));
      assert.ok(config.includes('model = "deepseek-v4-pro"'));
      assert.ok(config.includes('model_catalog_json'));
    });
    it('setMode native strips legacy IE block', () => {
      const configPath = resolveConfigPath(tmpDir);
      const legacyContent = '# BEGIN instruction-engine managed codex defaults\nmodel_provider = "old-provider"\n# END instruction-engine managed codex defaults\nmodel = "gpt-5.4"\n';
      fs.writeFileSync(configPath, legacyContent, 'utf8');
      setMode(tmpDir, 'native');
      const config = fs.readFileSync(configPath, 'utf8');
      assert.ok(!config.includes('instruction-engine managed codex defaults'));
      assert.ok(config.includes('model = "gpt-5.4"'));
    });
    it('hardReset strips legacy IE blocks from backup before restoring', () => {
      const configPath = resolveConfigPath(tmpDir);
      const originalContent = '# BEGIN instruction-engine managed codex defaults\nmodel_provider = "old-provider"\n# END instruction-engine managed codex defaults\nmodel = "gpt-5.4"\n';
      fs.writeFileSync(configPath, originalContent, 'utf8');
      setMode(tmpDir, 'deepseek-bridge');
      hardReset(tmpDir);
      const restored = fs.readFileSync(configPath, 'utf8');
      assert.ok(!restored.includes('instruction-engine managed codex defaults'));
      assert.ok(!restored.includes('instruction_engine_deepseek'));
      assert.ok(restored.includes('model = "gpt-5.4"'));
    });
    it('deepseek activation does not duplicate root keys', () => {
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, 'model = "gpt-5.4"\nmodel_provider = "openai"\n', 'utf8');
      setMode(tmpDir, 'deepseek-bridge');
      const config = fs.readFileSync(configPath, 'utf8');
      assert.equal((config.match(/^model\s*=/gm) || []).length, 1);
      assert.equal((config.match(/^model_provider\s*=/gm) || []).length, 1);
      assert.equal((config.match(/^model_catalog_json\s*=/gm) || []).length, 1);
    });
    it('soft reset from deepseek restores previous root keys', () => {
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, 'model = "gpt-5.4"\nmodel_provider = "openai"\nmodel_catalog_json = "/old/catalog.json"\n', 'utf8');
      setMode(tmpDir, 'deepseek-bridge');
      setMode(tmpDir, 'native');
      const config = fs.readFileSync(configPath, 'utf8');
      assert.ok(config.includes('model = "gpt-5.4"'));
      assert.ok(config.includes('model_provider = "openai"'));
      assert.ok(config.includes('/old/catalog.json'));
    });
    it('setMode rejects invalid mode strings', () => {
      assert.throws(
        () => setMode(tmpDir, 'invalid-mode'),
        /mode must be/,
      );
    });
    it('setMode rejects elegy-routed mode string', () => {
      assert.throws(
        () => setMode(tmpDir, 'elegy-routed'),
        /mode must be/,
      );
    });
    it('saveDeepseekSettings persists bridgePath and keyConfigured', () => {
      saveDeepseekSettings(tmpDir, { bridgePath: '/path/to/bridge.exe', keyConfigured: true });
      const status = getDeepseekStatus(tmpDir);
      assert.equal(status.bridgePath, '/path/to/bridge.exe');
      assert.equal(status.keyConfigured, true);
    });
    it('hardReset removes deepseek state and catalog', () => {
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, 'approval_policy = "never"\n', 'utf8');
      setMode(tmpDir, 'deepseek-bridge');
      saveDeepseekSettings(tmpDir, { bridgePath: '/path/to/bridge.exe', keyConfigured: true });
      hardReset(tmpDir);
      const status = getStatus(tmpDir);
      assert.equal(status.activeMode, 'native');
      assert.equal(status.deepseek.bridgePath, null);
      assert.equal(status.deepseek.keyConfigured, false);
    });
    it('hardReset restores the backup snapshot and removes state', () => {
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, 'approval_policy = "never"\n', 'utf8');
      setMode(tmpDir, 'deepseek-bridge');
      fs.writeFileSync(configPath, appendDeepseekManagedBlock('approval_policy = "on-request"\n', tmpDir).nextText, 'utf8');
      const result = hardReset(tmpDir);
      const restored = fs.readFileSync(configPath, 'utf8');
      assert.equal(result.activeMode, 'native');
      assert.equal(restored, 'approval_policy = "never"\n');
      assert.equal(fs.existsSync(resolveBackupPath(tmpDir)), false);
    });
    it('hard reset removes config.toml when Elegy created it from scratch', () => {
      setMode(tmpDir, 'deepseek-bridge');
      hardReset(tmpDir);
      assert.equal(fs.existsSync(resolveConfigPath(tmpDir)), false);
    });
    it('setMode rejects changes that would produce invalid TOML', () => {
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, 'approval_policy = "on-request"\n[profiles.demo\nmodel = "gpt-5.4"\n', 'utf8');
      assert.throws(
        () => setMode(tmpDir, 'deepseek-bridge'),
        /Codex config TOML validation failed after enabling DeepSeek V4/,
      );
    });
    it('hard reset rejects invalid backup TOML before writing it back', () => {
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, 'approval_policy = "never"\n', 'utf8');
      setMode(tmpDir, 'deepseek-bridge');
      fs.writeFileSync(resolveBackupPath(tmpDir), 'approval_policy = "never"\n[profiles.demo\n', 'utf8');
      assert.throws(
        () => hardReset(tmpDir),
        /Codex config TOML validation failed before hard restore/,
      );
      assert.ok(fs.existsSync(resolveBackupPath(tmpDir)));
      assert.ok(fs.existsSync(configPath));
    });
    it('saveBootstrapState persists bootstrap fields and getBootstrapState reads them back', () => {
      const bootstrap = {
        installRoot: 'C:\\Users\\test\\.elegy\\managed-cli\\moon-bridge',
        sourceUrl: 'https://github.com/ZhiYi-R/moon-bridge.git',
        binaryPath: 'C:\\Users\\test\\.elegy\\managed-cli\\moon-bridge\\bin\\moon-bridge.exe',
        configPath: 'C:\\Users\\test\\.elegy\\managed-cli\\moon-bridge\\config.yml',
        gitAvailable: true,
        goAvailable: true,
        installed: false,
        built: false,
        lastBootstrapAt: null,
        lastError: null,
      };
      saveBootstrapState(tmpDir, bootstrap);
      const state = getBootstrapState(tmpDir);
      assert.ok(state);
      assert.equal(state.installRoot, bootstrap.installRoot);
      assert.equal(state.sourceUrl, bootstrap.sourceUrl);
      assert.equal(state.binaryPath, bootstrap.binaryPath);
      assert.equal(state.gitAvailable, true);
      assert.equal(state.goAvailable, true);
      assert.equal(state.installed, false);
      assert.equal(state.built, false);
    });
    it('getBootstrapState returns null when no bootstrap state has been saved', () => {
      const state = getBootstrapState(tmpDir);
      assert.equal(state, null);
    });
    it('saveBootstrapState merges with existing bootstrap fields', () => {
      saveBootstrapState(tmpDir, {
        installRoot: '/initial/root',
        gitAvailable: false,
        built: false,
      });
      saveBootstrapState(tmpDir, {
        installed: true,
        lastBootstrapAt: '2025-06-01T00:00:00.000Z',
      });
      const state = getBootstrapState(tmpDir);
      assert.equal(state.installRoot, '/initial/root');
      assert.equal(state.gitAvailable, false);
      assert.equal(state.built, false);
      assert.equal(state.installed, true);
      assert.equal(state.lastBootstrapAt, '2025-06-01T00:00:00.000Z');
    });
    it('getDeepseekStatus includes bootstrap when present', () => {
      saveBootstrapState(tmpDir, {
        installRoot: '/root',
        gitAvailable: true,
        goAvailable: false,
        installed: true,
        built: false,
      });
      const status = getDeepseekStatus(tmpDir);
      assert.ok(status.bootstrap);
      assert.equal(status.bootstrap.installRoot, '/root');
      assert.equal(status.bootstrap.goAvailable, false);
    });
    it('deepseek managed block does not include env_key', () => {
      const next = appendDeepseekManagedBlock('model = "gpt-5.4"\n', tmpDir);
      const lines = next.nextText.split('\n');
      const envKeyLines = lines.filter((l) => l.includes('env_key'));
      assert.equal(envKeyLines.length, 0, 'deepseek managed block should not include env_key');
    });
    it('gateway object does not include envKey in status response', () => {
      setMode(tmpDir, 'deepseek-bridge');
      const status = getStatus(tmpDir);
      assert.ok(status.gateway);
      assert.ok(!('envKey' in status.gateway));
    });
  });
});
