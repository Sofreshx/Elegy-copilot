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
function registerSelectedRepo(elegyHome, repoPath, repoLabel = 'Selected Repo') {
  registerRepo({
    elegyHome,
    repoPath,
    repoLabel,
    select: true,
  });
}
function createGitRepoRoot(repoPath) {
  fs.mkdirSync(path.join(repoPath, '.git', 'worktrees'), { recursive: true });
}
function createGitWorktree(repoPath, worktreePath, worktreeName = path.basename(worktreePath)) {
  const gitDir = path.join(repoPath, '.git', 'worktrees', worktreeName);
  fs.mkdirSync(worktreePath, { recursive: true });
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'commondir'), path.join('..', '..'));
  fs.writeFileSync(path.join(worktreePath, '.git'), `gitdir: ${gitDir}\n`);
}
async function run() {
  console.log('\nUI Runtime Overlay Service Tests\n');
  await test('create session with selected repo succeeds and persists session state', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    const packageRoot = path.join(repoPath, 'packages', 'web');
    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      fs.mkdirSync(packageRoot, { recursive: true });
      writeJson(path.join(repoPath, 'package.json'), { name: 'selected-repo' });
      registerSelectedRepo(elegyHome, repoPath);
      const service = createUiRuntimeOverlayService(
        { elegyHome },
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
      const persisted = JSON.parse(fs.readFileSync(resolveUiRuntimeOverlayStatePath(elegyHome), 'utf8'));
      assert.equal(persisted.version, 1);
      assert.equal(persisted.sessions.length, 1);
      assert.equal(persisted.sessions[0].repoId, session.repoId);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('create session can bind package root to a selected worktree path outside the primary checkout', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    const worktreePath = path.join(tmpRoot, 'selected-repo-worktrees', 'wt-1');
    try {
      createGitRepoRoot(repoPath);
      createGitWorktree(repoPath, worktreePath, 'wt-1');
      registerSelectedRepo(elegyHome, repoPath);
      const service = createUiRuntimeOverlayService(
        { elegyHome },
        { now: createNowSequence(['2026-03-28T10:00:00.000Z']) }
      );
      const session = service.createSession({
        runtimeUrl: 'https://localhost:4173/app',
        linkedSessionId: 'session-123',
        worktree: {
          worktreeId: 'wt-1',
          mode: 'dedicated',
          worktreePath,
          status: 'ready',
        },
      });
      assert.equal(session.linkedSessionId, 'session-123');
      assert.equal(session.packageRoot, path.resolve(worktreePath));
      assert.equal(session.worktree.worktreePath, path.resolve(worktreePath));
      assert.equal(session.worktree.status, 'ready');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('create session rejects non-attached worktree paths outside the selected repo checkout', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    const worktreePath = path.join(tmpRoot, 'selected-repo-worktrees', 'wt-bad');
    try {
      createGitRepoRoot(repoPath);
      fs.mkdirSync(worktreePath, { recursive: true });
      registerSelectedRepo(elegyHome, repoPath);
      const service = createUiRuntimeOverlayService({ elegyHome });
      await assert.rejects(
        Promise.resolve().then(() => service.createSession({
          runtimeUrl: 'https://localhost:4173/app',
          worktree: {
            worktreeId: 'wt-bad',
            mode: 'dedicated',
            worktreePath,
            status: 'ready',
          },
        })),
        (error) => error && error.statusCode === 400 && /attached git worktree|attached to repo/i.test(error.message),
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('malformed persisted overlay state fails closed', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    try {
      writeText(resolveUiRuntimeOverlayStatePath(elegyHome), '{"sessions":[');
      const service = createUiRuntimeOverlayService({ elegyHome });
      assert.throws(
        () => service.listSessions(),
        (error) => error && error.statusCode === 500 && /malformed json/i.test(error.message),
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('persisted overlay state with an invalid top-level shape fails closed', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    try {
      writeJson(resolveUiRuntimeOverlayStatePath(elegyHome), {
        version: 1,
        sessions: {},
      });
      const service = createUiRuntimeOverlayService({ elegyHome });
      assert.throws(
        () => service.listSessions(),
        (error) => error && error.statusCode === 500 && /invalid top-level shape/i.test(error.message),
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('create session fails when no catalog repo is selected', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    try {
      const service = createUiRuntimeOverlayService({ elegyHome });
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
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    const outsidePath = path.join(tmpRoot, 'outside-root');
    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      fs.mkdirSync(outsidePath, { recursive: true });
      writeText(path.join(repoPath, 'README.md'), '# selected\n');
      registerSelectedRepo(elegyHome, repoPath);
      const service = createUiRuntimeOverlayService({ elegyHome });
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
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      registerSelectedRepo(elegyHome, repoPath);
      const service = createUiRuntimeOverlayService(
        { elegyHome },
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
  await test('closed sessions reject non-cleanup overlay mutations with a 409 conflict', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      registerSelectedRepo(elegyHome, repoPath);
      const service = createUiRuntimeOverlayService(
        { elegyHome },
        {
          now: createNowSequence([
            '2026-03-28T10:00:00.000Z',
            '2026-03-28T10:01:00.000Z',
            '2026-03-28T10:02:00.000Z',
          ]),
        }
      );
      const session = service.createSession({ runtimeUrl: 'http://127.0.0.1:4173' });
      const changeRequest = service.addChangeRequest(session.id, {
        request: 'Keep a draft change request available before the session closes.',
      }).changeRequest;
      service.closeSession(session.id);
      for (const mutate of [
        () => service.addObservation(session.id, { kind: 'note', summary: 'Closed session mutation.' }),
        () => service.addAnnotation(session.id, { message: 'Closed session mutation.' }),
        () => service.addChangeRequest(session.id, { request: 'Closed session mutation.' }),
        () => service.queueChangeRequest(session.id, changeRequest.id, { executorJobId: 'job-closed' }),
      ]) {
        await assert.rejects(
          Promise.resolve().then(() => mutate()),
          (error) => error && error.statusCode === 409 && /session is closed/i.test(error.message),
        );
      }
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('release cleanup remains safe and idempotent for closed sessions', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    try {
      fs.mkdirSync(repoPath, { recursive: true });
      writeJson(resolveUiRuntimeOverlayStatePath(elegyHome), {
        version: 1,
        sessions: [
          {
            id: 'overlay-closed',
            status: 'closed',
            runtimeUrl: 'http://127.0.0.1:4173/',
            repoId: 'repo-1',
            repoPath,
            repoLabel: 'Selected Repo',
            packageRoot: repoPath,
            phase: 'closed',
            evidence: { source: 'copilot-ui', kind: 'runtime-url-registration' },
            observations: [],
            annotations: [],
            changeRequests: [
              {
                id: 'cr-closed',
                observationId: null,
                annotationId: null,
                title: 'Release cleanup should clear stale reservation state.',
                request: 'Release cleanup should clear stale reservation state.',
                prompt: 'Release cleanup should clear stale reservation state.',
                status: 'reserved',
                reservationId: 'uiro-reservation-closed',
                executorJobId: null,
                executorRunId: null,
                createdAt: '2026-03-28T10:01:00.000Z',
                updatedAt: '2026-03-28T10:02:00.000Z',
                queuedAt: null,
              },
            ],
            qualitySignals: [],
            lastAnalyzedAt: null,
            createdAt: '2026-03-28T10:00:00.000Z',
            updatedAt: '2026-03-28T10:02:00.000Z',
            closedAt: '2026-03-28T10:02:00.000Z',
          },
        ],
      });
      const service = createUiRuntimeOverlayService(
        { elegyHome },
        { now: createNowSequence(['2026-03-28T10:03:00.000Z']) }
      );
      const released = service.releaseQueueChangeRequest('overlay-closed', 'cr-closed');
      const releasedAgain = service.releaseQueueChangeRequest('overlay-closed', 'cr-closed');
      assert.equal(released.session.status, 'closed');
      assert.equal(released.changeRequest.status, 'draft');
      assert.equal(released.changeRequest.reservationId, null);
      assert.equal(releasedAgain.session.status, 'closed');
      assert.equal(releasedAgain.changeRequest.status, 'draft');
      assert.equal(releasedAgain.changeRequest.reservationId, null);
      const stored = service.getChangeRequest('overlay-closed', 'cr-closed');
      assert.equal(stored.status, 'draft');
      assert.equal(stored.reservationId, null);
      assert.equal(stored.updatedAt, '2026-03-28T10:03:00.000Z');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('observation creation derives deterministic quality signals and updates lastAnalyzedAt', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      registerSelectedRepo(elegyHome, repoPath);
      const service = createUiRuntimeOverlayService(
        { elegyHome },
        {
          now: createNowSequence([
            '2026-03-28T10:00:00.000Z',
            '2026-03-28T10:01:00.000Z',
            '2026-03-28T10:02:00.000Z',
          ]),
        }
      );
      const session = service.createSession({ runtimeUrl: 'http://127.0.0.1:4173' });
      const first = service.addObservation(session.id, {
        kind: 'interaction',
        summary: 'Save button click did nothing and stayed disabled.',
        locator: { role: 'button', label: 'Save' },
        interaction: {
          action: 'click',
          outcome: 'no-op, still loading spinner after timeout',
          latencyMs: 2200,
        },
        state: {
          kind: 'loading',
          detail: 'blocked and disabled while spinner stayed visible',
        },
      });
      const second = service.addObservation(session.id, {
        kind: 'state',
        summary: 'Orders screen shows an error banner with no results.',
        snapshotSummary: 'Empty state visible after failed fetch.',
        state: {
          kind: 'error',
          detail: 'Failed to load orders and empty state displayed with no items.',
        },
      });
      const stored = service.getSession(session.id);
      const signalKinds = stored.qualitySignals.map((entry) => entry.kind).sort();
      assert.deepEqual(first.qualitySignals.map((entry) => entry.kind).sort(), [
        'blocked-control',
        'inert-control',
        'slow-interaction',
        'stuck-loading',
      ]);
      assert.ok(second.qualitySignals.some((entry) => entry.kind === 'error-state'));
      assert.ok(signalKinds.includes('empty-state'));
      assert.ok(signalKinds.includes('error-state'));
      assert.ok(signalKinds.includes('slow-interaction'));
      assert.equal(stored.lastAnalyzedAt, '2026-03-28T10:02:00.000Z');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('annotation creation persists and links to an observation', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      registerSelectedRepo(elegyHome, repoPath);
      const service = createUiRuntimeOverlayService(
        { elegyHome },
        {
          now: createNowSequence([
            '2026-03-28T10:00:00.000Z',
            '2026-03-28T10:01:00.000Z',
            '2026-03-28T10:02:00.000Z',
          ]),
        }
      );
      const session = service.createSession({ runtimeUrl: 'http://127.0.0.1:4173' });
      const observation = service.addObservation(session.id, {
        kind: 'snapshot',
        summary: 'Checkout form label overlaps the submit button.',
      }).observation;
      const result = service.addAnnotation(session.id, {
        observationId: observation.id,
        title: 'Overlapping label',
        message: 'The shipping label overlaps the primary submit button.',
      });
      const stored = service.getSession(session.id);
      assert.equal(result.annotation.observationId, observation.id);
      assert.equal(result.annotation.title, 'Overlapping label');
      assert.equal(stored.annotations.length, 1);
      assert.equal(stored.annotations[0].message, 'The shipping label overlaps the primary submit button.');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('change request creation builds a default prompt from session, observation, and annotation context', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      registerSelectedRepo(elegyHome, repoPath, 'Storefront App');
      const service = createUiRuntimeOverlayService(
        { elegyHome },
        {
          now: createNowSequence([
            '2026-03-28T10:00:00.000Z',
            '2026-03-28T10:01:00.000Z',
            '2026-03-28T10:02:00.000Z',
            '2026-03-28T10:03:00.000Z',
          ]),
        }
      );
      const session = service.createSession({ runtimeUrl: 'http://127.0.0.1:4173/app' });
      const observation = service.addObservation(session.id, {
        kind: 'interaction',
        summary: 'Primary CTA remains disabled after the form becomes valid.',
        locator: { role: 'button', label: 'Save profile' },
      }).observation;
      const annotation = service.addAnnotation(session.id, {
        observationId: observation.id,
        title: 'CTA never enables',
        message: 'The save profile button does not enable after valid input.',
      }).annotation;
      const result = service.addChangeRequest(session.id, {
        annotationId: annotation.id,
        request: 'Enable the CTA once all required profile fields are valid.',
      });
      assert.equal(result.changeRequest.annotationId, annotation.id);
      assert.equal(result.changeRequest.observationId, observation.id);
      assert.match(result.changeRequest.prompt, /Storefront App/);
      assert.match(result.changeRequest.prompt, /Primary CTA remains disabled/);
      assert.match(result.changeRequest.prompt, /CTA never enables/);
      assert.match(result.changeRequest.prompt, /Enable the CTA once all required profile fields are valid/);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('change request creation rejects non-draft status input', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      registerSelectedRepo(elegyHome, repoPath);
      const service = createUiRuntimeOverlayService(
        { elegyHome },
        { now: createNowSequence(['2026-03-28T10:00:00.000Z']) }
      );
      const session = service.createSession({ runtimeUrl: 'http://127.0.0.1:4173' });
      await assert.rejects(
        Promise.resolve().then(() => service.addChangeRequest(session.id, {
          request: 'Create an impossible queued-on-create change request.',
          status: 'queued',
        })),
        (error) => error && error.statusCode === 400 && /must be draft/i.test(error.message),
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('queueing a change request stores executor job linkage on the persisted change request', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      registerSelectedRepo(elegyHome, repoPath);
      const service = createUiRuntimeOverlayService(
        { elegyHome },
        {
          now: createNowSequence([
            '2026-03-28T10:00:00.000Z',
            '2026-03-28T10:01:00.000Z',
            '2026-03-28T10:02:00.000Z',
            '2026-03-28T10:03:00.000Z',
          ]),
        }
      );
      const session = service.createSession({ runtimeUrl: 'http://127.0.0.1:4173' });
      const changeRequest = service.addChangeRequest(session.id, {
        request: 'Tighten the spacing between the card title and action row.',
      }).changeRequest;
      const reserved = service.reserveQueueChangeRequest(session.id, changeRequest.id);
      const queued = service.queueChangeRequest(session.id, changeRequest.id, {
        reservationId: reserved.changeRequest.reservationId,
        executorJobId: 'job-123',
        executorRunId: 'run-456',
      });
      assert.equal(reserved.changeRequest.status, 'reserved');
      assert.match(reserved.changeRequest.reservationId, /^uiro-reservation-/);
      assert.equal(queued.changeRequest.status, 'queued');
      assert.equal(queued.changeRequest.reservationId, null);
      assert.equal(queued.changeRequest.executorJobId, 'job-123');
      assert.equal(queued.changeRequest.executorRunId, 'run-456');
      assert.equal(queued.changeRequest.queuedAt, '2026-03-28T10:03:00.000Z');
      const stored = service.getChangeRequest(session.id, changeRequest.id);
      assert.equal(stored.reservationId, null);
      assert.equal(stored.executorJobId, 'job-123');
      assert.equal(stored.executorRunId, 'run-456');
      assert.equal(stored.queuedAt, '2026-03-28T10:03:00.000Z');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('queue reservation blocks duplicate queue attempts before final linkage', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      registerSelectedRepo(elegyHome, repoPath);
      const service = createUiRuntimeOverlayService(
        { elegyHome },
        {
          now: createNowSequence([
            '2026-03-28T10:00:00.000Z',
            '2026-03-28T10:01:00.000Z',
            '2026-03-28T10:02:00.000Z',
          ]),
        }
      );
      const session = service.createSession({ runtimeUrl: 'http://127.0.0.1:4173' });
      const changeRequest = service.addChangeRequest(session.id, {
        request: 'Reserve me once and reject the duplicate queue attempt.',
      }).changeRequest;
      service.reserveQueueChangeRequest(session.id, changeRequest.id);
      await assert.rejects(
        Promise.resolve().then(() => service.reserveQueueChangeRequest(session.id, changeRequest.id)),
        (error) => error && error.statusCode === 409 && /already reserved/i.test(error.message),
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('closing a session is blocked while a queue reservation is in progress', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      registerSelectedRepo(elegyHome, repoPath);
      const service = createUiRuntimeOverlayService(
        { elegyHome },
        {
          now: createNowSequence([
            '2026-03-28T10:00:00.000Z',
            '2026-03-28T10:01:00.000Z',
            '2026-03-28T10:02:00.000Z',
          ]),
        }
      );
      const session = service.createSession({ runtimeUrl: 'http://127.0.0.1:4173' });
      const changeRequest = service.addChangeRequest(session.id, {
        request: 'Block close while queue reservation is active.',
      }).changeRequest;
      service.reserveQueueChangeRequest(session.id, changeRequest.id);
      await assert.rejects(
        Promise.resolve().then(() => service.closeSession(session.id)),
        (error) => error && error.statusCode === 409 && /reservation is in progress/i.test(error.message),
      );
      assert.equal(service.getChangeRequest(session.id, changeRequest.id).status, 'reserved');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('queueing rejects change requests that are already queued', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      registerSelectedRepo(elegyHome, repoPath);
      const service = createUiRuntimeOverlayService(
        { elegyHome },
        {
          now: createNowSequence([
            '2026-03-28T10:00:00.000Z',
            '2026-03-28T10:01:00.000Z',
            '2026-03-28T10:02:00.000Z',
          ]),
        }
      );
      const session = service.createSession({ runtimeUrl: 'http://127.0.0.1:4173' });
      const changeRequest = service.addChangeRequest(session.id, {
        request: 'Queue me once and reject the duplicate queue attempt.',
      }).changeRequest;
      const reserved = service.reserveQueueChangeRequest(session.id, changeRequest.id);
      service.queueChangeRequest(session.id, changeRequest.id, {
        reservationId: reserved.changeRequest.reservationId,
        executorJobId: 'job-123',
      });
      await assert.rejects(
        Promise.resolve().then(() => service.queueChangeRequest(session.id, changeRequest.id, {
          reservationId: reserved.changeRequest.reservationId,
          executorJobId: 'job-456',
        })),
        (error) => error && error.statusCode === 409 && /already queued/i.test(error.message),
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('releasing a reservation invalidates the original queue handoff token', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      registerSelectedRepo(elegyHome, repoPath);
      const service = createUiRuntimeOverlayService(
        { elegyHome },
        {
          now: createNowSequence([
            '2026-03-28T10:00:00.000Z',
            '2026-03-28T10:01:00.000Z',
            '2026-03-28T10:02:00.000Z',
            '2026-03-28T10:03:00.000Z',
          ]),
        }
      );
      const session = service.createSession({ runtimeUrl: 'http://127.0.0.1:4173' });
      const changeRequest = service.addChangeRequest(session.id, {
        request: 'Invalidate the old reservation token after release.',
      }).changeRequest;
      const reserved = service.reserveQueueChangeRequest(session.id, changeRequest.id);
      service.releaseQueueChangeRequest(session.id, changeRequest.id);
      await assert.rejects(
        Promise.resolve().then(() => service.queueChangeRequest(session.id, changeRequest.id, {
          reservationId: reserved.changeRequest.reservationId,
          executorJobId: 'job-stale',
        })),
        (error) => error && error.statusCode === 409 && /reservation is no longer active/i.test(error.message),
      );
      const stored = service.getChangeRequest(session.id, changeRequest.id);
      assert.equal(stored.status, 'draft');
      assert.equal(stored.reservationId, null);
      assert.equal(stored.executorJobId, null);
      assert.equal(stored.queuedAt, null);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('state mutations fail safely when the state lock cannot be acquired in time', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    const stateLockPath = `${resolveUiRuntimeOverlayStatePath(elegyHome)}.lock`;
    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      fs.mkdirSync(stateLockPath, { recursive: true });
      registerSelectedRepo(elegyHome, repoPath);
      const service = createUiRuntimeOverlayService(
        { elegyHome },
        {
          stateLockTimeoutMs: 0,
          stateLockRetryDelayMs: 0,
          stateLockStaleMs: 60_000,
        }
      );
      await assert.rejects(
        Promise.resolve().then(() => service.createSession({ runtimeUrl: 'http://127.0.0.1:4173' })),
        (error) => error && error.statusCode === 503 && /state is busy/i.test(error.message),
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('legacy session state normalizes missing overlay collections', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-runtime-overlay-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'selected-repo');
    try {
      fs.mkdirSync(repoPath, { recursive: true });
      writeJson(resolveUiRuntimeOverlayStatePath(elegyHome), {
        version: 1,
        sessions: [
          {
            id: 'overlay-legacy',
            status: 'attached',
            runtimeUrl: 'http://127.0.0.1:4173/',
            repoId: 'repo-legacy',
            repoPath,
            repoLabel: 'Legacy Repo',
            packageRoot: repoPath,
            phase: 'attached',
            evidence: { source: 'copilot-ui', kind: 'runtime-url-registration' },
            createdAt: '2026-03-28T10:00:00.000Z',
            updatedAt: '2026-03-28T10:00:00.000Z',
            closedAt: null,
          },
        ],
      });
      const service = createUiRuntimeOverlayService({ elegyHome });
      const [session] = service.listSessions();
      assert.deepEqual(session.observations, []);
      assert.deepEqual(session.annotations, []);
      assert.deepEqual(session.changeRequests, []);
      assert.deepEqual(session.qualitySignals, []);
      assert.equal(session.lastAnalyzedAt, null);
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
