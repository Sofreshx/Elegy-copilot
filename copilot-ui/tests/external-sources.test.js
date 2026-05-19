'use strict';

const assert = require('assert');
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

async function run() {
  console.log('\nExternal Sources Tests\n');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-external-sources-'));
  const engineRoot = path.join(tmpRoot, 'engine');
  const copilotHome = path.join(tmpRoot, '.copilot');
  const codexHome = path.join(tmpRoot, '.codex');
  const opencodeHome = path.join(tmpRoot, '.config', 'opencode');
  const geminiHome = path.join(tmpRoot, '.gemini');
  const antigravityHome = path.join(geminiHome, 'antigravity');

  try {
    writeJson(path.join(engineRoot, 'engine-assets', 'external-sources.json'), {
      schemaVersion: 1,
      sources: [
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
      ],
    });

    await test('listSources merges shipped and user sources with cached installables', async () => {
      externalSources.addSource({ engineRoot, copilotHome }, {
        url: 'https://github.com/example/demo-source',
        title: 'Demo Source',
        sourceId: 'demo-source',
        includeMcp: true,
      });

      const cacheRoot = externalSources.resolveCacheRoot(copilotHome);
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
      writeJson(path.join(externalSources.resolveStatePath(copilotHome)), {
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

      const result = externalSources.listSources({ engineRoot, copilotHome });
      assert.strictEqual(result.sources.length, 2);

      const demoSource = result.sources.find((source) => source.sourceId === 'demo-source');
      assert.ok(demoSource, 'expected user source in merged list');
      assert.strictEqual(demoSource.editable, true);
      assert.strictEqual(demoSource.sync.status, 'ready');
      assert.strictEqual(demoSource.installables.length, 1);
      assert.strictEqual(demoSource.activation.codex.installables['skill:brainstorming'].enabled, true);
    });

    await test('activateInstallable materializes skills into target homes and records state', async () => {
      const sourceCacheRoot = path.join(externalSources.resolveCacheRoot(copilotHome), 'demo-source');
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

      const result = externalSources.activateInstallable({
        engineRoot,
        copilotHome,
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

      const listed = externalSources.listSources({ engineRoot, copilotHome });
      const demoSource = listed.sources.find((source) => source.sourceId === 'demo-source');
      assert.strictEqual(demoSource.activation.codex.installables['skill:brainstorming'].enabled, true);
    });

    await test('refreshSource records sync errors when archive download fails', async () => {
      let caught = null;
      try {
        await externalSources.refreshSource({
          engineRoot,
          copilotHome,
          fetch: async () => ({ ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) }),
        }, 'demo-source');
      } catch (error) {
        caught = error;
      }

      assert.ok(caught, 'expected refresh to fail');
      const listed = externalSources.listSources({ engineRoot, copilotHome });
      const demoSource = listed.sources.find((source) => source.sourceId === 'demo-source');
      assert.strictEqual(demoSource.sync.status, 'error');
      assert.match(String(demoSource.sync.lastError || ''), /unable to download/i);
    });

    await test('removeSource rejects removal while active target installs remain', async () => {
      let caught = null;
      try {
        externalSources.removeSource({ copilotHome }, 'demo-source');
      } catch (error) {
        caught = error;
      }

      assert.ok(caught, 'expected removal to be rejected');
      assert.strictEqual(caught.statusCode, 409);
      assert.match(String(caught.message || ''), /active target installs/i);
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
