'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  createOpenCodeGoWorkspaces,
  KEYRING_SERVICE_NAME,
  KEY_SOURCES,
  SELECTION_MODES,
  isValidWorkspaceId,
  buildConsoleUrl,
  redactApiKey,
  normalizeStoredProfile,
  resolveNativeAuthPath,
  resolveStorePath,
  resolveOpenCodeHome,
} = require('./opencodeGoWorkspaces');

function createMockKeyringModule() {
  const store = new Map();
  return {
    module: {
      async getPassword(service, account) {
        const key = `${service}::${account}`;
        return store.has(key) ? store.get(key) : null;
      },
      async setPassword(service, account, password) {
        store.set(`${service}::${account}`, password);
      },
      async deletePassword(service, account) {
        return store.delete(`${service}::${account}`);
      },
    },
    store,
  };
}

function createOpenCodeGoWorkspacesFactory(options = {}) {
  const keyring = createMockKeyringModule();
  const fetchImpl = options.fetchImpl || null;
  const defaultEnv = {
    XDG_DATA_HOME: path.join(options.tmpDir || os.tmpdir(), 'xdg-data-empty-' + Math.random().toString(36).slice(2)),
  };
  return {
    keyring,
    store: createOpenCodeGoWorkspaces({
      keyringLoader: async () => keyring.module,
      fetchImpl,
      env: options.env ? { ...defaultEnv, ...options.env } : defaultEnv,
      now: options.now || (() => new Date().toISOString()),
      nativeAuthPath: options.nativeAuthPath || null,
    }),
  };
}

