'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRoadmapWorkflowPlanningBridge } = require('../lib/roadmapWorkflowPlanningBridge');
const { resolvePlanningDbPath } = require('../lib/roadmapWorkflowPlanningBridge');
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
async function run() {
  console.log('\nRoadmap Workflow Planning Bridge Status Tests\n');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-roadmap-bridge-status-'));
  const elegyHome = path.join(tmpRoot, '.elegy');
  fs.mkdirSync(elegyHome, { recursive: true });
  try {
    await test('command-name cliPath is ready only when command lookup succeeds', () => {
      const bridge = createRoadmapWorkflowPlanningBridge({
        elegyHome,
        cliPath: 'elegy-planning',
        dbPath: path.join(elegyHome, 'planning.db'),
        platform: 'linux',
        spawnSyncImpl: (command, args) => {
          assert.strictEqual(command, 'which');
          assert.deepStrictEqual(args, ['elegy-planning']);
          return { status: 0 };
        },
      });
      const status = bridge.getStatus();
      assert.strictEqual(status.ready, true);
      assert.strictEqual(status.code, 'planning_authority_ready');
      assert.strictEqual(status.cliPath, 'elegy-planning');
    });
    await test('missing command-name cliPath is not ready with cli_binary_not_found', () => {
      const bridge = createRoadmapWorkflowPlanningBridge({
        elegyHome,
        cliPath: 'definitely-not-on-path-xyz',
        dbPath: path.join(elegyHome, 'planning.db'),
        platform: 'linux',
        spawnSyncImpl: () => ({ status: 1 }),
      });
      const status = bridge.getStatus();
      assert.strictEqual(status.ready, false);
      assert.strictEqual(status.code, 'cli_binary_not_found');
      assert.ok(String(status.message || '').includes('definitely-not-on-path-xyz'));
    });
    await test('explicit missing filesystem path stays not ready with cli_binary_not_found', () => {
      const missingPath = path.join(elegyHome, 'missing', 'elegy-planning');
      const bridge = createRoadmapWorkflowPlanningBridge({
        elegyHome,
        cliPath: missingPath,
        dbPath: path.join(elegyHome, 'planning.db'),
        platform: 'linux',
        spawnSyncImpl: () => ({ status: 1 }),
      });
      const status = bridge.getStatus();
      assert.strictEqual(status.ready, false);
      assert.strictEqual(status.code, 'cli_binary_not_found');
      assert.ok(String(status.message || '').includes(missingPath));
    });
    await test('planning DB resolver ignores stale .copilot env and defaults to ~/.elegy/planning.db', () => {
      const copilotHome = path.join(tmpRoot, '.copilot');
      fs.mkdirSync(copilotHome, { recursive: true });
      const staleDb = path.join(copilotHome, 'elegy-planning.db');
      fs.writeFileSync(staleDb, 'stale');

      const resolution = resolvePlanningDbPath({
        elegyHome,
        homedir: tmpRoot,
        env: {
          INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH: staleDb,
        },
      });

      assert.strictEqual(resolution.dbPath, path.join(elegyHome, 'planning.db'));
      assert.strictEqual(resolution.source, 'home-elegy');
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  console.log(`\nCompleted Roadmap Workflow Planning Bridge Status Tests: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
