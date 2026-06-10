'use strict';
const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const externalSources = require('../lib/externalSources');
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    failed += 1;
    process.exitCode = 1;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
  }
}
function writeJson(absPath, value) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
function writeText(absPath, text) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, text, 'utf8');
}
function commandFailure(message, code = 1) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function createExecFileStub(responses) {
  const calls = [];
  return {
    calls,
    childProcess: {
      execFile(command, args, options, callback) {
        const key = `${command} ${args.join(' ')}`.trim();
        calls.push({ command, args: [...args], cwd: options.cwd, key });
        const handler = responses[key];
        if (!handler) {
          const error = commandFailure(`Unexpected command: ${key}`);
          callback(error, '', error.message);
          return;
        }
        const result = typeof handler === 'function'
          ? handler({ command, args: [...args], cwd: options.cwd, calls })
          : handler;
        if (result instanceof Error) {
          callback(result, '', result.message);
          return;
        }
        callback(result?.error || null, result?.stdout || '', result?.stderr || '');
      },
    },
  };
}
async function run() {
  console.log('\nExternal Sources Tests\n');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-external-sources-'));
  const engineRoot = path.join(tmpRoot, 'engine');
  const elegyHome = path.join(tmpRoot, '.elegy');
  const codexHome = path.join(tmpRoot, '.codex');
  const opencodeHome = path.join(tmpRoot, '.config', 'opencode');
  const geminiHome = path.join(tmpRoot, '.gemini');
  const antigravityHome = path.join(geminiHome, 'antigravity');
  try {
    function writeCatalog(sources) {
      writeJson(path.join(engineRoot, 'engine-assets', 'external-sources.json'), {
        schemaVersion: 1,
        sources,
      });
    }
    function createTargetHomes(name) {
      const root = path.join(tmpRoot, name);
      return {
        elegyHome: path.join(root, '.elegy'),
        codexHome: path.join(root, '.codex'),
        opencodeHome: path.join(root, '.config', 'opencode'),
        geminiHome: path.join(root, '.gemini'),
        antigravityHome: path.join(root, '.gemini', 'antigravity'),
      };
    }
    writeCatalog([
      {
        sourceId: 'seeded-source',
        title: 'Seeded Source',
        url: 'https://github.com/example/seeded-source',
        sourceType: 'github-repo',
        owner: 'example',
        repo: 'seeded-source',
        defaultRef: 'main',
        includeSkills: true,
        preferredSkillPathPrefixes: ['skills'],
      },
    ]);
    await test('listSources merges shipped and user sources with cached installables', async () => {
      externalSources.addSource({ engineRoot, elegyHome }, {
        url: 'https://github.com/example/demo-source',
        title: 'Demo Source',
        sourceId: 'demo-source',
        includeMcp: true,
      });
      const cacheRoot = externalSources.resolveCacheRoot(elegyHome);
      writeJson(path.join(cacheRoot, 'demo-source', 'snapshot.json'), {
        schemaVersion: 1,
        sourceId: 'demo-source',
        fetchedAt: '2026-05-19T00:00:00.000Z',
        resolvedRef: 'main',
        installables: [
          {
            installableId: 'skill:brainstorming',
            kind: 'skill',
            name: 'brainstorming',
            title: 'Brainstorming',
            sourcePath: 'skills/brainstorming',
            targetSupport: ['codex', 'opencode', 'antigravity'],
          },
        ],
      });
      writeJson(path.join(externalSources.resolveStatePath(elegyHome)), {
        schemaVersion: 1,
        sources: {
          'demo-source': {
            syncStatus: 'ready',
            lastSyncedAt: '2026-05-19T00:00:00.000Z',
            targets: {
              codex: {
                installables: {
                  'skill:brainstorming': {
                    enabled: true,
                  },
                },
              },
            },
          },
        },
      });
      const result = externalSources.listSources({ engineRoot, elegyHome });
      assert.strictEqual(result.sources.length, 2);
      const demoSource = result.sources.find((source) => source.sourceId === 'demo-source');
      assert.ok(demoSource, 'expected user source in merged list');
      assert.strictEqual(demoSource.editable, true);
      assert.strictEqual(demoSource.sync.status, 'ready');
      assert.strictEqual(demoSource.installables.length, 1);
      assert.strictEqual(demoSource.activation.codex.installables['skill:brainstorming'].enabled, true);
    });
    await test('listSources surfaces persisted verification state in source sync metadata', async () => {
      writeJson(path.join(externalSources.resolveStatePath(elegyHome)), {
        schemaVersion: 1,
        sources: {
          'demo-source': {
            syncStatus: 'ready',
            lastSyncedAt: '2026-05-19T00:00:00.000Z',
            lastVerifiedAt: '2026-05-19T00:05:00.000Z',
            verificationStatus: 'partial',
            verificationWarnings: ['repo not initialized'],
            verificationErrors: [],
            targets: {
              host: {
                installables: {
                  'cli:specify': {
                    enabled: true,
                    installed: true,
                    overallStatus: 'installed',
                    lastVerifiedAt: '2026-05-19T00:05:00.000Z',
                    warnings: [],
                    errors: [],
                    checks: [],
                  },
                },
              },
            },
          },
        },
      });
      const result = externalSources.listSources({ engineRoot, elegyHome });
      const demoSource = result.sources.find((source) => source.sourceId === 'demo-source');
      assert.ok(demoSource, 'expected demo-source in merged list');
      assert.strictEqual(demoSource.sync.lastVerifiedAt, '2026-05-19T00:05:00.000Z');
      assert.strictEqual(demoSource.sync.verificationStatus, 'partial');
      assert.deepStrictEqual(demoSource.sync.verificationWarnings, ['repo not initialized']);
      assert.deepStrictEqual(demoSource.sync.verificationErrors, []);
    });
    await test('activateInstallable materializes skills into target homes and records state', async () => {
      const sourceCacheRoot = path.join(externalSources.resolveCacheRoot(elegyHome), 'demo-source');
      writeJson(path.join(sourceCacheRoot, 'snapshot.json'), {
        schemaVersion: 1,
        sourceId: 'demo-source',
        fetchedAt: '2026-05-19T00:00:00.000Z',
        resolvedRef: 'main',
        installables: [
          {
            installableId: 'skill:brainstorming',
            kind: 'skill',
            name: 'brainstorming',
            title: 'Brainstorming',
            sourcePath: 'skills/brainstorming',
            targetSupport: ['codex', 'opencode', 'antigravity'],
          },
        ],
      });
      writeText(path.join(sourceCacheRoot, 'extracted', 'demo-source-main', 'skills', 'brainstorming', 'SKILL.md'), '# Brainstorming\n');
      const result = await externalSources.activateInstallable({
        engineRoot,
        elegyHome,
        codexHome,
        opencodeHome,
        geminiHome,
        antigravityHome,
      }, {
        sourceId: 'demo-source',
        installableId: 'skill:brainstorming',
        target: 'codex',
      });
      assert.strictEqual(result.target, 'codex');
      assert.strictEqual(result.materialized.kind, 'skill');
      assert.ok(fs.existsSync(path.join(codexHome, 'skills', 'external--demo-source--brainstorming', 'SKILL.md')));
      const listed = externalSources.listSources({ engineRoot, elegyHome });
      const demoSource = listed.sources.find((source) => source.sourceId === 'demo-source');
      assert.strictEqual(demoSource.activation.codex.installables['skill:brainstorming'].enabled, true);
    });
    await test('Antigravity CLI alias normalizes to the shared Gemini CLI target for MCP installs', async () => {
      const sourceCacheRoot = path.join(externalSources.resolveCacheRoot(elegyHome), 'demo-source');
      writeJson(path.join(sourceCacheRoot, 'snapshot.json'), {
        schemaVersion: 1,
        sourceId: 'demo-source',
        fetchedAt: '2026-05-20T00:00:00.000Z',
        resolvedRef: 'main',
        installables: [
          {
            installableId: 'mcp:context7',
            kind: 'mcp-server',
            name: 'context7',
            title: 'Context7',
            sourcePath: 'server.json',
            targetSupport: ['codex', 'opencode', 'antigravity-cli', 'gemini-cli'],
          },
        ],
      });
      const listed = externalSources.listSources({ engineRoot, elegyHome });
      const demoSourceBefore = listed.sources.find((source) => source.sourceId === 'demo-source');
      assert.deepStrictEqual(
        demoSourceBefore.installables[0].targetSupport,
        ['codex', 'opencode', 'gemini-cli'],
      );
      const result = await externalSources.activateInstallable({
        engineRoot,
        elegyHome,
        codexHome,
        opencodeHome,
        geminiHome,
        antigravityHome,
      }, {
        sourceId: 'demo-source',
        installableId: 'mcp:context7',
        target: 'antigravity-cli',
      });
      assert.strictEqual(result.target, 'gemini-cli');
      const settingsPath = path.join(geminiHome, 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      assert.ok(settings.mcpServers['external-demo-source-context7']);
      const state = JSON.parse(fs.readFileSync(externalSources.resolveStatePath(elegyHome), 'utf8'));
      assert.ok(state.sources['demo-source'].targets['gemini-cli']);
      assert.ok(!state.sources['demo-source'].targets['antigravity-cli']);
    });
    await test('refreshSource records sync errors when archive download fails', async () => {
      let caught = null;
      try {
        await externalSources.refreshSource({
          engineRoot,
          elegyHome,
          fetch: async () => ({ ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) }),
        }, 'demo-source');
      } catch (error) {
        caught = error;
      }
      assert.ok(caught, 'expected refresh to fail');
      const listed = externalSources.listSources({ engineRoot, elegyHome });
      const demoSource = listed.sources.find((source) => source.sourceId === 'demo-source');
      assert.strictEqual(demoSource.sync.status, 'error');
      assert.match(String(demoSource.sync.lastError || ''), /unable to download/i);
    });
    await test('removeSource rejects removal while active target installs remain', async () => {
      let caught = null;
      try {
        externalSources.removeSource({ elegyHome }, 'demo-source');
      } catch (error) {
        caught = error;
      }
      assert.ok(caught, 'expected removal to be rejected');
      assert.strictEqual(caught.statusCode, 409);
      assert.match(String(caught.message || ''), /active target installs/i);
    });
    await test('GhidraMCP activation writes absolute cached bridge paths into MCP configs', async () => {
      writeCatalog([
        {
          sourceId: 'ghidra-mcp',
          title: 'GhidraMCP',
          url: 'https://github.com/LaurieWired/GhidraMCP',
          sourceType: 'github-repo',
          owner: 'LaurieWired',
          repo: 'GhidraMCP',
          defaultRef: 'main',
          includeSkills: false,
          includeMcp: false,
          installables: [
            {
              installableId: 'mcp:ghidra',
              kind: 'mcp-server',
              name: 'ghidra',
              title: 'GhidraMCP',
              sourcePath: 'bridge_mcp_ghidra.py',
              verifyCommand: 'python bridge_mcp_ghidra.py --help',
              targetSupport: ['codex', 'opencode', 'gemini-cli'],
              metadata: {
                bridgeScriptPath: 'bridge_mcp_ghidra.py',
                defaultGhidraServerUrl: 'http://127.0.0.1:8080/',
                commandTemplate: ['python', 'bridge_mcp_ghidra.py', '--ghidra-server', 'http://127.0.0.1:8080/'],
              },
            },
          ],
        },
      ]);
      const homes = createTargetHomes('ghidra-targets');
      const originalExecFileSync = childProcess.execFileSync;
      try {
        childProcess.execFileSync = (command, args) => {
          assert.strictEqual(command, 'tar');
          const extractRoot = args[args.indexOf('-C') + 1];
          writeText(path.join(extractRoot, 'ghidra-mcp-main', 'bridge_mcp_ghidra.py'), 'print("ghidra")\n');
        };
        await externalSources.refreshSource({
          engineRoot,
          elegyHome: homes.elegyHome,
          fetch: async () => ({
            ok: true,
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          }),
        }, 'ghidra-mcp');
      } finally {
        childProcess.execFileSync = originalExecFileSync;
      }
      const expectedBridgePath = path.join(
        externalSources.resolveCacheRoot(homes.elegyHome),
        'ghidra-mcp',
        'extracted',
        'ghidra-mcp-main',
        'bridge_mcp_ghidra.py',
      );
      await externalSources.activateInstallable({
        engineRoot,
        elegyHome: homes.elegyHome,
        codexHome: homes.codexHome,
        opencodeHome: homes.opencodeHome,
        geminiHome: homes.geminiHome,
        antigravityHome: homes.antigravityHome,
      }, {
        sourceId: 'ghidra-mcp',
        installableId: 'mcp:ghidra',
        target: 'codex',
      });
      await externalSources.activateInstallable({
        engineRoot,
        elegyHome: homes.elegyHome,
        codexHome: homes.codexHome,
        opencodeHome: homes.opencodeHome,
        geminiHome: homes.geminiHome,
        antigravityHome: homes.antigravityHome,
      }, {
        sourceId: 'ghidra-mcp',
        installableId: 'mcp:ghidra',
        target: 'opencode',
      });
      await externalSources.activateInstallable({
        engineRoot,
        elegyHome: homes.elegyHome,
        codexHome: homes.codexHome,
        opencodeHome: homes.opencodeHome,
        geminiHome: homes.geminiHome,
        antigravityHome: homes.antigravityHome,
      }, {
        sourceId: 'ghidra-mcp',
        installableId: 'mcp:ghidra',
        target: 'gemini-cli',
      });
      const codexConfig = fs.readFileSync(path.join(homes.codexHome, 'config.toml'), 'utf8');
      const opencodeConfig = JSON.parse(fs.readFileSync(path.join(homes.opencodeHome, 'opencode.json'), 'utf8'));
      const geminiConfig = JSON.parse(fs.readFileSync(path.join(homes.geminiHome, 'settings.json'), 'utf8'));
      assert.ok(codexConfig.includes(expectedBridgePath.replace(/\\/g, '\\\\')));
      assert.deepStrictEqual(
        opencodeConfig.mcp['external-ghidra-mcp-ghidra'].command,
        ['python', expectedBridgePath, '--ghidra-server', 'http://127.0.0.1:8080/'],
      );
      assert.deepStrictEqual(
        geminiConfig.mcpServers['external-ghidra-mcp-ghidra'].args,
        [expectedBridgePath, '--ghidra-server', 'http://127.0.0.1:8080/'],
      );
    });
    await test('Spec Kit install prefers uv when available and uses uv reinstall under force', async () => {
      writeCatalog([
        {
          sourceId: 'spec-kit',
          title: 'Spec Kit',
          url: 'https://github.com/github/spec-kit',
          sourceType: 'github-repo',
          owner: 'github',
          repo: 'spec-kit',
          defaultRef: 'v0.8.13',
          includeSkills: false,
          includeMcp: false,
          installables: [
            {
              installableId: 'cli:specify',
              kind: 'cli-tool',
              name: 'specify',
              title: 'Spec Kit',
              targetSupport: ['host'],
              installCommand: 'uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v0.8.13',
              metadata: {
                preferredInstaller: 'uv',
                fallbackInstaller: 'pipx',
                installCommandUv: 'uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v0.8.13',
                installCommandPipx: 'pipx install git+https://github.com/github/spec-kit.git@v0.8.13',
                reinstallCommandPipx: 'pipx install --force git+https://github.com/github/spec-kit.git@v0.8.13',
              },
            },
          ],
        },
      ]);
      const homes = createTargetHomes('spec-kit-uv');
      const stub = createExecFileStub({
        'uv --version': { stdout: 'uv 0.4.0\n' },
        'uv tool install --reinstall specify-cli --from git+https://github.com/github/spec-kit.git@v0.8.13': { stdout: 'specify\n' },
      });
      const result = await externalSources.activateInstallable({
        engineRoot,
        elegyHome: homes.elegyHome,
        codexHome: homes.codexHome,
        opencodeHome: homes.opencodeHome,
        geminiHome: homes.geminiHome,
        antigravityHome: homes.antigravityHome,
        childProcess: stub.childProcess,
        force: true,
      }, {
        sourceId: 'spec-kit',
        installableId: 'cli:specify',
        target: 'host',
      });
      assert.strictEqual(result.materialized.installer, 'uv');
      assert.deepStrictEqual(
        stub.calls.map((entry) => entry.key),
        [
          'uv --version',
          'uv tool install --reinstall specify-cli --from git+https://github.com/github/spec-kit.git@v0.8.13',
        ],
      );
    });
    await test('Spec Kit install falls back to pipx when uv is unavailable', async () => {
      writeCatalog([
        {
          sourceId: 'spec-kit',
          title: 'Spec Kit',
          url: 'https://github.com/github/spec-kit',
          sourceType: 'github-repo',
          owner: 'github',
          repo: 'spec-kit',
          defaultRef: 'v0.8.13',
          includeSkills: false,
          includeMcp: false,
          installables: [
            {
              installableId: 'cli:specify',
              kind: 'cli-tool',
              name: 'specify',
              title: 'Spec Kit',
              targetSupport: ['host'],
              installCommand: 'uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v0.8.13',
              metadata: {
                preferredInstaller: 'uv',
                fallbackInstaller: 'pipx',
                installCommandUv: 'uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v0.8.13',
                installCommandPipx: 'pipx install git+https://github.com/github/spec-kit.git@v0.8.13',
                reinstallCommandPipx: 'pipx install --force git+https://github.com/github/spec-kit.git@v0.8.13',
              },
            },
          ],
        },
      ]);
      const homes = createTargetHomes('spec-kit-pipx');
      const stub = createExecFileStub({
        'uv --version': { error: commandFailure('uv not found') },
        'pipx --version': { stdout: '1.4.3\n' },
        'pipx install --force git+https://github.com/github/spec-kit.git@v0.8.13': { stdout: 'specify\n' },
      });
      const result = await externalSources.activateInstallable({
        engineRoot,
        elegyHome: homes.elegyHome,
        codexHome: homes.codexHome,
        opencodeHome: homes.opencodeHome,
        geminiHome: homes.geminiHome,
        antigravityHome: homes.antigravityHome,
        childProcess: stub.childProcess,
        force: true,
      }, {
        sourceId: 'spec-kit',
        installableId: 'cli:specify',
        target: 'host',
      });
      assert.strictEqual(result.materialized.installer, 'pipx');
      assert.deepStrictEqual(
        stub.calls.map((entry) => entry.key),
        [
          'uv --version',
          'pipx --version',
          'pipx install --force git+https://github.com/github/spec-kit.git@v0.8.13',
        ],
      );
    });
    await test('Spec Kit install fails clearly when both uv and pipx are unavailable', async () => {
      writeCatalog([
        {
          sourceId: 'spec-kit',
          title: 'Spec Kit',
          url: 'https://github.com/github/spec-kit',
          sourceType: 'github-repo',
          owner: 'github',
          repo: 'spec-kit',
          defaultRef: 'v0.8.13',
          includeSkills: false,
          includeMcp: false,
          installables: [
            {
              installableId: 'cli:specify',
              kind: 'cli-tool',
              name: 'specify',
              title: 'Spec Kit',
              targetSupport: ['host'],
              installCommand: 'uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v0.8.13',
              metadata: {
                preferredInstaller: 'uv',
                fallbackInstaller: 'pipx',
                installCommandUv: 'uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v0.8.13',
                installCommandPipx: 'pipx install git+https://github.com/github/spec-kit.git@v0.8.13',
              },
            },
          ],
        },
      ]);
      const homes = createTargetHomes('spec-kit-missing');
      const stub = createExecFileStub({
        'uv --version': { error: commandFailure('uv not found') },
        'pipx --version': { error: commandFailure('pipx not found') },
      });
      let caught = null;
      try {
        await externalSources.activateInstallable({
          engineRoot,
          elegyHome: homes.elegyHome,
          codexHome: homes.codexHome,
          opencodeHome: homes.opencodeHome,
          geminiHome: homes.geminiHome,
          antigravityHome: homes.antigravityHome,
          childProcess: stub.childProcess,
        }, {
          sourceId: 'spec-kit',
          installableId: 'cli:specify',
          target: 'host',
        });
      } catch (error) {
        caught = error;
      }
      assert.ok(caught, 'expected install to fail');
      assert.match(String(caught.message || ''), /unable to install spec kit/i);
      assert.match(String(caught.message || ''), /neither .*uv.* nor .*pipx.* available on path/i);
      assert.match(String(caught.message || ''), /install one of them and retry/i);
    });
    await test('activateInstallable deactivates conflicting installables from the same conflict group', async () => {
      const homes = createTargetHomes('conflict-test');
      writeCatalog([
        {
          sourceId: 'conflict-source',
          title: 'Conflict Source',
          url: 'https://github.com/example/conflict-source',
          sourceType: 'github-repo',
          owner: 'example',
          repo: 'conflict-source',
          defaultRef: 'main',
          includeSkills: false,
          includeMcp: true,
          installables: [
            {
              installableId: 'cli:tool-a',
              kind: 'cli-tool',
              name: 'tool-a',
              title: 'Tool A',
              targetSupport: ['host'],
              installCommand: 'echo installed-a',
            },
            {
              installableId: 'mcp:tool-b',
              kind: 'mcp-server',
              name: 'tool-b',
              title: 'Tool B',
              targetSupport: ['opencode'],
              metadata: {
                commandTemplate: ['npx', '-y', 'tool-b-mcp'],
              },
            },
          ],
          conflictGroups: [
            {
              groupId: 'group-a',
              label: 'CLI Mode',
              installableIds: ['cli:tool-a'],
              conflictsWith: ['group-b'],
            },
            {
              groupId: 'group-b',
              label: 'MCP Mode',
              installableIds: ['mcp:tool-b'],
              conflictsWith: ['group-a'],
            },
          ],
        },
      ]);
      const stub = createExecFileStub({
        'echo installed-a': { stdout: '/usr/local/bin/tool-a\n' },
      });
      // First activate CLI tool
      await externalSources.activateInstallable({
        engineRoot,
        elegyHome: homes.elegyHome,
        codexHome: homes.codexHome,
        opencodeHome: homes.opencodeHome,
        geminiHome: homes.geminiHome,
        antigravityHome: homes.antigravityHome,
        childProcess: stub.childProcess,
      }, {
        sourceId: 'conflict-source',
        installableId: 'cli:tool-a',
        target: 'host',
      });
      let state = JSON.parse(fs.readFileSync(externalSources.resolveStatePath(homes.elegyHome), 'utf8'));
      assert.strictEqual(state.sources['conflict-source'].targets.host.installables['cli:tool-a'].enabled, true);
      // Now activate MCP tool — should deactivate CLI tool
      await externalSources.activateInstallable({
        engineRoot,
        elegyHome: homes.elegyHome,
        codexHome: homes.codexHome,
        opencodeHome: homes.opencodeHome,
        geminiHome: homes.geminiHome,
        antigravityHome: homes.antigravityHome,
        childProcess: stub.childProcess,
      }, {
        sourceId: 'conflict-source',
        installableId: 'mcp:tool-b',
        target: 'opencode',
      });
      state = JSON.parse(fs.readFileSync(externalSources.resolveStatePath(homes.elegyHome), 'utf8'));
      assert.strictEqual(state.sources['conflict-source'].targets.opencode.installables['mcp:tool-b'].enabled, true);
      const cliState = state.sources['conflict-source'].targets.host?.installables?.['cli:tool-a'];
      assert.ok(cliState, 'cli:tool-a should exist in state');
      assert.strictEqual(cliState.enabled, false, `cli:tool-a.enabled expected false but got ${cliState.enabled}`);
    });
    await test('resolveConflictGroups returns empty array for sources without conflict groups', async () => {
      const source = { sourceId: 'no-groups', conflictGroups: undefined };
      const groups = externalSources.resolveConflictGroups(source);
      assert.deepStrictEqual(groups, []);
    });
    await test('findConflictGroupForInstallable returns the correct group', async () => {
      const conflictGroups = [
        { groupId: 'group-a', installableIds: ['cli:tool-a', 'skill:skill-a'] },
        { groupId: 'group-b', installableIds: ['mcp:tool-b'] },
      ];
      const group = externalSources.findConflictGroupForInstallable(conflictGroups, 'skill:skill-a');
      assert.ok(group);
      assert.strictEqual(group.groupId, 'group-a');
    });
    await test('resolveConflictingInstallableIds returns all conflicting installable IDs', async () => {
      const conflictGroups = [
        { groupId: 'group-a', installableIds: ['cli:tool-a'], conflictsWith: ['group-b'] },
        { groupId: 'group-b', installableIds: ['mcp:tool-b', 'skill:skill-b'], conflictsWith: ['group-a'] },
      ];
      const ids = externalSources.resolveConflictingInstallableIds(conflictGroups, 'group-a');
      assert.deepStrictEqual(ids.sort(), ['mcp:tool-b', 'skill:skill-b']);
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  console.log(`\n  ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
}
run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
