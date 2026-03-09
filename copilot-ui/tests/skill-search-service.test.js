'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildCatalogProjection,
  resolveProjectionStorage,
} = require('../lib/catalogProjectionService');
const {
  loadSkillSearchTelemetry,
  recordSkillSearchSelection,
  resolveSkill,
  searchSkills,
  telemetryStoragePath,
} = require('../lib/skillSearchService');

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
  console.log('\nSkill Search Service Tests\n');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-skill-search-'));
  const engineRoot = path.join(tmpRoot, 'engine');
  const copilotHome = path.join(tmpRoot, '.copilot');
  const repoPath = path.join(tmpRoot, 'workspace-repo');

  try {
    writeJson(path.join(engineRoot, 'engine-assets', 'manifest.json'), {
      assets: [
        {
          id: 'skill-react-query',
          type: 'skill',
          source: 'engine-assets/skills/react-query',
          destination: 'skills/react-query',
          loadMode: 'on-demand',
        },
        {
          id: 'skill-testing-dotnet-unit',
          type: 'skill',
          source: 'engine-assets/skills/testing-dotnet-unit',
          destination: 'skills/testing-dotnet-unit',
          loadMode: 'always',
        },
      ],
    });

    writeJson(path.join(engineRoot, 'engine-assets', 'skills', 'skill-metadata-index.json'), {
      schemaVersion: 1,
      entries: [
        {
          skill: 'react-query',
          name: 'React Query',
          description: 'React cache and TanStack Query workflows for typed frontends.',
          triggersOn: ['react query', 'tanstack query', 'query cache'],
          frameworks: ['react'],
          stacks: ['frontend'],
          languages: ['typescript'],
          tags: ['cache', 'frontend', 'query'],
          manifest: { loadMode: 'on-demand' },
        },
        {
          skill: 'testing-dotnet-unit',
          name: 'testing-dotnet-unit',
          description: 'Unit testing skill for .NET service code.',
          triggersOn: ['xunit', 'unit test', 'nsubstitute'],
          frameworks: ['aspnet'],
          stacks: ['backend'],
          languages: ['csharp'],
          tags: ['test', 'backend'],
          manifest: { loadMode: 'always' },
        },
      ],
    });

    writeText(
      path.join(engineRoot, 'engine-assets', 'skills', 'react-query', 'SKILL.md'),
      [
        '---',
        'frameworks: react',
        'stacks: frontend',
        'languages: typescript',
        'tags: cache',
        '---',
        '# React Query',
        '',
        'React Query metadata.',
        '',
        'Triggers on: react query, tanstack query, query cache',
        '',
      ].join('\n'),
    );
    writeText(
      path.join(engineRoot, 'engine-assets', 'skills', 'testing-dotnet-unit', 'SKILL.md'),
      '# testing-dotnet-unit\n\nBackend testing skill.\n\nTriggers on: xunit, unit test\n',
    );

    writeText(
      path.join(copilotHome, 'skills', 'react-query', 'SKILL.md'),
      [
        '---',
        'schema-version: 1',
        'vault-ref: skills-vault/react-query',
        '---',
        '# React Query Pointer',
        'Pointer stub.',
        '',
      ].join('\n'),
    );
    writeText(
      path.join(copilotHome, 'skills-vault', 'react-query', 'SKILL.md'),
      '# React Query Vault\n\nVault-first React Query guidance.\n',
    );
    writeText(
      path.join(copilotHome, 'skills', 'testing-dotnet-unit', 'SKILL.md'),
      '# testing-dotnet-unit\n\nInstalled backend testing guidance.\n',
    );
    writeText(
      path.join(repoPath, '.github', 'skills', 'react-query', 'SKILL.md'),
      [
        '---',
        'frameworks: react',
        'stacks: frontend',
        'languages: typescript',
        'tags: cache',
        '---',
        '# Repo React Query',
        '',
        'Repo-local React Query override.',
        '',
        'Triggers on: react query, query cache',
        '',
      ].join('\n'),
    );

    const repoStorage = resolveProjectionStorage({ copilotHome, repoPath });
    const snapshot = buildCatalogProjection({ engineRoot, copilotHome, repoPath });
    const reactQuery = snapshot.effectiveAssets.find((asset) => asset.assetId === 'skill-react-query');
    reactQuery.recommendations.push({
      source: 'framework',
      reasonCode: 'react-frontend',
      reason: 'Recommended for React frontend workspaces.',
      score: 8,
      framework: 'react',
      stack: 'frontend',
      repoId: repoStorage.repoContext.repoId,
      emittedAt: '2026-03-01T00:00:00.000Z',
    });
    reactQuery.recommended = true;
    reactQuery.labels = Array.from(new Set([...reactQuery.labels, 'recommended']));

    await test('searchSkills ranks repo-local targeted matches with deterministic explanations', async () => {
      const response = searchSkills(
        {
          query: 'react query cache',
          repoId: repoStorage.repoContext.repoId,
          repoPath,
          frameworks: ['react'],
          stacks: ['frontend'],
          languages: ['typescript'],
          tags: ['cache'],
          preferLoadMode: 'on-demand',
          limit: 5,
        },
        {
          snapshot,
          copilotHome,
          persistTelemetry: false,
        },
      );

      assert.ok(response.results.length >= 1, 'expected at least one ranked result');
      assert.strictEqual(response.results[0].assetId, 'skill-react-query');
      assert.strictEqual(response.results[0].effectiveState.selectedLayer, 'repo-local');
      assert.ok(
        response.results[0].explanations.some((item) => item.code === 'framework'),
        'expected framework explanation',
      );
      assert.ok(
        response.results[0].explanations.some((item) => item.code === 'load-mode'),
        'expected load-mode explanation',
      );
      assert.ok(
        response.results[0].explanations.some((item) => item.code === 'recommendation'),
        'expected recommendation explanation',
      );
      assert.ok(
        response.results[0].explanations.some((item) => item.code === 'repo-local'),
        'expected repo-local explanation',
      );
    });

    await test('resolveSkill keeps deterministic lexical tie-breaking', async () => {
      const minimalSnapshot = {
        effectiveAssets: [
          {
            assetId: 'skill-alpha',
            assetKey: 'alpha',
            kind: 'skill',
            available: true,
            enabled: true,
            deprecated: false,
            recommended: false,
            scope: { kind: 'global' },
            selectedLayer: 'source',
            installState: { loadMode: 'on-demand' },
            recommendations: [],
            labels: [],
            selectedEntry: {
              assetId: 'skill-alpha',
              assetKey: 'alpha',
              kind: 'skill',
              title: 'alpha',
              layer: 'source',
              scope: { kind: 'global' },
              metadata: { aliasKeys: ['alpha'] },
            },
          },
          {
            assetId: 'skill-beta',
            assetKey: 'beta',
            kind: 'skill',
            available: true,
            enabled: true,
            deprecated: false,
            recommended: false,
            scope: { kind: 'global' },
            selectedLayer: 'source',
            installState: { loadMode: 'on-demand' },
            recommendations: [],
            labels: [],
            selectedEntry: {
              assetId: 'skill-beta',
              assetKey: 'beta',
              kind: 'skill',
              title: 'beta',
              layer: 'source',
              scope: { kind: 'global' },
              metadata: { aliasKeys: ['beta'] },
            },
          },
        ],
      };

      const resolved = resolveSkill(
        {
          query: '',
          preferLoadMode: 'on-demand',
        },
        {
          snapshot: minimalSnapshot,
          persistTelemetry: false,
        },
      );

      assert.strictEqual(resolved.results[0].assetId, 'skill-alpha');
      assert.strictEqual(resolved.results[1].assetId, 'skill-beta');
    });

    await test('search telemetry persists bounded query, result, miss, and selection events', async () => {
      const queryOne = searchSkills(
        {
          query: 'react query C:\\repo\\secret-project\\src',
          repoId: repoStorage.repoContext.repoId,
        },
        {
          snapshot,
          copilotHome,
          telemetryCapacity: 4,
          maxResultsPerEvent: 2,
        },
      );
      assert.ok(queryOne.results.length >= 1, 'expected first search to return results');

      const queryTwo = searchSkills(
        {
          query: 'zzz-missing-skill-12345',
          repoId: repoStorage.repoContext.repoId,
        },
        {
          snapshot,
          copilotHome,
          telemetryCapacity: 4,
          maxResultsPerEvent: 2,
        },
      );
      assert.strictEqual(queryTwo.results.length, 0);
      assert.strictEqual(queryTwo.missReason, 'no-match');

      recordSkillSearchSelection(
        {
          query: {
            query: 'react query',
            repoId: repoStorage.repoContext.repoId,
          },
          result: queryOne.results[0],
          resultCount: queryOne.results.length,
        },
        {
          copilotHome,
          telemetryCapacity: 4,
          maxResultsPerEvent: 2,
        },
      );

      const { telemetryPath, telemetry } = loadSkillSearchTelemetry({
        copilotHome,
        telemetryCapacity: 4,
        maxResultsPerEvent: 2,
      });
      assert.strictEqual(telemetryPath, telemetryStoragePath({ copilotHome }));
      assert.ok(fs.existsSync(telemetryPath), 'expected telemetry file to be written');
      assert.strictEqual(telemetry.sample.size, 4);
      assert.ok(telemetry.sample.dropped >= 1, 'expected bounded telemetry eviction');
      assert.ok(telemetry.countersByEventType['asset.search.query'] >= 2);
      assert.ok(telemetry.countersByEventType['asset.search.result'] >= 1);
      assert.ok(telemetry.countersByEventType['asset.search.miss'] >= 1);
      assert.ok(telemetry.countersByEventType['asset.search.selected'] >= 1);
      assert.ok(telemetry.countersByMissReason['no-match'] >= 1);
      assert.ok(
        telemetry.recent.some((event) => event.eventType === 'asset.search.selected'),
        'expected recent selection event',
      );
      const queryEvent = telemetry.recent.find((event) => event.eventType === 'asset.search.query');
      assert.ok(queryEvent, 'expected recent query event');
      assert.ok(
        !String(queryEvent.search?.query?.query || '').includes('\\'),
        'expected telemetry query text to be sanitized',
      );
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
