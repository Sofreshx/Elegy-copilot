'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { registerRepo } = require('./repoInventoryService');
const {
  createUiRuntimeOverlayService,
  resolveUiRuntimeOverlayStatePath,
} = require('./uiRuntimeOverlayService');

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

function writeJson(absPath, value) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function writeText(absPath, text) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, text, 'utf8');
}

function createNowSequence(values) {
  let index = 0;
  return () => {
    const nextValue = values[Math.min(index, values.length - 1)];
    index += 1;
    return Date.parse(nextValue);
  };
}

async function run() {
  console.log('\nUI Runtime Overlay Service Tests\n');

  await test('create session with selected repo succeeds and persists session state', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const copilotHome = path.join(tmpRoot, '.copilot');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    const packageRoot = path.join(repoPath, 'packages', 'web');

    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      fs.mkdirSync(packageRoot, { recursive: true });
      writeJson(path.join(repoPath, 'package.json'), { name: 'selected-repo' });
      registerRepo({
        copilotHome,
        repoPath,
        repoLabel: 'Selected Repo',
        select: true,
      });

      const service = createUiRuntimeOverlayService(
        { copilotHome },
        { now: createNowSequence(['2026-03-28T10:00:00.000Z']) }
      );

      const session = service.createSession({
        runtimeUrl: 'https://localhost:4173/app',
        packageRoot: 'packages/web',
      });

      assert.equal(session.status, 'attached');
      assert.equal(session.phase, 'attached');
      assert.equal(session.runtimeOrigin, 'https://localhost:4173');
      assert.equal(session.repoPath, path.resolve(repoPath));
      assert.equal(session.packageRoot, path.resolve(packageRoot));
      assert.equal(service.listSessions().length, 1);

      const persisted = JSON.parse(fs.readFileSync(resolveUiRuntimeOverlayStatePath(copilotHome), 'utf8'));
      assert.equal(persisted.version, 1);
      assert.equal(persisted.sessions.length, 1);
      assert.equal(persisted.sessions[0].repoId, session.repoId);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  await test('create session fails when no catalog repo is selected', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const copilotHome = path.join(tmpRoot, '.copilot');

    try {
      const service = createUiRuntimeOverlayService({ copilotHome });
      await assert.rejects(
        Promise.resolve().then(() => service.createSession({ runtimeUrl: 'http://127.0.0.1:3000' })),
        (error) => error && error.statusCode === 409 && /Catalog repo must be selected/i.test(error.message),
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  await test('packageRoot outside repo fails closed', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const copilotHome = path.join(tmpRoot, '.copilot');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    const outsidePath = path.join(tmpRoot, 'outside-root');

    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      fs.mkdirSync(outsidePath, { recursive: true });
      writeText(path.join(repoPath, 'README.md'), '# selected\n');
      registerRepo({
        copilotHome,
        repoPath,
        repoLabel: 'Selected Repo',
        select: true,
      });

      const service = createUiRuntimeOverlayService({ copilotHome });
      await assert.rejects(
        Promise.resolve().then(() => service.createSession({
          runtimeUrl: 'http://127.0.0.1:3000',
          packageRoot: outsidePath,
        })),
        (error) => error && error.statusCode === 400 && /under the selected repo/i.test(error.message),
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  await test('close session updates status and closed timestamp', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const copilotHome = path.join(tmpRoot, '.copilot');
    const repoPath = path.join(tmpRoot, 'selected-repo');

    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      registerRepo({
        copilotHome,
        repoPath,
        repoLabel: 'Selected Repo',
        select: true,
      });

      const service = createUiRuntimeOverlayService(
        { copilotHome },
        { now: createNowSequence(['2026-03-28T10:00:00.000Z', '2026-03-28T10:05:00.000Z']) }
      );

      const session = service.createSession({ runtimeUrl: 'http://127.0.0.1:3210' });
      const closed = service.closeSession(session.id);

      assert.equal(closed.status, 'closed');
      assert.equal(closed.phase, 'closed');
      assert.equal(closed.createdAt, '2026-03-28T10:00:00.000Z');
      assert.equal(closed.updatedAt, '2026-03-28T10:05:00.000Z');
      assert.equal(closed.closedAt, '2026-03-28T10:05:00.000Z');
      assert.equal(service.listSessions()[0].status, 'closed');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  console.log(`\n  ${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});