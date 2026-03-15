'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildRepoRelativeRoadmapPath,
  listRoadmapDocuments,
  mergeRoadmapDocument,
  parseRoadmapMarkdown,
  reconcileRoadmapItem,
  resolveRoadmapFilePath,
  serializeRoadmapDocument,
  writeRoadmapDocument,
} = require('./roadmapArtifacts');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

function createTempRepo() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-roadmap-artifacts-'));
  const repoRoot = path.join(tmpRoot, 'repo');
  fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
  return { tmpRoot, repoRoot };
}

async function run() {
  console.log('\nRoadmap Artifact Helper Tests\n');

  await test('resolveRoadmapFilePath uses canonical docs/roadmaps location', async () => {
    const { repoRoot } = createTempRepo();
    assert.equal(
      resolveRoadmapFilePath(repoRoot, 'platform-foundation'),
      path.join(repoRoot, 'docs', 'roadmaps', 'platform-foundation.md'),
    );
    assert.equal(
      buildRepoRelativeRoadmapPath('platform-foundation'),
      'docs/roadmaps/platform-foundation.md',
    );
  });

  await test('serialize, write, and list roadmap documents deterministically', async () => {
    const { repoRoot } = createTempRepo();
    const written = writeRoadmapDocument(repoRoot, {
      slug: 'platform-foundation',
      title: 'Platform Foundation',
      overview: 'Sequenced outcomes for planning.',
      items: [
        {
          title: 'Bootstrap roadmap storage',
          phase: 'foundation',
          status: 'planned',
          summary: 'Create deterministic roadmap helpers and routes.',
          backlogIds: ['RB-002', 'RB-001'],
          planRefs: ['session:20260314_010203_ABCD'],
        },
        {
          title: 'Add roadmap reconciliation',
          phase: 'delivery',
          status: 'in-progress',
          summary: 'Record plan references during sync.',
          backlogIds: ['RB-003'],
        },
      ],
    });

    const markdown = fs.readFileSync(written.filePath, 'utf8');
    assert.match(markdown, /roadmap_slug: platform-foundation/);
    assert.match(markdown, /### RM-platform-foundation-001 — Bootstrap roadmap storage/);
    assert.match(markdown, /- Backlog IDs: RB-001, RB-002/);

    const parsed = parseRoadmapMarkdown(markdown, { slug: 'platform-foundation' });
    assert.equal(parsed.items.length, 2);
    assert.deepEqual(parsed.items.map((entry) => entry.id), [
      'RM-platform-foundation-001',
      'RM-platform-foundation-002',
    ]);
    assert.deepEqual(parsed.items[0].backlogIds, ['RB-001', 'RB-002']);

    const listed = listRoadmapDocuments(repoRoot);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].repoRelativePath, 'docs/roadmaps/platform-foundation.md');
  });

  await test('mergeRoadmapDocument upserts items and preserves stable ids', async () => {
    const merged = mergeRoadmapDocument({
      slug: 'platform-foundation',
      title: 'Platform Foundation',
      overview: 'Initial overview.',
      items: [
        {
          id: 'RM-platform-foundation-001',
          title: 'Bootstrap roadmap storage',
          phase: 'foundation',
          status: 'planned',
          summary: 'Initial summary.',
          backlogIds: ['RB-001'],
        },
      ],
    }, {
      overview: 'Updated overview.',
      items: [
        {
          id: 'RM-platform-foundation-001',
          status: 'done',
          summary: 'Completed summary.',
          planRefs: ['session:20260314_111111_ABCD'],
        },
        {
          title: 'Add roadmap reconciliation',
          phase: 'delivery',
          summary: 'Second item.',
          backlogIds: ['RB-002'],
        },
      ],
    });

    assert.equal(merged.overview, 'Updated overview.');
    assert.deepEqual(merged.items.map((entry) => entry.id), [
      'RM-platform-foundation-001',
      'RM-platform-foundation-002',
    ]);
    assert.equal(merged.items[0].status, 'done');
    assert.deepEqual(merged.items[0].planRefs, ['session:20260314_111111_ABCD']);
  });

  await test('reconcileRoadmapItem fails closed without backlog ids and records plan refs deterministically', async () => {
    assert.throws(() => reconcileRoadmapItem({
      slug: 'platform-foundation',
      items: [
        {
          id: 'RM-platform-foundation-001',
          title: 'Broken item',
          phase: 'foundation',
          status: 'planned',
          summary: 'Missing backlog linkage.',
          backlogIds: [],
        },
      ],
    }, {
      itemId: 'RM-platform-foundation-001',
      planRef: 'session:20260314_222222_ABCD',
      outcome: 'completed',
    }), /fails closed/i);

    const reconciled = reconcileRoadmapItem({
      slug: 'platform-foundation',
      items: [
        {
          id: 'RM-platform-foundation-001',
          title: 'Bootstrap roadmap storage',
          phase: 'foundation',
          status: 'planned',
          summary: 'Ready for reconciliation.',
          backlogIds: ['RB-001', 'RB-002'],
          planRefs: ['group:G-01-platform-foundation'],
        },
      ],
    }, {
      itemId: 'RM-platform-foundation-001',
      backlogIds: ['RB-002', 'RB-001'],
      planRef: 'session:20260314_222222_ABCD',
      outcome: 'completed',
    });

    assert.equal(reconciled.item.status, 'done');
    assert.equal(reconciled.item.satisfiedByPlanRef, 'session:20260314_222222_ABCD');
    assert.deepEqual(reconciled.item.planRefs, [
      'group:G-01-platform-foundation',
      'session:20260314_222222_ABCD',
    ]);

    const serialized = serializeRoadmapDocument(reconciled.roadmap);
    assert.match(serialized, /- Status: done/);
    assert.match(serialized, /- Satisfied By Plan Ref: session:20260314_222222_ABCD/);
  });

  if (!process.exitCode) {
    console.log(`roadmap artifact helper tests passed (${passed})`);
  }
}

run().catch((error) => {
  console.error('roadmap artifact helper tests failed');
  console.error(error);
  process.exitCode = 1;
});