describe('opencodeGoWorkspaces', () => {
  let tmpDir;
  let opencodeHome;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-go-workspaces-'));
    opencodeHome = path.join(tmpDir, '.config', 'opencode');
    fs.mkdirSync(opencodeHome, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('module metadata', () => {
    it('exposes keyring service name and source constants', () => {
      assert.equal(typeof KEYRING_SERVICE_NAME, 'string');
      assert.equal(KEY_SOURCES.KEYCHAIN, 'keychain');
      assert.equal(KEY_SOURCES.ENV, 'env');
      assert.equal(KEY_SOURCES.NATIVE_AUTH, 'opencode-auth');
      assert.equal(KEY_SOURCES.MISSING, 'missing');
    });

    it('resolves store path under opencodeHome', () => {
      const storePath = resolveStorePath(opencodeHome);
      assert.equal(storePath, path.join(opencodeHome, '.elegy-opencode-go-workspaces.json'));
    });

    it('resolves opencode home with default fallback', () => {
      const resolved = resolveOpenCodeHome();
      assert.ok(resolved.endsWith(`${path.sep}.config${path.sep}opencode`));
    });

    it('resolves native auth path using XDG_DATA_HOME when provided', () => {
      const env = { XDG_DATA_HOME: path.join(tmpDir, 'xdg') };
      const authPath = resolveNativeAuthPath(env);
      assert.equal(authPath, path.join(tmpDir, 'xdg', 'opencode', 'auth.json'));
    });
  });

  describe('isValidWorkspaceId', () => {
    it('accepts wrk_ identifiers', () => {
      assert.equal(isValidWorkspaceId('wrk_abc123'), true);
      assert.equal(isValidWorkspaceId('wrk_ABC-def_123'), true);
    });

    it('rejects non-wrk identifiers', () => {
      assert.equal(isValidWorkspaceId('abc'), false);
      assert.equal(isValidWorkspaceId('wrk-abc'), false);
      assert.equal(isValidWorkspaceId('WRK_abc'), false);
      assert.equal(isValidWorkspaceId(''), false);
      assert.equal(isValidWorkspaceId(null), false);
    });
  });

  describe('buildConsoleUrl', () => {
    it('builds console URL for valid workspace id', () => {
      assert.equal(buildConsoleUrl('wrk_abc'), 'https://opencode.ai/workspace/wrk_abc/go');
    });

    it('returns null for invalid workspace id', () => {
      assert.equal(buildConsoleUrl('foo'), null);
      assert.equal(buildConsoleUrl(null), null);
    });
  });

  describe('redactApiKey', () => {
    it('returns ellipsis-trimmed form for keys longer than 8', () => {
      assert.equal(redactApiKey('abcdefghijklmnop'), 'abcd…mnop');
    });

    it('returns star for short keys', () => {
      assert.equal(redactApiKey('short'), '****');
    });

    it('returns null for empty', () => {
      assert.equal(redactApiKey(''), null);
      assert.equal(redactApiKey(null), null);
    });
  });

  describe('normalizeStoredProfile', () => {
    it('returns null when id is missing', () => {
      assert.equal(normalizeStoredProfile({ label: 'X' }), null);
    });

    it('normalizes workspaceIdKnown and consoleUrl', () => {
      const result = normalizeStoredProfile({
        id: 'wrk_abc',
        label: 'My Workspace',
        workspaceId: 'wrk_abc',
        active: true,
        createdAt: '2025-01-01T00:00:00.000Z',
      });
      assert.equal(result.workspaceIdKnown, true);
      assert.equal(result.consoleUrl, 'https://opencode.ai/workspace/wrk_abc/go');
      assert.equal(result.active, true);
    });
  });

  describe('listWorkspaces', () => {
    it('returns empty registered and detected lists when nothing is configured', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      const result = await store.listWorkspaces(opencodeHome);
      assert.deepEqual(result.registered, []);
      assert.deepEqual(result.detected, []);
      assert.equal(result.activeId, null);
      assert.equal(result.storePath, resolveStorePath(opencodeHome));
    });

    it('detects OPENCODE_GO_API_KEY env var without exposing the key', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory({ env: { OPENCODE_GO_API_KEY: 'env-secret-key' } });
      const result = await store.listWorkspaces(opencodeHome);
      assert.equal(result.detected.length, 1);
      assert.equal(result.detected[0].label, 'Environment OpenCode Go');
      assert.equal(result.detected[0].keyPresent, true);
      assert.equal(result.detected[0].keySource, 'env');
      assert.equal(result.detected[0].origin, 'detected');
      // Make sure no raw key leaks.
      const serialized = JSON.stringify(result);
      assert.equal(serialized.includes('env-secret-key'), false);
    });

    it('detects OpenCode native auth.json provider entry', async () => {
      const authDir = path.join(tmpDir, 'xdg', 'opencode');
      fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(path.join(authDir, 'auth.json'), JSON.stringify({
        'opencode-go': { key: 'native-secret-key', workspaceId: 'wrk_native' },
        'other-provider': { key: 'unrelated' },
      }));
      const { store } = createOpenCodeGoWorkspacesFactory({
        env: { XDG_DATA_HOME: path.join(tmpDir, 'xdg') },
      });
      const result = await store.listWorkspaces(opencodeHome);
      assert.equal(result.detected.length, 1);
      assert.equal(result.detected[0].label, 'OpenCode native Go');
      assert.equal(result.detected[0].keySource, 'opencode-auth');
      assert.equal(result.detected[0].workspaceId, 'wrk_native');
      const serialized = JSON.stringify(result);
      assert.equal(serialized.includes('native-secret-key'), false);
    });

    it('treats detected workspace as effective active when no registered profile is active', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory({ env: { OPENCODE_GO_API_KEY: 'env-key' } });
      const result = await store.listWorkspaces(opencodeHome);
      assert.equal(result.activeId, 'detected:env:opencode-go');
    });
  });

  describe('registerWorkspace', () => {
    it('stores keychain reference and returns redacted metadata', async () => {
      const { store, keyring } = createOpenCodeGoWorkspacesFactory();
      const result = await store.registerWorkspace(opencodeHome, {
        label: 'Primary',
        workspaceId: 'wrk_primary',
        apiKey: 'super-secret-key',
      });
      assert.equal(result.registered.length, 1);
      assert.equal(result.registered[0].label, 'Primary');
      assert.equal(result.registered[0].workspaceIdKnown, true);
      assert.equal(result.registered[0].keyPresent, true);
      assert.equal(result.registered[0].keySource, 'keychain');
      assert.equal(result.registered[0].active, true);
      // No raw key in payload
      const serialized = JSON.stringify(result);
      assert.equal(serialized.includes('super-secret-key'), false);
      // Keychain actually stored
      const stored = await keyring.module.getPassword(KEYRING_SERVICE_NAME, 'keychain:wrk_primary');
      assert.equal(stored, 'super-secret-key');
    });

    it('marks only the active profile as active when activating', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'key-a', activate: false,
      });
      await store.registerWorkspace(opencodeHome, {
        label: 'B', workspaceId: 'wrk_b', apiKey: 'key-b', activate: true,
      });
      const result = await store.listWorkspaces(opencodeHome);
      const active = result.registered.filter((p) => p.active);
      assert.equal(active.length, 1);
      assert.equal(active[0].workspaceId, 'wrk_b');
      assert.equal(result.activeId, 'wrk_b');
    });

    it('rejects registration with missing label', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      await assert.rejects(
        () => store.registerWorkspace(opencodeHome, { apiKey: 'k' }),
        /label is required/,
      );
    });

    it('rejects registration with missing apiKey', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      await assert.rejects(
        () => store.registerWorkspace(opencodeHome, { label: 'L' }),
        /apiKey is required/,
      );
    });

    it('rejects invalid workspaceId format', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      await assert.rejects(
        () => store.registerWorkspace(opencodeHome, { label: 'L', apiKey: 'k', workspaceId: 'not-wrk' }),
        /wrk_/,
      );
    });
  });

  describe('updateWorkspace', () => {
    it('updates label and workspaceId without changing active state', async () => {
      const { store, keyring } = createOpenCodeGoWorkspacesFactory();
      await store.registerWorkspace(opencodeHome, {
        label: 'Old', workspaceId: 'wrk_abc', apiKey: 'key-abc',
      });
      const result = await store.updateWorkspace(opencodeHome, 'wrk_abc', {
        label: 'New',
      });
      const profile = result.registered.find((p) => p.id === 'wrk_abc');
      assert.equal(profile.label, 'New');
      // Key still present
      const stored = await keyring.module.getPassword(KEYRING_SERVICE_NAME, 'keychain:wrk_abc');
      assert.equal(stored, 'key-abc');
    });

    it('stores new key when apiKey is provided', async () => {
      const { store, keyring } = createOpenCodeGoWorkspacesFactory();
      await store.registerWorkspace(opencodeHome, {
        label: 'L', workspaceId: 'wrk_abc', apiKey: 'old',
      });
      await store.updateWorkspace(opencodeHome, 'wrk_abc', { apiKey: 'new-secret' });
      const stored = await keyring.module.getPassword(KEYRING_SERVICE_NAME, 'keychain:wrk_abc');
      assert.equal(stored, 'new-secret');
    });

    it('throws when profile is unknown', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      await assert.rejects(
        () => store.updateWorkspace(opencodeHome, 'wrk_missing', { label: 'X' }),
        /Unknown workspace profile/,
      );
    });
  });

  describe('activateWorkspace', () => {
    it('activates exactly one profile', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a', activate: true,
      });
      await store.registerWorkspace(opencodeHome, {
        label: 'B', workspaceId: 'wrk_b', apiKey: 'k-b', activate: false,
      });
      const result = await store.activateWorkspace(opencodeHome, 'wrk_b');
      const active = result.registered.filter((p) => p.active);
      assert.equal(active.length, 1);
      assert.equal(active[0].workspaceId, 'wrk_b');
      assert.equal(result.activeId, 'wrk_b');
    });

    it('rejects activation of a profile without a stored key', async () => {
      const { store, keyring } = createOpenCodeGoWorkspacesFactory();
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a',
      });
      // Manually remove key from keychain
      await keyring.module.deletePassword(KEYRING_SERVICE_NAME, 'keychain:wrk_a');
      await assert.rejects(
        () => store.activateWorkspace(opencodeHome, 'wrk_a'),
        /no API key in keychain/,
      );
    });

    it('throws on unknown id', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      await assert.rejects(
        () => store.activateWorkspace(opencodeHome, 'wrk_missing'),
        /Unknown workspace id/,
      );
    });
  });

  describe('deleteWorkspace', () => {
    it('removes metadata and keychain entry', async () => {
      const { store, keyring } = createOpenCodeGoWorkspacesFactory();
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a',
      });
      const result = await store.deleteWorkspace(opencodeHome, 'wrk_a');
      assert.equal(result.registered.length, 0);
      const stored = await keyring.module.getPassword(KEYRING_SERVICE_NAME, 'keychain:wrk_a');
      assert.equal(stored, null);
    });

    it('clears activeId when deleting the active profile', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a',
      });
      const result = await store.deleteWorkspace(opencodeHome, 'wrk_a');
      assert.equal(result.activeId, null);
    });

    it('throws on unknown id', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      await assert.rejects(
        () => store.deleteWorkspace(opencodeHome, 'wrk_missing'),
        /Unknown workspace profile/,
      );
    });
  });

  describe('validateWorkspace', () => {
    it('records ok status when fetch returns 2xx', async () => {
      const fetchImpl = async () => ({ status: 200 });
      const { store } = createOpenCodeGoWorkspacesFactory({ fetchImpl });
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a',
      });
      const result = await store.validateWorkspace(opencodeHome, 'wrk_a');
      assert.equal(result.status, 'ok');
      const after = await store.listWorkspaces(opencodeHome);
      const profile = after.registered.find((p) => p.id === 'wrk_a');
      assert.equal(profile.lastValidatedStatus, 'ok');
      assert.equal(typeof profile.lastValidatedAt, 'string');
    });

    it('records unauthorized on 401', async () => {
      const fetchImpl = async () => ({ status: 401 });
      const { store } = createOpenCodeGoWorkspacesFactory({ fetchImpl });
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a',
      });
      const result = await store.validateWorkspace(opencodeHome, 'wrk_a');
      assert.equal(result.status, 'unauthorized');
    });

    it('records error on transport failure', async () => {
      const fetchImpl = async () => {
        throw new Error('network down');
      };
      const { store } = createOpenCodeGoWorkspacesFactory({ fetchImpl });
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a',
      });
      const result = await store.validateWorkspace(opencodeHome, 'wrk_a');
      assert.equal(result.status, 'error');
      assert.match(result.message, /network down/);
    });

    it('reports missing key without calling fetch', async () => {
      let called = false;
      const fetchImpl = async () => { called = true; return { status: 200 }; };
      const { store, keyring } = createOpenCodeGoWorkspacesFactory({ fetchImpl });
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a',
      });
      await keyring.module.deletePassword(KEYRING_SERVICE_NAME, 'keychain:wrk_a');
      const result = await store.validateWorkspace(opencodeHome, 'wrk_a');
      assert.equal(result.status, 'missing-key');
      assert.equal(called, false);
    });
  });

  describe('resolveActiveApiKey', () => {
    it('returns keychain key when active profile has stored key', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a',
      });
      const result = await store.resolveActiveApiKey(opencodeHome);
      assert.equal(result.value, 'k-a');
      assert.equal(result.source, 'keychain');
      assert.equal(result.profile.workspaceId, 'wrk_a');
    });

    it('falls back to detected native key when no registered active', async () => {
      const authDir = path.join(tmpDir, 'xdg', 'opencode');
      fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(path.join(authDir, 'auth.json'), JSON.stringify({
        'opencode-go': { key: 'native-key' },
      }));
      const { store } = createOpenCodeGoWorkspacesFactory({
        env: { XDG_DATA_HOME: path.join(tmpDir, 'xdg') },
      });
      const result = await store.resolveActiveApiKey(opencodeHome);
      assert.equal(result.value, 'native-key');
      assert.equal(result.source, 'opencode-auth');
    });

    it('falls back to OPENCODE_GO_API_KEY when no native key', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory({ env: { OPENCODE_GO_API_KEY: 'env-key' } });
      const result = await store.resolveActiveApiKey(opencodeHome);
      assert.equal(result.value, 'env-key');
      assert.equal(result.source, 'env');
    });

    it('returns missing when no key sources are available', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      const result = await store.resolveActiveApiKey(opencodeHome);
      assert.equal(result.source, 'missing');
      assert.equal(result.value, undefined);
    });
  });

  describe('createDraftProfile', () => {
    it('returns a draft with generated id when workspaceId missing', () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      const draft = store.createDraftProfile({ label: 'Draft' });
      assert.equal(draft.origin, 'draft');
      assert.ok(draft.id.startsWith('wks_'));
      assert.equal(draft.workspaceIdKnown, false);
    });

    it('uses provided workspaceId when valid', () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      const draft = store.createDraftProfile({ label: 'Draft', workspaceId: 'wrk_draft' });
      assert.equal(draft.id, 'wrk_draft');
      assert.equal(draft.workspaceIdKnown, true);
      assert.equal(draft.consoleUrl, 'https://opencode.ai/workspace/wrk_draft/go');
    });
  });

  describe('selectionMode', () => {
    it('returns auto selectionMode for a fresh store with no activeId', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      const result = await store.listWorkspaces(opencodeHome);
      assert.equal(result.selectionMode, SELECTION_MODES.AUTO);
    });

    it('returns explicit selectionMode when an activeId existed in the store', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      const storePath = resolveStorePath(opencodeHome);
      fs.writeFileSync(storePath, JSON.stringify({
        activeId: 'wrk_a',
        profiles: [{ id: 'wrk_a', label: 'A', keyRef: 'keychain:wrk_a' }],
      }));
      const result = await store.listWorkspaces(opencodeHome);
      assert.equal(result.selectionMode, SELECTION_MODES.EXPLICIT);
    });

    it('infers explicit selectionMode when store has a dangling activeId (raw.activeId truthy)', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      const storePath = resolveStorePath(opencodeHome);
      fs.writeFileSync(storePath, JSON.stringify({
        activeId: 'wrk_missing',
        profiles: [{ id: 'wrk_a', label: 'A' }],
      }));
      const result = await store.listWorkspaces(opencodeHome);
      // readStore uses raw.activeId truthiness for fallback, so dangling id -> explicit
      assert.equal(result.selectionMode, SELECTION_MODES.EXPLICIT);
      // The computed activeId is null because no profile matches
      assert.equal(result.activeId, null);
    });

    it('persists explicit selectionMode from store JSON', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      const storePath = resolveStorePath(opencodeHome);
      fs.writeFileSync(storePath, JSON.stringify({
        selectionMode: SELECTION_MODES.EXPLICIT,
        activeId: null,
        profiles: [],
      }));
      const result = await store.listWorkspaces(opencodeHome);
      assert.equal(result.selectionMode, SELECTION_MODES.EXPLICIT);
    });

    it('persists none selectionMode from store JSON', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      const storePath = resolveStorePath(opencodeHome);
      fs.writeFileSync(storePath, JSON.stringify({
        selectionMode: SELECTION_MODES.NONE,
        activeId: null,
        profiles: [],
      }));
      const result = await store.listWorkspaces(opencodeHome);
      assert.equal(result.selectionMode, SELECTION_MODES.NONE);
    });

    it('sets selectionMode to explicit when registering with activate=true', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      const result = await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a',
      });
      assert.equal(result.selectionMode, SELECTION_MODES.EXPLICIT);
    });

    it('keeps selectionMode unchanged when registering with activate=false', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      const initial = await store.listWorkspaces(opencodeHome);
      assert.equal(initial.selectionMode, SELECTION_MODES.AUTO);
      const result = await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a', activate: false,
      });
      assert.equal(result.selectionMode, SELECTION_MODES.AUTO);
    });

    it('sets selectionMode to explicit when activating a workspace', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a', activate: false,
      });
      const result = await store.activateWorkspace(opencodeHome, 'wrk_a');
      assert.equal(result.selectionMode, SELECTION_MODES.EXPLICIT);
    });

    it('updateWorkspace preserves selectionMode when explicit', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory({ tmpDir });
      await store.registerWorkspace(opencodeHome, {
        label: 'Test', workspaceId: 'wrk_test', apiKey: 'key-test',
      });
      // Verify it's explicit after activation
      let result = await store.listWorkspaces(opencodeHome);
      assert.equal(result.selectionMode, 'explicit');
      // Update label
      result = await store.updateWorkspace(opencodeHome, 'wrk_test', { label: 'Updated' });
      assert.equal(result.selectionMode, 'explicit');
    });

    it('updateWorkspace preserves selectionMode when none', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory({ tmpDir });
      await store.registerWorkspace(opencodeHome, {
        label: 'Test', workspaceId: 'wrk_test', apiKey: 'key-test',
      });
      // Deactivate (sets to none)
      let result = await store.deactivateWorkspace(opencodeHome);
      assert.equal(result.selectionMode, 'none');
      // Update label
      result = await store.updateWorkspace(opencodeHome, 'wrk_test', { label: 'Updated' });
      assert.equal(result.selectionMode, 'none');
    });

    it('validateWorkspace preserves selectionMode for registered profiles', async () => {
      const fetchImpl = async () => ({ status: 200 });
      const { store } = createOpenCodeGoWorkspacesFactory({ tmpDir, fetchImpl });
      await store.registerWorkspace(opencodeHome, {
        label: 'Test', workspaceId: 'wrk_test', apiKey: 'key-test',
      });
      // Deactivate (sets to none)
      await store.deactivateWorkspace(opencodeHome);
      let result = await store.listWorkspaces(opencodeHome);
      assert.equal(result.selectionMode, 'none');
      // Validate
      await store.validateWorkspace(opencodeHome, 'wrk_test');
      result = await store.listWorkspaces(opencodeHome);
      assert.equal(result.selectionMode, 'none');
    });
  });

  describe('deactivateWorkspace and selectionMode', () => {
    it('sets selectionMode to none when deactivating', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      const reg = await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a',
      });
      assert.equal(reg.selectionMode, SELECTION_MODES.EXPLICIT);
      const result = await store.deactivateWorkspace(opencodeHome);
      assert.equal(result.activeId, null);
      assert.equal(result.selectionMode, SELECTION_MODES.NONE);
    });

    it('keeps none selectionMode after deactivation even with detected sources', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory({ env: { OPENCODE_GO_API_KEY: 'env-key' } });
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a',
      });
      await store.deactivateWorkspace(opencodeHome);
      const result = await store.listWorkspaces(opencodeHome);
      assert.equal(result.detected.length, 1);
      assert.equal(result.detected[0].keySource, 'env');
      assert.equal(result.activeId, null);
      assert.equal(result.selectionMode, SELECTION_MODES.NONE);
    });
  });

  describe('deleteWorkspace and selectionMode', () => {
    it('sets selectionMode to none when deleting the active workspace', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a',
      });
      const result = await store.deleteWorkspace(opencodeHome, 'wrk_a');
      assert.equal(result.selectionMode, SELECTION_MODES.NONE);
    });

    it('keeps selectionMode when deleting a non-active workspace', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a', activate: true,
      });
      await store.registerWorkspace(opencodeHome, {
        label: 'B', workspaceId: 'wrk_b', apiKey: 'k-b', activate: false,
      });
      const result = await store.deleteWorkspace(opencodeHome, 'wrk_b');
      assert.equal(result.selectionMode, SELECTION_MODES.EXPLICIT);
    });
  });

  describe('resolveActiveApiKey with selectionMode', () => {
    it('returns MISSING immediately when selectionMode is none, ignoring all sources', async () => {
      const { store, keyring } = createOpenCodeGoWorkspacesFactory();
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a',
      });
      const storePath = resolveStorePath(opencodeHome);
      const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      raw.selectionMode = SELECTION_MODES.NONE;
      fs.writeFileSync(storePath, JSON.stringify(raw));
      const result = await store.resolveActiveApiKey(opencodeHome);
      assert.equal(result.source, KEY_SOURCES.MISSING);
      assert.equal(result.value, undefined);
    });

    it('returns MISSING immediately when selectionMode is none even with env var set', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory({ env: { OPENCODE_GO_API_KEY: 'env-key' } });
      const storePath = resolveStorePath(opencodeHome);
      fs.writeFileSync(storePath, JSON.stringify({
        selectionMode: SELECTION_MODES.NONE,
        activeId: null,
        profiles: [],
      }));
      const result = await store.resolveActiveApiKey(opencodeHome);
      assert.equal(result.source, KEY_SOURCES.MISSING);
      assert.equal(result.value, undefined);
    });

    it('returns MISSING immediately when selectionMode is none even with native auth present', async () => {
      const authDir = path.join(tmpDir, 'xdg', 'opencode');
      fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(path.join(authDir, 'auth.json'), JSON.stringify({
        'opencode-go': { key: 'native-key' },
      }));
      const { store } = createOpenCodeGoWorkspacesFactory({
        env: { XDG_DATA_HOME: path.join(tmpDir, 'xdg') },
      });
      const storePath = resolveStorePath(opencodeHome);
      fs.writeFileSync(storePath, JSON.stringify({
        selectionMode: SELECTION_MODES.NONE,
        activeId: null,
        profiles: [],
      }));
      const result = await store.resolveActiveApiKey(opencodeHome);
      assert.equal(result.source, KEY_SOURCES.MISSING);
      assert.equal(result.value, undefined);
    });

    it('resolves from registered profile only when selectionMode is explicit', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a',
      });
      const result = await store.resolveActiveApiKey(opencodeHome);
      assert.equal(result.value, 'k-a');
      assert.equal(result.source, KEY_SOURCES.KEYCHAIN);
    });

    it('does not fall back to env when explicit mode activeId has no key in keychain', async () => {
      const { store, keyring } = createOpenCodeGoWorkspacesFactory({ env: { OPENCODE_GO_API_KEY: 'env-fallback' } });
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a',
      });
      await keyring.module.deletePassword(KEYRING_SERVICE_NAME, 'keychain:wrk_a');
      const result = await store.resolveActiveApiKey(opencodeHome);
      assert.equal(result.source, KEY_SOURCES.MISSING);
      assert.equal(result.value, undefined);
    });

    it('returns the detected env key when explicit mode with detected env id', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory({ env: { OPENCODE_GO_API_KEY: 'env-key' } });
      const storePath = resolveStorePath(opencodeHome);
      // readStore preserves detected IDs as valid activeId values, so the
      // detected-ID branch in resolveActiveApiKey now correctly returns the key.
      fs.writeFileSync(storePath, JSON.stringify({
        activeId: 'detected:env:opencode-go',
        selectionMode: SELECTION_MODES.EXPLICIT,
        profiles: [],
      }));
      const result = await store.resolveActiveApiKey(opencodeHome);
      assert.equal(result.source, KEY_SOURCES.ENV);
      assert.equal(result.value, 'env-key');
    });

    it('returns the detected native auth key when explicit mode with detected native id', async () => {
      const authDir = path.join(tmpDir, 'xdg', 'opencode');
      fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(path.join(authDir, 'auth.json'), JSON.stringify({
        'opencode-go': { key: 'native-key' },
      }));
      const { store } = createOpenCodeGoWorkspacesFactory({
        env: { XDG_DATA_HOME: path.join(tmpDir, 'xdg') },
      });
      const storePath = resolveStorePath(opencodeHome);
      fs.writeFileSync(storePath, JSON.stringify({
        activeId: 'detected:native:opencode-go',
        selectionMode: SELECTION_MODES.EXPLICIT,
        profiles: [],
      }));
      const result = await store.resolveActiveApiKey(opencodeHome);
      assert.equal(result.source, KEY_SOURCES.NATIVE_AUTH);
      assert.equal(result.value, 'native-key');
    });

    it('falls back through chain when selectionMode is auto (default)', async () => {
      const { store, keyring } = createOpenCodeGoWorkspacesFactory({
        env: { OPENCODE_GO_API_KEY: 'env-key' },
      });
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a',
      });
      await keyring.module.deletePassword(KEYRING_SERVICE_NAME, 'keychain:wrk_a');
      const storePath = resolveStorePath(opencodeHome);
      const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      raw.selectionMode = SELECTION_MODES.AUTO;
      fs.writeFileSync(storePath, JSON.stringify(raw));
      const result = await store.resolveActiveApiKey(opencodeHome);
      assert.equal(result.value, 'env-key');
      assert.equal(result.source, KEY_SOURCES.ENV);
    });

    it('returns MISSING when explicit mode with detected id but source is absent', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      const storePath = resolveStorePath(opencodeHome);
      fs.writeFileSync(storePath, JSON.stringify({
        activeId: 'detected:env:opencode-go',
        selectionMode: SELECTION_MODES.EXPLICIT,
        profiles: [],
      }));
      const result = await store.resolveActiveApiKey(opencodeHome);
      assert.equal(result.source, KEY_SOURCES.MISSING);
      assert.equal(result.value, undefined);
    });
  });

  describe('effectiveActiveId with selectionMode', () => {
    it('returns null when selectionMode is none with valid activeId', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      const storePath = resolveStorePath(opencodeHome);
      fs.writeFileSync(storePath, JSON.stringify({
        activeId: 'wrk_a',
        selectionMode: SELECTION_MODES.NONE,
        profiles: [{ id: 'wrk_a', label: 'A' }],
      }));
      const result = await store.listWorkspaces(opencodeHome);
      assert.equal(result.activeId, null);
    });

    it('returns activeId when selectionMode is explicit with registered active', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a',
      });
      const result = await store.listWorkspaces(opencodeHome);
      assert.equal(result.activeId, 'wrk_a');
    });

    it('returns null when selectionMode is explicit but no activeId in store', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory();
      await store.registerWorkspace(opencodeHome, {
        label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a', activate: false,
      });
      const storePath = resolveStorePath(opencodeHome);
      const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      raw.activeId = null;
      raw.selectionMode = SELECTION_MODES.EXPLICIT;
      fs.writeFileSync(storePath, JSON.stringify(raw));
      const result = await store.listWorkspaces(opencodeHome);
      assert.equal(result.activeId, null);
    });

    it('auto-selects single detected source when selectionMode is auto', async () => {
      const { store } = createOpenCodeGoWorkspacesFactory({
        env: { OPENCODE_GO_API_KEY: 'env-key' },
      });
      const result = await store.listWorkspaces(opencodeHome);
      assert.equal(result.activeId, 'detected:env:opencode-go');
    });

    it('returns null when explicit mode with detected id that is no longer available', async () => {
      // Set env var to make a detected source appear
      const envWithKey = { OPENCODE_GO_API_KEY: 'temp-key', XDG_DATA_HOME: path.join(tmpDir, 'xdg-empty') };
      const { store: envStore } = createOpenCodeGoWorkspacesFactory({ tmpDir, env: envWithKey });
      // Activate the detected env workspace (this writes activeId to store)
      await envStore.activateWorkspace(opencodeHome, 'detected:env:opencode-go');
      let result = await envStore.listWorkspaces(opencodeHome);
      assert.equal(result.selectionMode, 'explicit');
      assert.equal(result.activeId, 'detected:env:opencode-go');
      // Now remove the env var by creating a new store factory without it
      const { store: cleanStore } = createOpenCodeGoWorkspacesFactory({ tmpDir });
      result = await cleanStore.listWorkspaces(opencodeHome);
      // The detected workspace is no longer in detectedIds, so activeId should be null
      assert.equal(result.activeId, null);
    });
  });
});
