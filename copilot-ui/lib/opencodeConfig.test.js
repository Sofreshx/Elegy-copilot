'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  KNOWN_DEFAULT_EXPLORE_MODEL,
  KNOWN_DEFAULT_SCOUT_MODEL,
  resolveConfigPath,
  resolveStatePath,
  readConfig,
  parseJsonc,
  getAgentModels,
  listAvailableModels,
  getStatus,
  setAgentModels,
  resetConfig,
  applyWorktreePermissionProfile,
  getWorktreePermissionProfileStatus,
  resolveWorktreeBase,
  buildWorktreePermissionProfile,
  WORKTREE_PERMISSION_PROFILE_MARKER,
  normalizeProfile,
  readProfileCatalog,
  setAgentRoleModels,
  getActiveProfileId,
  setActiveProfileId,
  applyProfile,
} = require('./opencodeConfig');

describe('opencodeConfig', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('parseJsonc', () => {
    it('parses plain JSON', () => {
      const result = parseJsonc('{"a": 1}');
      assert.deepStrictEqual(result, { a: 1 });
    });

    it('strips line comments', () => {
      const result = parseJsonc('{"a": 1 // comment\n}');
      assert.deepStrictEqual(result, { a: 1 });
    });

    it('strips block comments', () => {
      const result = parseJsonc('{"a": /* comment */ 1}');
      assert.deepStrictEqual(result, { a: 1 });
    });

    it('removes trailing commas', () => {
      const result = parseJsonc('{"a": 1, "b": 2,}');
      assert.deepStrictEqual(result, { a: 1, b: 2 });
    });

    it('handles JSONC with comments and trailing commas', () => {
      const input = `{
        // This is a comment
        "lsp": true,
        "agent": {
          "explore": {
            "model": "deepseek/deepseek-v4-flash"
          },
        },
      }`;
      const result = parseJsonc(input);
      assert.deepStrictEqual(result, {
        lsp: true,
        agent: {
          explore: {
            model: 'deepseek/deepseek-v4-flash',
          },
        },
      });
    });
  });

  describe('readConfig', () => {
    it('returns empty object when file does not exist', () => {
      const config = readConfig(tmpDir);
      assert.deepStrictEqual(config, {});
    });

    it('returns empty object for invalid JSON', () => {
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, 'not valid json{{{', 'utf8');
      const config = readConfig(tmpDir);
      assert.deepStrictEqual(config, {});
    });

    it('reads valid JSONC config', () => {
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, '{"lsp": true, "agent": {"explore": {"model": "test/model"}}}', 'utf8');
      const config = readConfig(tmpDir);
      assert.deepStrictEqual(config, { lsp: true, agent: { explore: { model: 'test/model' } } });
    });
  });

  describe('getAgentModels', () => {
    it('returns null for missing agent config', () => {
      const models = getAgentModels({});
      assert.equal(models.explore, null);
      assert.equal(models.scout, null);
    });

    it('returns models when configured', () => {
      const config = {
        agent: {
          explore: { model: 'test/explore' },
          scout: { model: 'test/scout' },
        },
      };
      const models = getAgentModels(config);
      assert.equal(models.explore, 'test/explore');
      assert.equal(models.scout, 'test/scout');
    });

    it('handles partial agent config', () => {
      const config = {
        agent: {
          explore: { model: 'test/explore' },
        },
      };
      const models = getAgentModels(config);
      assert.equal(models.explore, 'test/explore');
      assert.equal(models.scout, null);
    });
  });

  describe('listAvailableModels', () => {
    it('includes known defaults', () => {
      const models = listAvailableModels({});
      assert.ok(models.includes(KNOWN_DEFAULT_EXPLORE_MODEL));
      assert.ok(models.includes(KNOWN_DEFAULT_SCOUT_MODEL));
    });

    it('includes models from provider config', () => {
      const config = {
        provider: {
          deepseek: {
            models: {
              'deepseek-chat': { id: 'deepseek-chat' },
              'deepseek-reasoner': { id: 'deepseek-reasoner' },
            },
          },
        },
      };
      const models = listAvailableModels(config);
      assert.ok(models.includes('deepseek/deepseek-chat'));
      assert.ok(models.includes('deepseek/deepseek-reasoner'));
    });

    it('returns sorted unique list', () => {
      const config = {
        provider: {
          zzz: { models: { 'last-model': {} } },
          aaa: { models: { 'first-model': {} } },
        },
      };
      const models = listAvailableModels(config);
      assert.deepStrictEqual(models, [...models].sort());
    });
  });

  describe('getStatus', () => {
    it('returns defaults when no config exists', () => {
      const status = getStatus(tmpDir);
      assert.equal(status.exploreModel, KNOWN_DEFAULT_EXPLORE_MODEL);
      assert.equal(status.scoutModel, KNOWN_DEFAULT_SCOUT_MODEL);
      assert.equal(status.isCustom, false);
      assert.ok(Array.isArray(status.availableModels));
    });

    it('returns custom models when configured', () => {
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, JSON.stringify({
        agent: {
          explore: { model: 'custom/explore' },
          scout: { model: 'custom/scout' },
        },
      }), 'utf8');

      const status = getStatus(tmpDir);
      assert.equal(status.exploreModel, 'custom/explore');
      assert.equal(status.scoutModel, 'custom/scout');
      assert.equal(status.isCustom, true);
    });
  });

  describe('setAgentModels', () => {
    it('creates config file if it does not exist', () => {
      const result = setAgentModels(tmpDir, 'new/explore', 'new/scout');
      assert.equal(result.exploreModel, 'new/explore');
      assert.equal(result.scoutModel, 'new/scout');
      assert.equal(result.isCustom, true);
      assert.ok(fs.existsSync(resolveConfigPath(tmpDir)));
    });

    it('preserves existing config fields', () => {
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, JSON.stringify({ lsp: true }), 'utf8');

      setAgentModels(tmpDir, 'new/explore', 'new/scout');
      const config = readConfig(tmpDir);
      assert.equal(config.lsp, true);
      assert.equal(config.agent.explore.model, 'new/explore');
    });

    it('updates only explore model when scout is null', () => {
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, JSON.stringify({
        agent: { scout: { model: 'keep/scout' } },
      }), 'utf8');

      setAgentModels(tmpDir, 'new/explore', null);
      const config = readConfig(tmpDir);
      assert.equal(config.agent.explore.model, 'new/explore');
      assert.equal(config.agent.scout.model, 'keep/scout');
    });

    it('writes state file with timestamp', () => {
      setAgentModels(tmpDir, 'new/explore', 'new/scout');
      const statePath = resolveStatePath(tmpDir);
      assert.ok(fs.existsSync(statePath));
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      assert.ok(typeof state.lastAppliedAt === 'string');
    });
  });

  describe('resetConfig', () => {
    it('removes agent model overrides', () => {
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, JSON.stringify({
        lsp: true,
        agent: {
          explore: { model: 'custom/explore' },
          scout: { model: 'custom/scout' },
        },
      }), 'utf8');

      const result = resetConfig(tmpDir);
      assert.equal(result.exploreModel, KNOWN_DEFAULT_EXPLORE_MODEL);
      assert.equal(result.scoutModel, KNOWN_DEFAULT_SCOUT_MODEL);
      assert.equal(result.isCustom, false);

      const config = readConfig(tmpDir);
      assert.equal(config.lsp, true);
      assert.ok(!config.agent);
    });

    it('preserves other agent settings when removing models', () => {
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, JSON.stringify({
        agent: {
          explore: { model: 'custom/explore', temperature: 0.5 },
          build: { model: 'some/build' },
        },
      }), 'utf8');

      resetConfig(tmpDir);
      const config = readConfig(tmpDir);
      assert.equal(config.agent.explore.temperature, 0.5);
      assert.ok(!config.agent.explore.model);
      assert.equal(config.agent.build.model, 'some/build');
    });

    it('removes state file', () => {
      setAgentModels(tmpDir, 'new/explore', 'new/scout');
      assert.ok(fs.existsSync(resolveStatePath(tmpDir)));
      resetConfig(tmpDir);
      assert.ok(!fs.existsSync(resolveStatePath(tmpDir)));
    });
  });

  describe('worktree permission profile', () => {
    const previousBase = process.env.OPENCODE_WORKTREE_BASE;
    afterEach(() => {
      if (previousBase === undefined) {
        delete process.env.OPENCODE_WORKTREE_BASE;
      } else {
        process.env.OPENCODE_WORKTREE_BASE = previousBase;
      }
    });

    it('resolves the worktree base from explicit value over env and default', () => {
      const explicit = path.resolve(path.join(tmpDir, 'explicit-base'));
      const fromExplicit = resolveWorktreeBase(explicit);
      assert.equal(fromExplicit, path.resolve(explicit));

      process.env.OPENCODE_WORKTREE_BASE = path.join(tmpDir, 'env-base');
      const fromEnv = resolveWorktreeBase('');
      assert.equal(fromEnv, path.resolve(path.join(tmpDir, 'env-base')));

      delete process.env.OPENCODE_WORKTREE_BASE;
      const fromDefault = resolveWorktreeBase('');
      assert.equal(fromDefault, path.resolve(path.join(os.homedir(), '.local', 'share', 'opencode', 'worktree')));
    });

    it('builds a profile with flat allow-only permission keys', () => {
      const base = path.resolve(path.join(tmpDir, 'profile-base'));
      const profile = buildWorktreePermissionProfile(base);
      assert.equal(profile.permission.external_directory, 'allow');
      assert.equal(profile.permission.bash, 'allow');
      assert.equal(profile.marker.version, 1);
      assert.equal(profile.marker.marker, WORKTREE_PERMISSION_PROFILE_MARKER);
      assert.equal(profile.marker.worktreeBase, base);
    });

    it('applies the profile and writes flat permission keys', () => {
      const worktreeBase = path.resolve(path.join(tmpDir, 'wt-base'));
      const result = applyWorktreePermissionProfile(tmpDir, { worktreeBase });
      assert.equal(result.changed, true);
      assert.equal(result.profile.permission.external_directory, 'allow');
      assert.equal(result.profile.permission.bash, 'allow');

      const config = readConfig(tmpDir);
      assert.ok(config.permission);
      assert.equal(config.permission.external_directory, 'allow');
      assert.equal(config.permission.bash, 'allow');
      // Old nested format must not be present
      assert.ok(typeof config.permission.external_directory !== 'object');
      assert.ok(typeof config.permission.bash !== 'object');
    });

    it('preserves existing user permissions and other config fields', () => {
      const worktreeBase = path.resolve(path.join(tmpDir, 'wt-base'));
      const configPath = resolveConfigPath(tmpDir);
      fs.writeFileSync(configPath, JSON.stringify({
        lsp: true,
        permission: {
          edit: 'deny',
          external_directory: 'deny',
        },
        agent: { explore: { temperature: 0.4 } },
      }), 'utf8');

      applyWorktreePermissionProfile(tmpDir, { worktreeBase });

      const config = readConfig(tmpDir);
      assert.equal(config.lsp, true);
      assert.equal(config.agent.explore.temperature, 0.4);
      assert.equal(config.permission.edit, 'deny');
      // Flat values are overwritten to 'allow' by the profile
      assert.equal(config.permission.external_directory, 'allow');
      assert.equal(config.permission.bash, 'allow');
    });

    it('re-running is idempotent and reports no changes', () => {
      const worktreeBase = path.resolve(path.join(tmpDir, 'wt-base'));
      const first = applyWorktreePermissionProfile(tmpDir, { worktreeBase });
      assert.equal(first.changed, true);
      const second = applyWorktreePermissionProfile(tmpDir, { worktreeBase });
      assert.equal(second.changed, false);
    });

    it('reports not-applied status when the marker is missing', () => {
      const status = getWorktreePermissionProfileStatus(tmpDir);
      assert.equal(status.applied, false);
      assert.ok(Array.isArray(status.missingPermissionKeys));
    });

    it('reports applied status after the profile is written', () => {
      applyWorktreePermissionProfile(tmpDir, { worktreeBase: path.resolve(path.join(tmpDir, 'wt-base')) });
      const status = getWorktreePermissionProfileStatus(tmpDir);
      assert.equal(status.applied, true);
      assert.equal(status.missingPermissionKeys.length, 0);
    });
  });

  describe('normalizeProfile', () => {
    it('synthesizes roleModels from legacy small/big/review', () => {
      const result = normalizeProfile({ small: 'flash', big: 'pro', review: 'pro-review' });
      assert.equal(result.roleModels.exploration, 'flash');
      assert.equal(result.roleModels.implementation, 'flash');
      assert.equal(result.roleModels.planning, 'pro');
      assert.equal(result.roleModels.review, 'pro-review');
      assert.equal(result.roleModels.research, 'pro');
    });

    it('passes through profile with existing roleModels unchanged', () => {
      const input = { roleModels: { planning: 'p1', implementation: 'i1' }, tags: ['test'] };
      const result = normalizeProfile(input);
      assert.deepStrictEqual(result.roleModels, { planning: 'p1', implementation: 'i1' });
      assert.deepStrictEqual(result.tags, ['test']);
    });

    it('adds defaults for missing label, description, tags', () => {
      const result = normalizeProfile({ roleModels: {} }, 'test-profile');
      assert.equal(result.label, 'test-profile');
      assert.equal(result.description, '');
      assert.ok(Array.isArray(result.tags));
      assert.equal(result.tags.length, 0);
    });

    it('passes null/undefined through unchanged', () => {
      assert.equal(normalizeProfile(null), null);
      assert.equal(normalizeProfile(undefined), undefined);
    });
  });

  describe('readProfileCatalog', () => {
    it('reads and parses profiles.json', () => {
      const profilesDir = path.join(tmpDir, 'opencode-assets');
      fs.mkdirSync(profilesDir, { recursive: true });
      const data = { profiles: { test: { label: 'Test' } } };
      fs.writeFileSync(path.join(profilesDir, 'profiles.json'), JSON.stringify(data), 'utf8');
      const result = readProfileCatalog(tmpDir);
      assert.deepStrictEqual(result, data);
    });

    it('throws when file is missing', () => {
      assert.throws(() => readProfileCatalog(tmpDir), /ENOENT/);
    });
  });

  describe('setAgentRoleModels', () => {
    it('is a no-op — agentRoleModels unsupported by current OpenCode runtime', () => {
      setAgentRoleModels(tmpDir, { planning: 'model-a', implementation: 'model-b' });
      const config = readConfig(tmpDir);
      assert.ok(!config.agentRoleModels);
    });
  });

  describe('setAgentModels legacy compat', () => {
    it('writes config.agent.<name>.model for backward compat', () => {
      setAgentModels(tmpDir, 'small-model', 'big-model', 'review-model');
      const config = readConfig(tmpDir);
      assert.equal(config.agent.quick.model, 'small-model');
      assert.equal(config.agent.standard.model, 'big-model');
      assert.equal(config.agent.reviewer.model, 'review-model');
    });

    it('does not write unsupported agentRoleModels key', () => {
      setAgentModels(tmpDir, 'small-model', 'big-model', 'review-model');
      const config = readConfig(tmpDir);
      assert.ok(!config.agentRoleModels);
    });
  });

  describe('getActiveProfileId / setActiveProfileId', () => {
    it('setActiveProfileId writes to state file', () => {
      setActiveProfileId(tmpDir, 'my-profile');
      assert.equal(getActiveProfileId(tmpDir), 'my-profile');
    });

    it('falls back to activeProfileRoute', () => {
      const statePath = resolveStatePath(tmpDir);
      fs.writeFileSync(statePath, JSON.stringify({ activeProfileRoute: 'legacy-route' }), 'utf8');
      assert.equal(getActiveProfileId(tmpDir), 'legacy-route');
    });

    it('defaults to opencode-go-balanced when neither exists', () => {
      assert.equal(getActiveProfileId(tmpDir), 'opencode-go-balanced');
    });
  });

  describe('applyProfile', () => {
    it('does not write unsupported agentRoleModels key', () => {
      const profile = { roleModels: { planning: 'plan-model', implementation: 'impl-model' } };
      applyProfile(tmpDir, profile);
      const config = readConfig(tmpDir);
      assert.ok(!config.agentRoleModels);
    });
  });
});
