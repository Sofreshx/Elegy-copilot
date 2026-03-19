'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const planningBullets = require('./planningBullets');

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

function createRepoRoot() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-planning-bullets-'));
  fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
  return repoRoot;
}

async function run() {
  await test('creates deterministic PB ids and persists canonical markdown', async () => {
    const repoRoot = createRepoRoot();

    const first = planningBullets.createPlanningBullet(repoRoot, {
      title: 'Capture repo-scoped bullets',
      state: 'idea',
      repoId: 'repo-instruction-engine',
      summary: 'Move future-plan seeds into docs/planning/bullets.md.',
      notes: ['Expose bullets in Planning UI'],
    });
    const second = planningBullets.createPlanningBullet(repoRoot, {
      title: 'Review roadmap hierarchy copy',
      state: 'research',
      repoId: 'repo-instruction-engine',
      summary: 'Clarify bullets vs backlog vs roadmaps.',
      notes: [],
    });

    assert.equal(first.id, 'PB-001');
    assert.equal(second.id, 'PB-002');

    const state = planningBullets.listPlanningBullets(repoRoot);
    assert.equal(state.exists, true);
    assert.equal(state.bullets.length, 2);
    assert.equal(state.bullets[0].repoRelativePath, 'docs/planning/bullets.md');
    assert.equal(state.bullets[1].state, 'research');

    const fileText = fs.readFileSync(state.filePath, 'utf8');
    assert.match(fileText, /^# Planning Bullets/m);
    assert.match(fileText, /^## PB-001 — Capture repo-scoped bullets$/m);
    assert.match(fileText, /^- Promoted to plan: none$/m);
  });

  await test('updates promoted refs without breaking deterministic parsing', async () => {
    const repoRoot = createRepoRoot();
    planningBullets.createPlanningBullet(repoRoot, {
      title: 'Seed planning session from bullet',
      state: 'pre-plan',
      repoId: 'repo-instruction-engine',
      summary: 'Ensure bullet-to-plan traceability stays explicit.',
      notes: ['Reuse linked plan session if present'],
    });

    const updated = planningBullets.updatePlanningBullet(repoRoot, 'PB-001', {
      promotedPlanRefs: ['plan-123'],
      promotedBacklogRefs: ['RB-001'],
    });

    assert.deepEqual(updated.promotedPlanRefs, ['plan-123']);
    assert.deepEqual(updated.promotedBacklogRefs, ['RB-001']);

    const reparsed = planningBullets.listPlanningBullets(repoRoot);
    assert.deepEqual(reparsed.bullets[0].promotedPlanRefs, ['plan-123']);
    assert.deepEqual(reparsed.bullets[0].promotedBacklogRefs, ['RB-001']);
  });

  await test('fails closed on malformed bullet document headings', async () => {
    const repoRoot = createRepoRoot();
    const filePath = planningBullets.resolvePlanningBulletsFilePath(repoRoot);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '# Wrong Title\n', 'utf8');

    assert.throws(
      () => planningBullets.readPlanningBulletsFile(repoRoot),
      /planning bullets document must begin with "# Planning Bullets"/
    );
  });

  console.log(`planningBullets.test.js: ${passed} passed`);
}

run();
