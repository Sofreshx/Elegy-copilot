'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  MANAGED_BLOCK_START,
  MANAGED_DEEPSEEK_BLOCK_START,
  appendManagedBlock,
  applySoftReset,
  getStatus,
  hardReset,
  resolveBackupPath,
  resolveConfigPath,
  resolveDeepseekCatalogPath,
  setMode,
  stripManagedBlock,
  stripDeepseekManagedBlock,
  appendDeepseekManagedBlock,
  applyDeepseekSoftReset,
  getDeepseekStatus,
  saveDeepseekSettings,
  getBootstrapState,
  saveBootstrapState,
  IE_MANAGED_BLOCK_START,
  IE_MANAGED_BLOCK_END,
  hasInstructionEngineManagedBlock,
  stripInstructionEngineManagedBlock,
} = require('./codexConfig');

describe('codexConfig', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('elegy-routed', () => {
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

    it('getStatus detects instruction-engine managed block as elegy-routed', () => {
      const configPath = resolveConfigPath(tmpDir);
      const block = [
        IE_MANAGED_BLOCK_START,
        'model = "mimo-v2-pro"',
        'model_provider = "opencode-go"',
        '',
        '[model_providers.opencode-go]',
        'name = "OpenCode Go"',
        'base_url = "https://opencode.ai/zen/go/v1"',
        IE_MANAGED_BLOCK_END,
      ].join('\n');
      fs.writeFileSync(configPath, `approval_policy = "on-request"\n\n${block}\n`, 'utf8');
      const status = getStatus(tmpDir);
      assert.equal(status.activeMode, 'elegy-routed');
      assert.equal(status.hasManagedBlock, true);
    });

    it('stripInstructionEngineManagedBlock removes only the IE managed block', () => {
      const text = [
        'personality = "friendly"',
        '',
        IE_MANAGED_BLOCK_START,
        'model = "mimo-v2-pro"',
        '[model_providers.opencode-go]',
        IE_MANAGED_BLOCK_END,
      ].join('\n');
      const stripped = stripInstructionEngineManagedBlock(text);
      assert.ok(!stripped.includes(IE_MANAGED_BLOCK_START));
      assert.ok(stripped.includes('personality'));
      assert.ok(!stripped.includes('[model_providers.opencode-go]'));
    });

    it('setMode native strips instruction-engine managed blocks and reports native', () => {
      const configPath = resolveConfigPath(tmpDir);
      // Simulate a config created by the install-time patcher (IE markers only, no Elegy markers)
      const block = [
        IE_MANAGED_BLOCK_START,
        'model = "mimo-v2-pro"',
        'model_provider = "opencode-go"',
        '',
        '[model_providers.opencode-go]',
        'name = "OpenCode Go"',
        'base_url = "https://opencode.ai/zen/go/v1"',
        IE_MANAGED_BLOCK_END,
      ].join('\n');
      fs.writeFileSync(configPath, `approval_policy = "on-request"\n\n${block}\n`, 'utf8');

      // Verify initial state: IE block is detected as elegy-routed
      const initialStatus = getStatus(tmpDir);
      assert.equal(initialStatus.activeMode, 'elegy-routed');

      // Switch to native
      const result = setMode(tmpDir, 'native');
      const config = fs.readFileSync(configPath, 'utf8');

      assert.equal(result.activeMode, 'native');
      assert.ok(!config.includes(IE_MANAGED_BLOCK_START), 'IE managed block must be stripped');
      assert.ok(!config.includes('[model_providers.opencode-go]'), 'IE managed provider table must be stripped');
      assert.ok(config.includes('approval_policy = "on-request"'), 'user settings preserved');
    });

    it('setMode elegy-routed strips instruction-engine managed block', () => {
      const configPath = resolveConfigPath(tmpDir);
      const block = [
        IE_MANAGED_BLOCK_START,
        'model = "mimo-v2-pro"',
        'model_provider = "opencode-go"',
        IE_MANAGED_BLOCK_END,
      ].join('\n');
      fs.writeFileSync(configPath, `approval_policy = "on-request"\n\n${block}\n`, 'utf8');

      setMode(tmpDir, 'elegy-routed');
      const config = fs.readFileSync(configPath, 'utf8');

      assert.ok(!config.includes(IE_MANAGED_BLOCK_START));
      assert.ok(config.includes(MANAGED_BLOCK_START));
      assert.ok(config.includes('instruction_engine_elegy'));
    });
  });

  describe('deepseek-bridge', () => {
    it('appendDeepseekManagedBlock adds a DeepSeek managed block', () => {
      const next = appendDeepseekManagedBlock('model = "gpt-5.4"\n', tmpDir);
      assert.ok(next.nextText.includes(MANAGED_DEEPSEEK_BLOCK_START));
      assert.ok(next.nextText.includes('model_provider = "instruction_engine_deepseek"'));
      assert.ok(next.nextText.includes('deepseek-v4-pro'));
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

    it('switching from deepseek to elegy-routed strips deepseek block', () => {
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, 'model = "gpt-5.4"\n', 'utf8');
      setMode(tmpDir, 'deepseek-bridge');
      const deepseekConfig = fs.readFileSync(configPath, 'utf8');
      assert.ok(deepseekConfig.includes('model_catalog_json'));
      setMode(tmpDir, 'elegy-routed');
      const config = fs.readFileSync(configPath, 'utf8');

      assert.ok(config.includes(MANAGED_BLOCK_START));
      assert.ok(!config.includes(MANAGED_DEEPSEEK_BLOCK_START));
      assert.ok(!config.includes('model_catalog_json'));
    });

    it('switching from elegy to deepseek-bridge strips elegy block', () => {
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, 'model = "gpt-5.4"\n', 'utf8');
      setMode(tmpDir, 'elegy-routed');
      setMode(tmpDir, 'deepseek-bridge');
      const config = fs.readFileSync(configPath, 'utf8');

      assert.ok(config.includes(MANAGED_DEEPSEEK_BLOCK_START));
      assert.ok(!config.includes(MANAGED_BLOCK_START));
    });

    it('getStatus reports deepseek-bridge mode when deepseek managed block is present', () => {
      setMode(tmpDir, 'deepseek-bridge');
      const status = getStatus(tmpDir);
      assert.equal(status.activeMode, 'deepseek-bridge');
      assert.equal(status.providerId, 'instruction_engine_deepseek');
      assert.ok(status.deepseek);
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

    it('saveBootstrapState persists bootstrap fields and getBootstrapState reads them back', () => {
      const bootstrap = {
        installRoot: 'C:\\Users\\test\\.copilot\\managed-cli\\moon-bridge',
        sourceUrl: 'https://github.com/ZhiYi-R/moon-bridge.git',
        binaryPath: 'C:\\Users\\test\\.copilot\\managed-cli\\moon-bridge\\bin\\moon-bridge.exe',
        configPath: 'C:\\Users\\test\\.copilot\\managed-cli\\moon-bridge\\config.yaml',
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

    it('setMode elegy-routed preserves unrelated config tables when migrating from IE block', () => {
      const configPath = resolveConfigPath(tmpDir);
      const configText = [
        'approval_policy = "on-request"',
        '',
        '[windows]',
        'shell = "pwsh"',
        '',
        IE_MANAGED_BLOCK_START,
        'model = "mimo-v2-pro"',
        'model_provider = "opencode-go"',
        IE_MANAGED_BLOCK_END,
      ].join('\n');
      fs.writeFileSync(configPath, configText, 'utf8');

      setMode(tmpDir, 'elegy-routed');
      const config = fs.readFileSync(configPath, 'utf8');

      assert.ok(config.includes('[windows]'));
      assert.ok(config.includes('shell = "pwsh"'));
      assert.ok(!config.includes(IE_MANAGED_BLOCK_START));
      assert.ok(config.includes(MANAGED_BLOCK_START));
      // Root model_provider must appear before [windows]
      const elegyProviderIndex = config.indexOf('model_provider = "instruction_engine_elegy"');
      const windowsTableIndex = config.indexOf('[windows]');
      assert.ok(elegyProviderIndex < windowsTableIndex, 'root model_provider must appear before [windows] table');
    });
  });
});
