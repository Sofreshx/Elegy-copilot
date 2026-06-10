#!/usr/bin/env node
/* eslint-disable no-console */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const obsidianNotesLib = require('../lib/obsidianNotes');
const obsidianPlanningRepresentationsLib = require('../lib/obsidianPlanningRepresentations');
const obsidianRemoteSyncLib = require('../lib/obsidianRemoteSync');
const { register } = require('./planning-obsidian');
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
function createResponse() {
  const state = {
    statusCode: null,
    headers: null,
    chunks: [],
  };
  return {
    get statusCode() {
      return state.statusCode;
    },
    get bodyText() {
      return state.chunks.join('');
    },
    writeHead(statusCode, headers) {
      state.statusCode = statusCode;
      state.headers = headers;
    },
    write(chunk) {
      state.chunks.push(String(chunk));
      return true;
    },
    end(chunk) {
      if (chunk != null) {
        state.chunks.push(String(chunk));
      }
    },
  };
}
function parseJsonBody(response) {
  return JSON.parse(response.bodyText || '{}');
}
function findRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;
    if (typeof route.path === 'string' && route.path === pathname) {
      return { route, match: null };
    }
    if (route.path instanceof RegExp) {
      const match = pathname.match(route.path);
      if (match) {
        return { route, match };
      }
    }
  }
  throw new Error(`Route not found for ${method} ${pathname}`);
}
async function invoke(routes, ctx, method, pathname) {
  const u = new URL(`http://127.0.0.1${pathname}`);
  const { route, match } = findRoute(routes, method, u.pathname);
  const res = createResponse();
  const maybePromise = route.handler({
    ...ctx,
    req: { method },
    res,
    u,
    match,
    pathname: u.pathname,
  });
  if (maybePromise && typeof maybePromise.then === 'function') {
    await maybePromise;
  }
  await new Promise((resolve) => setImmediate(resolve));
  return { res };
}
function createFixture() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-planning-obsidian-routes-'));
  const elegyHomeAbs = path.join(tmpRoot, '.elegy');
  const repoPath = path.join(tmpRoot, 'workspace-repo');
  fs.mkdirSync(elegyHomeAbs, { recursive: true });
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  return { tmpRoot, elegyHomeAbs, repoPath };
}
function roadmapSourcePath(repoPath, slug = 'platform-foundation') {
  const filePath = path.join(repoPath, 'docs', 'planning', slug, 'index.md');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return filePath;
}
function createRepoInventory(repoPath) {
  const repo = {
    repoId: 'repo-workspace-repo',
    repoPath,
    repoLabel: 'workspace-repo',
    selected: true,
  };
  return {
    listKnownRepos() {
      return {
        selectedRepo: repo,
        repos: [repo],
      };
    },
    resolveRepoEntry(inventory, selector = {}) {
      if (!selector.repoId && !selector.repoPath) {
        return inventory.selectedRepo;
      }
      return inventory.repos.find((entry) => (
        (selector.repoId && entry.repoId === selector.repoId)
        || (selector.repoPath && entry.repoPath === path.resolve(selector.repoPath))
      )) || null;
    },
  };
}
function createMultiRepoInventory(selectedRepoPath, secondaryRepoPath) {
  const selectedRepo = {
    repoId: 'repo-selected',
    repoPath: selectedRepoPath,
    repoLabel: 'selected-repo',
    selected: true,
  };
  const secondaryRepo = {
    repoId: 'repo-secondary',
    repoPath: secondaryRepoPath,
    repoLabel: 'secondary-repo',
    selected: false,
  };
  return {
    listKnownRepos() {
      return {
        selectedRepo,
        repos: [selectedRepo, secondaryRepo],
      };
    },
    resolveRepoEntry(inventory, selector = {}) {
      if (!selector.repoId && !selector.repoPath) {
        return inventory.selectedRepo;
      }
      return inventory.repos.find((entry) => (
        (selector.repoId && entry.repoId === selector.repoId)
        || (selector.repoPath && entry.repoPath === path.resolve(selector.repoPath))
      )) || null;
    },
  };
}
function createFetchStub(feedPayload) {
  return async () => ({
    ok: true,
    status: 200,
    async json() {
      return feedPayload;
    },
  });
}
function writeRepoLeaseFile(elegyHomeAbs, repo, lease) {
  const leasePath = path.join(
    obsidianRemoteSyncLib.resolveSyncRoot(elegyHomeAbs),
    'leases',
    `${obsidianRemoteSyncLib.deriveRepoSyncKey(repo)}.lock.json`,
  );
  fs.mkdirSync(path.dirname(leasePath), { recursive: true });
  fs.writeFileSync(leasePath, JSON.stringify(lease, null, 2) + '\n', 'utf8');
  return leasePath;
}
async function run() {
  await test('GET /api/planning/obsidian/status returns a deterministic not-configured state when config is absent', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const { res } = await invoke(routes, { elegyHomeAbs }, 'GET', '/api/planning/obsidian/status');
    const body = parseJsonBody(res);
    assert.equal(res.statusCode, 200);
    assert.equal(body.kind, 'planning.obsidian.status');
    assert.equal(body.status.state, 'not-configured');
    assert.equal(body.status.external, true);
    assert.equal(body.status.canonicalAuthority, false);
    assert.equal(body.status.remoteSync.state, 'disabled');
  });
  await test('GET /api/planning/obsidian/notes lists configured markdown notes for the selected catalog repo', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    const notesDir = path.join(vaultPath, 'Planning', 'repo-workspace-repo');
    fs.mkdirSync(notesDir, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
      cliCommands: {
        probe: [process.execPath, '-e', 'process.exit(0)'],
      },
    }, null, 2));
    fs.writeFileSync(path.join(notesDir, 'current-work.md'), [
      '# Current work',
      '',
      'Review the next implementation slice.',
      '',
      '## Follow-ups',
      '- Keep repo docs canonical.',
    ].join('\n'));
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const { res } = await invoke(routes, { elegyHomeAbs }, 'GET', '/api/planning/obsidian/notes');
    const body = parseJsonBody(res);
    assert.equal(res.statusCode, 200);
    assert.equal(body.kind, 'planning.obsidian.notes');
    assert.equal(body.status.state, 'ready');
    assert.equal(body.status.cli.state, 'ready');
    assert.equal(body.count, 1);
    assert.equal(body.notes[0].kind, 'synced-note');
    assert.equal(body.notes[0].provider, 'obsidian');
    assert.equal(body.notes[0].title, 'Current work');
    assert.equal(body.notes[0].summary, 'Review the next implementation slice.');
    assert.deepEqual(body.notes[0].targetRepoIds, ['repo-workspace-repo']);
  });
  await test('GET /api/planning/obsidian/notes excludes reserved planning mirrors even when metadata is malformed', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    const notesDir = path.join(vaultPath, 'Planning', 'repo-workspace-repo');
    const mirrorDir = path.join(notesDir, '_instruction-engine', 'planning-mirrors');
    fs.mkdirSync(mirrorDir, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
    }, null, 2));
    fs.writeFileSync(path.join(notesDir, 'visible-note.md'), '# Visible note\n\nKeep external notes readable.\n');
    fs.writeFileSync(path.join(mirrorDir, 'bullets.md'), [
      '---',
      'ie_kind: not-a-real-kind',
      'ie_representation_id: malformed',
      '---',
      '',
      '# Reserved mirror',
      '',
      'This should stay out of the normal note inventory.',
      '',
    ].join('\n'));
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const { res } = await invoke(routes, { elegyHomeAbs }, 'GET', '/api/planning/obsidian/notes');
    const body = parseJsonBody(res);
    assert.equal(res.statusCode, 200);
    assert.equal(body.count, 1);
    assert.deepEqual(body.notes.map((entry) => entry.title), ['Visible note']);
    assert.equal(body.notes.some((entry) => /planning-mirrors/.test(entry.notePath)), false);
  });
  await test('GET /api/planning/obsidian/notes/:noteId returns deterministic note detail', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    const notesDir = path.join(vaultPath, 'Planning', 'repo-workspace-repo');
    fs.mkdirSync(notesDir, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
    }, null, 2));
    fs.writeFileSync(path.join(notesDir, 'detail-note.md'), [
      '# Detail note',
      '',
      'Capture the external context before promoting anything.',
      '',
      '## Validation',
      '- Keep plan.md authoritative.',
    ].join('\n'));
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const listed = await invoke(routes, { elegyHomeAbs }, 'GET', '/api/planning/obsidian/notes');
    const noteId = parseJsonBody(listed.res).notes[0].id;
    const { res } = await invoke(routes, { elegyHomeAbs }, 'GET', `/api/planning/obsidian/notes/${encodeURIComponent(noteId)}`);
    const body = parseJsonBody(res);
    assert.equal(res.statusCode, 200);
    assert.equal(body.kind, 'planning.obsidian.note.read');
    assert.equal(body.note.title, 'Detail note');
    assert.match(body.note.content, /Capture the external context/);
    assert.deepEqual(body.note.headings, ['Detail note', 'Validation']);
  });
  await test('GET /api/planning/obsidian/notes/:noteId does not surface reserved planning mirrors as synced notes', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    const notesDir = path.join(vaultPath, 'Planning', 'repo-workspace-repo');
    const mirrorPath = path.join(notesDir, '_instruction-engine', 'planning-mirrors', 'bullets.md');
    fs.mkdirSync(path.dirname(mirrorPath), { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
    }, null, 2));
    fs.writeFileSync(mirrorPath, '# Reserved mirror\n\nNormal reads must not return this file.\n');
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const mirrorNoteId = obsidianNotesLib.deriveObsidianNoteId({
      repoId: 'repo-workspace-repo',
      vaultName: 'planning-vault',
      notePath: 'Planning/repo-workspace-repo/_instruction-engine/planning-mirrors/bullets.md',
    });
    const { res } = await invoke(routes, { elegyHomeAbs }, 'GET', `/api/planning/obsidian/notes/${encodeURIComponent(mirrorNoteId)}`);
    const body = parseJsonBody(res);
    assert.equal(res.statusCode, 404);
    assert.equal(body.code, 'obsidian_note_not_found');
  });
  await test('GET /api/planning/obsidian/status requires an explicit repo-scoped source selection even when tracker has a single source', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    const notesDir = path.join(vaultPath, 'Planning', 'repo-workspace-repo');
    fs.mkdirSync(notesDir, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
      remoteSyncUrl: 'https://notes.example.test/feed?sourceId={sourceId}',
    }, null, 2));
    const source = {
      id: 'snsrc_0123456789abcdef0123456789abcdef',
      provider: 'github',
      host: 'github.com',
      owner: 'InstructionEngine',
      repo: 'workspace',
      branch: 'main',
      notesPath: 'docs/planning/synced-note.md',
    };
    const routes = register({
      listTrackerSyncedNoteSources: async () => [source],
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const { res } = await invoke(routes, { elegyHomeAbs }, 'GET', '/api/planning/obsidian/status');
    const body = parseJsonBody(res);
    assert.equal(res.statusCode, 200);
    assert.equal(body.kind, 'planning.obsidian.status');
    assert.equal(body.status.state, 'ready');
    assert.equal(body.status.syncAvailable, false);
    assert.deepEqual(body.status.sourceResolution.availableSources, [source]);
    assert.equal(body.status.sourceResolution.activeSourceConfigured, false);
    assert.equal(body.status.sourceResolution.requiresSource, true);
    assert.equal(body.status.sourceResolution.resolved, false);
    assert.equal(body.status.sourceResolution.reason, 'explicit_source_selection_required');
    assert.match(body.status.sourceResolution.message, /explicitly select/i);
    assert.equal(body.status.sourceResolution.effectiveSource, null);
  });
  await test('GET /api/planning/obsidian/status surfaces additive remoteSync lease and retry metadata without breaking existing fields', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    fs.mkdirSync(path.join(vaultPath, 'Planning', 'repo-workspace-repo'), { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
      remoteSyncUrl: 'https://notes.example.test/feed',
    }, null, 2));
    const activeLease = {
      token: 'lease-active',
      acquiredAt: '2026-03-24T12:00:00.000Z',
      expiresAt: '2026-03-24T12:01:00.000Z',
      trigger: 'timer',
    };
    const repo = {
      repoId: 'repo-workspace-repo',
      repoPath,
      repoLabel: 'workspace-repo',
    };
    const config = {
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
      remoteSyncUrl: 'https://notes.example.test/feed',
      remoteSyncPollIntervalMs: 60_000,
      remoteSyncTimeoutMs: 15_000,
    };
    const repoState = obsidianRemoteSyncLib.readRepoSyncState({
      elegyHomeAbs,
      repo,
      config,
    });
    obsidianRemoteSyncLib.writeRepoSyncState({
      elegyHomeAbs,
      repo,
      state: {
        ...repoState,
        syncLease: activeLease,
        summary: {
          ...repoState.summary,
          state: 'error',
          syncing: true,
          message: 'Timer-based Obsidian sync poll is running.',
          reason: 'timer_backoff_scheduled',
          retryCount: 2,
          retryLimit: 4,
          nextAttemptAt: '2026-03-24T12:02:00.000Z',
          cooldownUntil: '2026-03-24T12:02:00.000Z',
          lastFailureAt: '2026-03-24T11:59:00.000Z',
          lastFailureReason: 'network_down',
          leaseAcquiredAt: activeLease.acquiredAt,
          leaseExpiresAt: activeLease.expiresAt,
          leaseTrigger: activeLease.trigger,
          lastStaleLeaseRecoveredAt: '2026-03-24T11:30:00.000Z',
        },
      },
    });
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const { res } = await invoke(routes, { elegyHomeAbs }, 'GET', '/api/planning/obsidian/status');
    const body = parseJsonBody(res);
    assert.equal(res.statusCode, 200);
    assert.equal(body.status.remoteSync.state, 'error');
    assert.equal(body.status.remoteSync.reason, 'timer_backoff_scheduled');
    assert.equal(body.status.remoteSync.retryCount, 2);
    assert.equal(body.status.remoteSync.retryLimit, 4);
    assert.equal(body.status.remoteSync.nextAttemptAt, '2026-03-24T12:02:00.000Z');
    assert.equal(body.status.remoteSync.cooldownUntil, '2026-03-24T12:02:00.000Z');
    assert.equal(body.status.remoteSync.lastFailureReason, 'network_down');
    assert.equal(body.status.remoteSync.leaseAcquiredAt, activeLease.acquiredAt);
    assert.equal(body.status.remoteSync.leaseExpiresAt, activeLease.expiresAt);
    assert.equal(body.status.remoteSync.leaseTrigger, activeLease.trigger);
    assert.equal(body.status.remoteSync.lastStaleLeaseRecoveredAt, '2026-03-24T11:30:00.000Z');
  });
  await test('POST /api/planning/obsidian/source-selection persists repo-scoped active source selection under obsidian sync runtime state', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    const notesDir = path.join(vaultPath, 'Planning', 'repo-workspace-repo');
    fs.mkdirSync(notesDir, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
      remoteSyncUrl: 'https://notes.example.test/feed?sourceId={sourceId}',
    }, null, 2));
    const sources = [
      {
        id: 'snsrc_0123456789abcdef0123456789abcdef',
        provider: 'github',
        host: 'github.com',
        owner: 'InstructionEngine',
        repo: 'workspace',
        branch: 'main',
        notesPath: 'docs/planning/first.md',
      },
      {
        id: 'snsrc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        provider: 'github',
        host: 'github.com',
        owner: 'InstructionEngine',
        repo: 'workspace',
        branch: 'main',
        notesPath: 'docs/planning/second.md',
      },
    ];
    const routes = register({
      listTrackerSyncedNoteSources: async () => sources,
      readJsonBody: async () => ({
        repoId: 'repo-workspace-repo',
        sourceId: sources[1].id,
      }),
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const selection = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/source-selection');
    const selectionBody = parseJsonBody(selection.res);
    const repoState = obsidianRemoteSyncLib.readRepoSyncState({
      elegyHomeAbs,
      repo: {
        repoId: 'repo-workspace-repo',
        repoPath,
        repoLabel: 'workspace-repo',
      },
      config: {
        vaultPath,
        notesPathTemplate: 'Planning/{repoId}',
        remoteSyncUrl: 'https://notes.example.test/feed?sourceId={sourceId}',
      },
    });
    assert.equal(selection.res.statusCode, 200);
    assert.equal(selectionBody.kind, 'planning.obsidian.source-selection');
    assert.equal(selectionBody.status.sourceResolution.activeSourceConfigured, true);
    assert.equal(selectionBody.status.sourceResolution.activeSourceId, sources[1].id);
    assert.equal(selectionBody.status.sourceResolution.activeSourceMatched, true);
    assert.equal(selectionBody.status.sourceResolution.reason, 'active_source_selected');
    assert.deepEqual(selectionBody.status.sourceResolution.effectiveSource, sources[1]);
    assert.equal(repoState.sourceSelection.activeSourceId, sources[1].id);
  });
  await test('POST /api/planning/obsidian/sync pulls remote note changes and records sync status', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    const remoteContent = '# Daily sync\n\nPulled from the remote feed.';
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
      remoteSyncUrl: 'https://vultr.example.test/notes-feed',
      cliCommands: {
        refreshInventory: [process.execPath, '-e', 'process.exit(0)'],
      },
    }, null, 2));
    const routes = register({
      fetch: createFetchStub({
        nextCursor: 'cursor-002',
        notes: [
          {
            notePath: 'daily-sync.md',
            content: remoteContent,
            sha256: obsidianNotesLib.hashContent(remoteContent),
            lastModifiedAt: '2026-03-23T10:00:00.000Z',
          },
        ],
      }),
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const { res } = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/sync');
    const body = parseJsonBody(res);
    assert.equal(res.statusCode, 200);
    assert.equal(body.kind, 'planning.obsidian.sync');
    assert.equal(body.result.state, 'success');
    assert.equal(body.result.appliedCount, 1);
    assert.equal(body.status.remoteSync.state, 'success');
    assert.equal(body.status.remoteSync.cursor, 'cursor-002');
    assert.equal(body.status.remoteSync.retryCount, 0);
    assert.equal(body.result.retryCount, 0);
    assert.equal(body.result.retryLimit, 4);
    assert.equal(typeof body.status.remoteSync.nextAttemptAt, 'string');
    assert.equal(typeof body.result.nextAttemptAt, 'string');
    assert.equal(typeof body.result.cooldownUntil, 'string');
    const notePath = path.join(vaultPath, 'Planning', 'repo-workspace-repo', 'daily-sync.md');
    assert.equal(fs.existsSync(notePath), true);
    assert.match(fs.readFileSync(notePath, 'utf8'), /Pulled from the remote feed/);
    const repoState = obsidianRemoteSyncLib.readRepoSyncState({
      elegyHomeAbs,
      repo: {
        repoId: 'repo-workspace-repo',
        repoPath,
        repoLabel: 'workspace-repo',
      },
      config: {
        vaultPath,
        notesPathTemplate: 'Planning/{repoId}',
        remoteSyncUrl: 'https://vultr.example.test/notes-feed',
      },
    });
    assert.equal(
      repoState.noteStates['daily-sync.md'].remoteHash,
      obsidianNotesLib.hashContent(fs.readFileSync(notePath, 'utf8')),
    );
  });
  await test('POST /api/planning/obsidian/sync surfaces active lease metadata when another process already holds the repo lease', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const repo = {
      repoId: 'repo-workspace-repo',
      repoPath,
      repoLabel: 'workspace-repo',
    };
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    const config = {
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
      remoteSyncUrl: 'https://vultr.example.test/notes-feed',
      remoteSyncTimeoutMs: 15_000,
    };
    const activeLease = {
      token: 'lease-active-route',
      acquiredAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      trigger: 'timer',
    };
    fs.mkdirSync(path.join(vaultPath, 'Planning', 'repo-workspace-repo'), { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify(config, null, 2));
    const repoState = obsidianRemoteSyncLib.readRepoSyncState({
      elegyHomeAbs,
      repo,
      config,
    });
    obsidianRemoteSyncLib.writeRepoSyncState({
      elegyHomeAbs,
      repo,
      state: {
        ...repoState,
        syncLease: activeLease,
        summary: {
          ...repoState.summary,
          state: 'syncing',
          syncing: true,
          message: 'Timer-based Obsidian sync poll is running.',
          leaseAcquiredAt: activeLease.acquiredAt,
          leaseExpiresAt: activeLease.expiresAt,
          leaseTrigger: activeLease.trigger,
        },
      },
    });
    writeRepoLeaseFile(elegyHomeAbs, repo, activeLease);
    let fetchCount = 0;
    const routes = register({
      fetch: async () => {
        fetchCount += 1;
        return {
          ok: true,
          status: 200,
          async json() {
            return { notes: [] };
          },
        };
      },
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const { res } = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/sync');
    const body = parseJsonBody(res);
    assert.equal(res.statusCode, 200);
    assert.equal(body.kind, 'planning.obsidian.sync');
    assert.equal(body.result.state, 'syncing');
    assert.equal(body.result.reason, 'lease_active');
    assert.equal(body.result.leaseAcquiredAt, activeLease.acquiredAt);
    assert.equal(body.result.leaseExpiresAt, activeLease.expiresAt);
    assert.equal(body.result.leaseTrigger, activeLease.trigger);
    assert.equal(body.status.remoteSync.leaseExpiresAt, activeLease.expiresAt);
    assert.equal(fetchCount, 0);
  });
  await test('POST /api/planning/obsidian/sync fails closed when remote sync requires a source and multiple tracker sources remain unresolved', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    fs.mkdirSync(path.join(vaultPath, 'Planning', 'repo-workspace-repo'), { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
      remoteSyncUrl: 'https://notes.example.test/feed?sourceId={sourceId}',
    }, null, 2));
    const sources = [
      {
        id: 'snsrc_0123456789abcdef0123456789abcdef',
        provider: 'github',
        host: 'github.com',
        owner: 'InstructionEngine',
        repo: 'workspace',
        branch: 'main',
        notesPath: 'docs/planning/first.md',
      },
      {
        id: 'snsrc_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        provider: 'github',
        host: 'github.com',
        owner: 'InstructionEngine',
        repo: 'workspace',
        branch: 'main',
        notesPath: 'docs/planning/second.md',
      },
    ];
    let remoteFetchCount = 0;
    const routes = register({
      fetch: async () => {
        remoteFetchCount += 1;
        return {
          ok: true,
          status: 200,
          async json() {
            return { notes: [] };
          },
        };
      },
      listTrackerSyncedNoteSources: async () => sources,
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const { res } = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/sync');
    const body = parseJsonBody(res);
    assert.equal(res.statusCode, 200);
    assert.equal(body.kind, 'planning.obsidian.sync');
    assert.equal(body.result.state, 'error');
    assert.equal(body.result.appliedCount, 0);
    assert.equal(body.result.conflictCount, 0);
    assert.match(body.result.message, /requires a resolved synced-note source/i);
    assert.equal(body.status.syncAvailable, false);
    assert.equal(body.status.sourceResolution.reason, 'explicit_source_selection_required');
    assert.match(body.status.sourceResolution.message, /explicitly select/i);
    assert.equal(remoteFetchCount, 0);
  });
  await test('POST /api/planning/obsidian/sync fails closed when a previously synced local note was deleted before a remote update arrives', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    const notePath = path.join(vaultPath, 'Planning', 'repo-workspace-repo', 'daily-sync.md');
    const initialContent = '# Daily sync\n\nBaseline remote content.';
    const updatedContent = '# Daily sync\n\nUpdated remote content that must not recreate a deleted local note.';
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
      remoteSyncUrl: 'https://vultr.example.test/notes-feed',
    }, null, 2));
    const initialRoutes = register({
      fetch: createFetchStub({
        nextCursor: 'cursor-baseline',
        notes: [
          {
            notePath: 'daily-sync.md',
            content: initialContent,
            sha256: obsidianNotesLib.hashContent(initialContent),
            lastModifiedAt: '2026-03-23T09:00:00.000Z',
          },
        ],
      }),
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const initialSync = await invoke(initialRoutes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/sync');
    const initialBody = parseJsonBody(initialSync.res);
    assert.equal(initialSync.res.statusCode, 200);
    assert.equal(initialBody.result.state, 'success');
    assert.equal(fs.existsSync(notePath), true);
    fs.unlinkSync(notePath);
    assert.equal(fs.existsSync(notePath), false);
    const updateRoutes = register({
      fetch: createFetchStub({
        nextCursor: 'cursor-updated',
        notes: [
          {
            notePath: 'daily-sync.md',
            content: updatedContent,
            sha256: obsidianNotesLib.hashContent(updatedContent),
            lastModifiedAt: '2026-03-23T10:00:00.000Z',
          },
        ],
      }),
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const updatedSync = await invoke(updateRoutes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/sync');
    const updatedBody = parseJsonBody(updatedSync.res);
    const repoState = obsidianRemoteSyncLib.readRepoSyncState({
      elegyHomeAbs,
      repo: {
        repoId: 'repo-workspace-repo',
        repoPath,
        repoLabel: 'workspace-repo',
      },
      config: {
        vaultPath,
        notesPathTemplate: 'Planning/{repoId}',
        remoteSyncUrl: 'https://vultr.example.test/notes-feed',
      },
    });
    assert.equal(updatedSync.res.statusCode, 200);
    assert.equal(updatedBody.kind, 'planning.obsidian.sync');
    assert.equal(updatedBody.result.state, 'conflict');
    assert.equal(updatedBody.result.conflictCount, 1);
    assert.deepEqual(updatedBody.result.conflicts, ['daily-sync.md']);
    assert.equal(updatedBody.status.remoteSync.state, 'conflict');
    assert.equal(fs.existsSync(notePath), false);
    assert.equal(repoState.cursor, 'cursor-baseline');
    assert.equal(
      repoState.noteStates['daily-sync.md'].remoteHash,
      obsidianNotesLib.hashContent(initialContent),
    );
  });
  await test('POST /api/planning/obsidian/sync rejects malformed remote entries without blanking previously synced local notes', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    const notePath = path.join(vaultPath, 'Planning', 'repo-workspace-repo', 'daily-sync.md');
    const initialContent = '# Daily sync\n\nBaseline remote content that must survive malformed updates.';
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
      remoteSyncUrl: 'https://vultr.example.test/notes-feed',
    }, null, 2));
    const initialRoutes = register({
      fetch: createFetchStub({
        nextCursor: 'cursor-baseline',
        notes: [
          {
            notePath: 'daily-sync.md',
            content: initialContent,
            sha256: obsidianNotesLib.hashContent(initialContent),
            lastModifiedAt: '2026-03-23T09:00:00.000Z',
          },
        ],
      }),
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const initialSync = await invoke(initialRoutes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/sync');
    assert.equal(initialSync.res.statusCode, 200);
    assert.equal(fs.readFileSync(notePath, 'utf8'), initialContent);
    const malformedRoutes = register({
      fetch: createFetchStub({
        nextCursor: 'cursor-malformed',
        notes: [
          {
            notePath: 'daily-sync.md',
            content: { invalid: true },
            lastModifiedAt: '2026-03-23T10:00:00.000Z',
          },
        ],
      }),
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const malformedSync = await invoke(malformedRoutes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/sync');
    const malformedBody = parseJsonBody(malformedSync.res);
    const repoState = obsidianRemoteSyncLib.readRepoSyncState({
      elegyHomeAbs,
      repo: {
        repoId: 'repo-workspace-repo',
        repoPath,
        repoLabel: 'workspace-repo',
      },
      config: {
        vaultPath,
        notesPathTemplate: 'Planning/{repoId}',
        remoteSyncUrl: 'https://vultr.example.test/notes-feed',
      },
    });
    assert.equal(malformedSync.res.statusCode, 200);
    assert.equal(malformedBody.kind, 'planning.obsidian.sync');
    assert.equal(malformedBody.result.state, 'conflict');
    assert.equal(malformedBody.result.conflictCount, 1);
    assert.deepEqual(malformedBody.result.conflicts, ['daily-sync.md']);
    assert.match(malformedBody.result.message, /must include string content/i);
    assert.equal(malformedBody.status.remoteSync.state, 'conflict');
    assert.equal(fs.readFileSync(notePath, 'utf8'), initialContent);
    assert.equal(repoState.cursor, 'cursor-baseline');
    assert.equal(
      repoState.noteStates['daily-sync.md'].remoteHash,
      obsidianNotesLib.hashContent(initialContent),
    );
  });
  await test('POST /api/planning/obsidian/sync revalidates all targeted notes immediately before apply and leaves the vault unchanged on concurrent drift', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    const firstNotePath = path.join(vaultPath, 'Planning', 'repo-workspace-repo', 'alpha.md');
    const secondNotePath = path.join(vaultPath, 'Planning', 'repo-workspace-repo', 'beta.md');
    const initialAlpha = '# Alpha\n\nInitial remote content.';
    const initialBeta = '# Beta\n\nInitial remote content.';
    const updatedAlpha = '# Alpha\n\nUpdated remote content.';
    const updatedBeta = '# Beta\n\nUpdated remote content.';
    const concurrentLocalBeta = '# Beta\n\nConcurrent local edit that must block the batch.';
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
      remoteSyncUrl: 'https://vultr.example.test/notes-feed',
    }, null, 2));
    const initialRoutes = register({
      fetch: createFetchStub({
        nextCursor: 'cursor-initial',
        notes: [
          {
            notePath: 'alpha.md',
            content: initialAlpha,
            sha256: obsidianNotesLib.hashContent(initialAlpha),
            lastModifiedAt: '2026-03-23T09:00:00.000Z',
          },
          {
            notePath: 'beta.md',
            content: initialBeta,
            sha256: obsidianNotesLib.hashContent(initialBeta),
            lastModifiedAt: '2026-03-23T09:05:00.000Z',
          },
        ],
      }),
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const initialSync = await invoke(initialRoutes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/sync');
    assert.equal(initialSync.res.statusCode, 200);
    assert.equal(fs.readFileSync(firstNotePath, 'utf8'), initialAlpha);
    assert.equal(fs.readFileSync(secondNotePath, 'utf8'), initialBeta);
    const originalWriteFileSync = fs.writeFileSync;
    let injectedConcurrentDrift = false;
    try {
      fs.writeFileSync = function patchedWriteFileSync(filePath, ...args) {
        const normalizedPath = typeof filePath === 'string' ? path.resolve(filePath) : filePath;
        const basename = typeof normalizedPath === 'string' ? path.basename(normalizedPath) : '';
        if (!injectedConcurrentDrift && basename.startsWith('.alpha.md.') && basename.endsWith('.tmp')) {
          injectedConcurrentDrift = true;
          originalWriteFileSync.call(fs, secondNotePath, concurrentLocalBeta, 'utf8');
        }
        return originalWriteFileSync.call(fs, filePath, ...args);
      };
      const updateRoutes = register({
        fetch: createFetchStub({
          nextCursor: 'cursor-updated',
          notes: [
            {
              notePath: 'alpha.md',
              content: updatedAlpha,
              sha256: obsidianNotesLib.hashContent(updatedAlpha),
              lastModifiedAt: '2026-03-23T10:00:00.000Z',
            },
            {
              notePath: 'beta.md',
              content: updatedBeta,
              sha256: obsidianNotesLib.hashContent(updatedBeta),
              lastModifiedAt: '2026-03-23T10:05:00.000Z',
            },
          ],
        }),
        repoInventory: createRepoInventory(repoPath),
        sendJson(res, code, payload) {
          res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(payload, null, 2));
        },
      });
      const updatedSync = await invoke(updateRoutes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/sync');
      const updatedBody = parseJsonBody(updatedSync.res);
      const repoState = obsidianRemoteSyncLib.readRepoSyncState({
        elegyHomeAbs,
        repo: {
          repoId: 'repo-workspace-repo',
          repoPath,
          repoLabel: 'workspace-repo',
        },
        config: {
          vaultPath,
          notesPathTemplate: 'Planning/{repoId}',
          remoteSyncUrl: 'https://vultr.example.test/notes-feed',
        },
      });
      assert.equal(updatedSync.res.statusCode, 200);
      assert.equal(updatedBody.kind, 'planning.obsidian.sync');
      assert.equal(updatedBody.result.state, 'conflict');
      assert.equal(updatedBody.result.conflictCount, 1);
      assert.deepEqual(updatedBody.result.conflicts, ['beta.md']);
      assert.equal(updatedBody.status.remoteSync.state, 'conflict');
      assert.equal(fs.readFileSync(firstNotePath, 'utf8'), initialAlpha);
      assert.equal(fs.readFileSync(secondNotePath, 'utf8'), concurrentLocalBeta);
      assert.equal(repoState.cursor, 'cursor-initial');
      assert.equal(repoState.noteStates['alpha.md'].remoteHash, obsidianNotesLib.hashContent(initialAlpha));
      assert.equal(repoState.noteStates['beta.md'].remoteHash, obsidianNotesLib.hashContent(initialBeta));
    } finally {
      fs.writeFileSync = originalWriteFileSync;
    }
  });
  await test('POST /api/planning/obsidian/sync fails closed when feed sha256 does not match remote content', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
      remoteSyncUrl: 'https://vultr.example.test/notes-feed',
    }, null, 2));
    const routes = register({
      fetch: createFetchStub({
        nextCursor: 'cursor-bad-sha',
        notes: [
          {
            notePath: 'daily-sync.md',
            content: '# Daily sync\n\nUntrusted remote content.',
            sha256: 'not-the-real-sha',
            lastModifiedAt: '2026-03-23T10:00:00.000Z',
          },
        ],
      }),
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const { res } = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/sync');
    const body = parseJsonBody(res);
    const notePath = path.join(vaultPath, 'Planning', 'repo-workspace-repo', 'daily-sync.md');
    const repoState = obsidianRemoteSyncLib.readRepoSyncState({
      elegyHomeAbs,
      repo: {
        repoId: 'repo-workspace-repo',
        repoPath,
        repoLabel: 'workspace-repo',
      },
      config: {
        vaultPath,
        notesPathTemplate: 'Planning/{repoId}',
        remoteSyncUrl: 'https://vultr.example.test/notes-feed',
      },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(body.kind, 'planning.obsidian.sync');
    assert.equal(body.result.state, 'conflict');
    assert.equal(body.result.conflictCount, 1);
    assert.deepEqual(body.result.conflicts, ['daily-sync.md']);
    assert.match(body.result.message, /sha256/i);
    assert.equal(body.status.remoteSync.state, 'conflict');
    assert.equal(body.status.remoteSync.cursor, undefined);
    assert.equal(fs.existsSync(notePath), false);
    assert.equal(repoState.cursor, undefined);
    assert.deepEqual(repoState.noteStates, {});
  });
  await test('POST /api/planning/obsidian/sync rejects remote changes targeting the protected tool-managed namespace', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
      remoteSyncUrl: 'https://vultr.example.test/notes-feed',
    }, null, 2));
    const routes = register({
      fetch: createFetchStub({
        nextCursor: 'cursor-protected',
        notes: [
          {
            notePath: '_instruction-engine/planning-mirrors/bullets.md',
            content: '# Reserved mirror overwrite',
            lastModifiedAt: '2026-03-23T10:00:00.000Z',
          },
        ],
      }),
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const { res } = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/sync');
    const body = parseJsonBody(res);
    const protectedMirrorPath = path.join(
      vaultPath,
      'Planning',
      'repo-workspace-repo',
      '_instruction-engine',
      'planning-mirrors',
      'bullets.md',
    );
    assert.equal(res.statusCode, 200);
    assert.equal(body.kind, 'planning.obsidian.sync');
    assert.equal(body.result.state, 'conflict');
    assert.equal(body.result.conflictCount, 1);
    assert.deepEqual(body.result.conflicts, ['_instruction-engine/planning-mirrors/bullets.md']);
    assert.match(body.result.message, /tool-managed/i);
    assert.equal(body.status.remoteSync.state, 'conflict');
    assert.equal(fs.existsSync(protectedMirrorPath), false);
  });
  await test('POST /api/planning/obsidian/sync requires repoId-gated mutation targeting while GET routes still honor read-context repoPath selectors', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const otherRepoPath = path.join(path.dirname(repoPath), 'secondary-repo');
    const inventory = createMultiRepoInventory(repoPath, otherRepoPath);
    fs.mkdirSync(path.join(otherRepoPath, '.git'), { recursive: true });
    const routes = register({
      repoInventory: inventory,
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const readResult = await invoke(
      routes,
      { elegyHomeAbs },
      'GET',
      `/api/planning/obsidian/status?repoPath=${encodeURIComponent(otherRepoPath)}`,
    );
    const syncResult = await invoke(
      routes,
      { elegyHomeAbs },
      'POST',
      `/api/planning/obsidian/sync?repoPath=${encodeURIComponent(otherRepoPath)}`,
    );
    const readBody = parseJsonBody(readResult.res);
    const syncBody = parseJsonBody(syncResult.res);
    assert.equal(readResult.res.statusCode, 200);
    assert.equal(readBody.repo.repoId, 'repo-secondary');
    assert.equal(syncResult.res.statusCode, 409);
    assert.equal(syncBody.code, 'catalog_repo_id_required_for_mutation');
  });
  await test('GET /api/planning/obsidian/representations lists deterministic planning mirrors with freshness state', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
    }, null, 2));
    fs.mkdirSync(path.join(repoPath, 'docs', 'planning'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'docs', 'planning', 'bullets.md'), [
      '# Planning Bullets',
      '',
      'Repository-scoped bullet seeds for future planning sessions.',
      '',
      '## PB-001 — Clarify mirror authority',
      '- State: idea',
      '- Repo: repo-workspace-repo',
      '- Summary: Keep repo docs canonical.',
      '- Notes:',
      '  - Mirror notes stay external.',
      '- Promoted to plan: none',
      '- Promoted to backlog: none',
      '',
    ].join('\n'));
    fs.writeFileSync(roadmapSourcePath(repoPath), [
      '---',
      'doc_kind: roadmap',
      'roadmap_slug: platform-foundation',
      'title: Platform Foundation',
      'version: 1',
      '---',
      '',
      '# Platform Foundation',
      '',
      '## Overview',
      'Stage repo planning work into phased outcomes.',
      '',
      '## Roadmap Items',
      '### RM-platform-foundation-001 — Establish mirror workflow',
      '- Phase: foundation',
      '- Status: planned',
      '- Summary: Mirror canonical roadmaps into Obsidian safely.',
      '- Backlog IDs: RB-001',
      '- Plan Refs: none',
      '- Satisfied By Plan Ref: none',
      '- Superseded By Plan Ref: none',
      '- Abandoned By Plan Ref: none',
      '',
    ].join('\n'));
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const { res } = await invoke(routes, { elegyHomeAbs }, 'GET', '/api/planning/obsidian/representations');
    const body = parseJsonBody(res);
    assert.equal(res.statusCode, 200);
    assert.equal(body.kind, 'planning.obsidian.representations');
    assert.equal(body.count, 2);
    assert.equal(body.representationsStatus.missingCount, 2);
    assert.deepEqual(
      body.representations.map((entry) => entry.representationKind),
      ['bullets', 'roadmap'],
    );
    assert.equal(body.representations[0].external, true);
    assert.equal(body.representations[0].canonicalAuthority, false);
  });
  await test('GET /api/planning/obsidian/representations keeps orphaned roadmap mirrors visible as source-missing after the canonical source is removed', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    const roadmapSourcePathValue = roadmapSourcePath(repoPath);
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
    }, null, 2));
    fs.mkdirSync(path.join(repoPath, 'docs', 'planning'), { recursive: true });
    fs.mkdirSync(path.dirname(roadmapSourcePathValue), { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'docs', 'planning', 'bullets.md'), [
      '# Planning Bullets',
      '',
      'Repository-scoped bullet seeds for future planning sessions.',
      '',
      '## PB-001 — Preserve orphaned mirrors',
      '- State: idea',
      '- Repo: repo-workspace-repo',
      '- Summary: Existing roadmap mirrors should stay visible when the canonical source disappears.',
      '- Notes:',
      '  - Keep the orphaned mirror read-only until the source returns.',
      '- Promoted to plan: none',
      '- Promoted to backlog: none',
      '',
    ].join('\n'));
    fs.writeFileSync(roadmapSourcePathValue, [
      '---',
      'doc_kind: roadmap',
      'roadmap_slug: platform-foundation',
      'title: Platform Foundation',
      'version: 1',
      '---',
      '',
      '# Platform Foundation',
      '',
      '## Overview',
      'Keep previously generated mirrors visible when their canonical source is removed.',
      '',
      '## Roadmap Items',
      '### RM-platform-foundation-001 — Preserve orphaned mirror visibility',
      '- Phase: foundation',
      '- Status: planned',
      '- Summary: Surface orphaned roadmap mirrors as source-missing.',
      '- Backlog IDs: RB-001',
      '- Plan Refs: none',
      '- Satisfied By Plan Ref: none',
      '- Superseded By Plan Ref: none',
      '- Abandoned By Plan Ref: none',
      '',
    ].join('\n'));
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      readJsonBody: async () => ({}),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const initialRefresh = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
    const initialRefreshBody = parseJsonBody(initialRefresh.res);
    assert.equal(initialRefresh.res.statusCode, 200);
    assert.equal(initialRefreshBody.result.refreshedCount, 2);
    const roadmapMirrorPath = path.join(
      vaultPath,
      'Planning',
      'repo-workspace-repo',
      '_instruction-engine',
      'planning-mirrors',
      'roadmaps',
      'platform-foundation.md',
    );
    const orphanedMirrorContent = fs.readFileSync(roadmapMirrorPath, 'utf8');
    fs.unlinkSync(roadmapSourcePathValue);
    assert.equal(fs.existsSync(roadmapSourcePathValue), false);
    const listed = await invoke(routes, { elegyHomeAbs }, 'GET', '/api/planning/obsidian/representations');
    const listedBody = parseJsonBody(listed.res);
    const roadmapRepresentation = listedBody.representations.find((entry) => entry.representationKind === 'roadmap');
    assert.equal(listed.res.statusCode, 200);
    assert.equal(listedBody.count, 2);
    assert.ok(roadmapRepresentation);
    assert.equal(roadmapRepresentation.sourceExists, false);
    assert.equal(roadmapRepresentation.noteExists, true);
    assert.equal(roadmapRepresentation.freshness, 'source-missing');
    assert.match(roadmapRepresentation.message, /source file is missing/i);
    const refreshAfterDelete = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
    const refreshAfterDeleteBody = parseJsonBody(refreshAfterDelete.res);
    const refreshedRoadmapRepresentation = refreshAfterDeleteBody.representations.find((entry) => entry.representationKind === 'roadmap');
    assert.equal(refreshAfterDelete.res.statusCode, 200);
    assert.equal(refreshAfterDeleteBody.result.refreshedCount, 0);
    assert.equal(refreshAfterDeleteBody.representationsStatus.sourceMissingCount, 1);
    assert.ok(refreshAfterDeleteBody.result.skippedIds.includes(refreshedRoadmapRepresentation.id));
    assert.equal(refreshedRoadmapRepresentation.sourceExists, false);
    assert.equal(refreshedRoadmapRepresentation.freshness, 'source-missing');
    assert.equal(fs.readFileSync(roadmapMirrorPath, 'utf8'), orphanedMirrorContent);
  });
  await test('POST /api/planning/obsidian/representations/refresh writes deterministic mirrors from canonical planning docs', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
    }, null, 2));
    fs.mkdirSync(path.join(repoPath, 'docs', 'planning'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'docs', 'planning', 'bullets.md'), [
      '# Planning Bullets',
      '',
      'Repository-scoped bullet seeds for future planning sessions.',
      '',
      '## PB-001 — Clarify mirror authority',
      '- State: idea',
      '- Repo: repo-workspace-repo',
      '- Summary: Keep repo docs canonical.',
      '- Notes:',
      '  - Mirror notes stay external.',
      '- Promoted to plan: none',
      '- Promoted to backlog: none',
      '',
    ].join('\n'));
    fs.writeFileSync(roadmapSourcePath(repoPath), [
      '---',
      'doc_kind: roadmap',
      'roadmap_slug: platform-foundation',
      'title: Platform Foundation',
      'version: 1',
      '---',
      '',
      '# Platform Foundation',
      '',
      '## Overview',
      'Stage repo planning work into phased outcomes.',
      '',
      '## Roadmap Items',
      '### RM-platform-foundation-001 — Establish mirror workflow',
      '- Phase: foundation',
      '- Status: planned',
      '- Summary: Mirror canonical roadmaps into Obsidian safely.',
      '- Backlog IDs: RB-001',
      '- Plan Refs: none',
      '- Satisfied By Plan Ref: none',
      '- Superseded By Plan Ref: none',
      '- Abandoned By Plan Ref: none',
      '',
    ].join('\n'));
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      readJsonBody: async () => ({}),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const refreshed = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
    const refreshBody = parseJsonBody(refreshed.res);
    assert.equal(refreshed.res.statusCode, 200);
    assert.equal(refreshBody.kind, 'planning.obsidian.representations.refresh');
    assert.equal(refreshBody.result.refreshedCount, 2);
    assert.equal(refreshBody.representationsStatus.currentCount, 2);
    const bulletsMirrorPath = path.join(
      vaultPath,
      'Planning',
      'repo-workspace-repo',
      '_instruction-engine',
      'planning-mirrors',
      'bullets.md',
    );
    const roadmapMirrorPath = path.join(
      vaultPath,
      'Planning',
      'repo-workspace-repo',
      '_instruction-engine',
      'planning-mirrors',
      'roadmaps',
      'platform-foundation.md',
    );
    assert.equal(fs.existsSync(bulletsMirrorPath), true);
    assert.equal(fs.existsSync(roadmapMirrorPath), true);
    assert.match(fs.readFileSync(bulletsMirrorPath, 'utf8'), /ie_kind: planning-obsidian-representation/);
    assert.match(fs.readFileSync(bulletsMirrorPath, 'utf8'), /Canonical authority remains in repo docs/);
    assert.match(fs.readFileSync(roadmapMirrorPath, 'utf8'), /Roadmap Mirror/);
  });
  await test('POST /api/planning/obsidian/representations/refresh persists deterministic mirror content for unchanged canonical sources', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
    }, null, 2));
    fs.mkdirSync(path.join(repoPath, 'docs', 'planning'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'docs', 'planning', 'bullets.md'), [
      '# Planning Bullets',
      '',
      'Repository-scoped bullet seeds for future planning sessions.',
      '',
      '## PB-001 — Stable mirror content',
      '- State: idea',
      '- Repo: repo-workspace-repo',
      '- Summary: Keep mirror refresh deterministic.',
      '- Notes:',
      '  - Avoid timestamp-only churn.',
      '- Promoted to plan: none',
      '- Promoted to backlog: none',
      '',
    ].join('\n'));
    fs.writeFileSync(roadmapSourcePath(repoPath), [
      '---',
      'doc_kind: roadmap',
      'roadmap_slug: platform-foundation',
      'title: Platform Foundation',
      'version: 1',
      '---',
      '',
      '# Platform Foundation',
      '',
      '## Overview',
      'Roadmap mirror content should remain stable when source docs do not change.',
      '',
      '## Roadmap Items',
      '',
    ].join('\n'));
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      readJsonBody: async () => ({}),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const firstRefresh = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
    assert.equal(firstRefresh.res.statusCode, 200);
    const bulletsMirrorPath = path.join(
      vaultPath,
      'Planning',
      'repo-workspace-repo',
      '_instruction-engine',
      'planning-mirrors',
      'bullets.md',
    );
    const firstContent = fs.readFileSync(bulletsMirrorPath, 'utf8');
    const secondRefresh = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
    const secondBody = parseJsonBody(secondRefresh.res);
    const secondContent = fs.readFileSync(bulletsMirrorPath, 'utf8');
    assert.equal(secondRefresh.res.statusCode, 200);
    assert.equal(secondBody.result.refreshedCount, 0);
    assert.equal(secondBody.result.skippedCount, 2);
    assert.equal(secondContent, firstContent);
    assert.doesNotMatch(secondContent, /ie_generated_at:/);
  });
  await test('GET /api/planning/obsidian/representations keeps mirrors current when canonical content is unchanged but source mtime changes', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
    }, null, 2));
    const bulletsSourcePath = path.join(repoPath, 'docs', 'planning', 'bullets.md');
    const roadmapSourcePathValue = roadmapSourcePath(repoPath);
    fs.mkdirSync(path.dirname(bulletsSourcePath), { recursive: true });
    fs.mkdirSync(path.dirname(roadmapSourcePathValue), { recursive: true });
    fs.writeFileSync(bulletsSourcePath, [
      '# Planning Bullets',
      '',
      'Repository-scoped bullet seeds for future planning sessions.',
      '',
      '## PB-001 — Stable mirror freshness',
      '- State: idea',
      '- Repo: repo-workspace-repo',
      '- Summary: Ignore source mtime when content stays the same.',
      '- Notes:',
      '  - Freshness should follow content hashes.',
      '- Promoted to plan: none',
      '- Promoted to backlog: none',
      '',
    ].join('\n'));
    fs.writeFileSync(roadmapSourcePathValue, [
      '---',
      'doc_kind: roadmap',
      'roadmap_slug: platform-foundation',
      'title: Platform Foundation',
      'version: 1',
      '---',
      '',
      '# Platform Foundation',
      '',
      '## Overview',
      'Roadmap mirrors should stay current across mtime-only source updates.',
      '',
      '## Roadmap Items',
      '',
    ].join('\n'));
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      readJsonBody: async () => ({}),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const firstRefresh = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
    assert.equal(firstRefresh.res.statusCode, 200);
    const bulletsMirrorPath = path.join(
      vaultPath,
      'Planning',
      'repo-workspace-repo',
      '_instruction-engine',
      'planning-mirrors',
      'bullets.md',
    );
    const roadmapMirrorPath = path.join(
      vaultPath,
      'Planning',
      'repo-workspace-repo',
      '_instruction-engine',
      'planning-mirrors',
      'roadmaps',
      'platform-foundation.md',
    );
    const mirrorContentBefore = fs.readFileSync(bulletsMirrorPath, 'utf8');
    const bulletsMirrorMtimeBefore = fs.statSync(bulletsMirrorPath).mtimeMs;
    const roadmapMirrorMtimeBefore = fs.statSync(roadmapMirrorPath).mtimeMs;
    const sourceFutureTime = new Date('2026-03-24T12:00:00.000Z');
    fs.utimesSync(bulletsSourcePath, sourceFutureTime, sourceFutureTime);
    fs.utimesSync(roadmapSourcePathValue, sourceFutureTime, sourceFutureTime);
    const listed = await invoke(routes, { elegyHomeAbs }, 'GET', '/api/planning/obsidian/representations');
    const listBody = parseJsonBody(listed.res);
    const secondRefresh = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
    const secondRefreshBody = parseJsonBody(secondRefresh.res);
    assert.equal(listed.res.statusCode, 200);
    assert.equal(listBody.representationsStatus.currentCount, 2);
    assert.equal(listBody.representationsStatus.staleCount, 0);
    assert.deepEqual(
      listBody.representations.map((entry) => entry.freshness),
      ['current', 'current'],
    );
    assert.equal(secondRefresh.res.statusCode, 200);
    assert.equal(secondRefreshBody.result.refreshedCount, 0);
    assert.equal(secondRefreshBody.result.skippedCount, 2);
    assert.equal(fs.readFileSync(bulletsMirrorPath, 'utf8'), mirrorContentBefore);
    assert.equal(fs.statSync(bulletsMirrorPath).mtimeMs, bulletsMirrorMtimeBefore);
    assert.equal(fs.statSync(roadmapMirrorPath).mtimeMs, roadmapMirrorMtimeBefore);
  });
  await test('GET /api/planning/obsidian/representations marks mirrors stale when deterministic rendering drifts without source changes', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
    }, null, 2));
    fs.mkdirSync(path.join(repoPath, 'docs', 'planning'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'docs', 'planning', 'bullets.md'), [
      '# Planning Bullets',
      '',
      'Repository-scoped bullet seeds for future planning sessions.',
      '',
      '## PB-001 — Clarify renderer drift',
      '- State: idea',
      '- Repo: repo-workspace-repo',
      '- Summary: Detect stale mirrors even when source hashes match.',
      '- Notes:',
      '  - Renderer output can change independently.',
      '- Promoted to plan: none',
      '- Promoted to backlog: none',
      '',
    ].join('\n'));
    fs.writeFileSync(roadmapSourcePath(repoPath), [
      '---',
      'doc_kind: roadmap',
      'roadmap_slug: platform-foundation',
      'title: Platform Foundation',
      'version: 1',
      '---',
      '',
      '# Platform Foundation',
      '',
      '## Overview',
      'Keep roadmap mirrors deterministic.',
      '',
      '## Roadmap Items',
      '',
    ].join('\n'));
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      readJsonBody: async () => ({}),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const firstRefresh = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
    assert.equal(firstRefresh.res.statusCode, 200);
    const bulletsMirrorPath = path.join(
      vaultPath,
      'Planning',
      'repo-workspace-repo',
      '_instruction-engine',
      'planning-mirrors',
      'bullets.md',
    );
    const mirrorContent = fs.readFileSync(bulletsMirrorPath, 'utf8');
    const parsedMirror = obsidianPlanningRepresentationsLib.parseFrontmatter(mirrorContent);
    const driftedBody = parsedMirror.body.replace('# Planning Bullets Mirror', '# Legacy Planning Bullets Mirror');
    const driftedHash = obsidianNotesLib.hashContent(driftedBody);
    const driftedContent = mirrorContent
      .replace(
        `ie_rendered_content_hash: ${parsedMirror.attributes.ie_rendered_content_hash}`,
        `ie_rendered_content_hash: ${driftedHash}`,
      )
      .replace(parsedMirror.body, driftedBody);
    fs.writeFileSync(bulletsMirrorPath, driftedContent);
    const { res } = await invoke(routes, { elegyHomeAbs }, 'GET', '/api/planning/obsidian/representations');
    const body = parseJsonBody(res);
    const bulletsRepresentation = body.representations.find((entry) => entry.representationKind === 'bullets');
    const roadmapRepresentation = body.representations.find((entry) => entry.representationKind === 'roadmap');
    assert.equal(res.statusCode, 200);
    assert.equal(body.representationsStatus.staleCount, 1);
    assert.equal(body.representationsStatus.currentCount, 1);
    assert.equal(bulletsRepresentation.freshness, 'stale');
    assert.equal(roadmapRepresentation.freshness, 'current');
    assert.equal(bulletsRepresentation.sourceContentHash, parsedMirror.attributes.ie_source_content_hash);
    assert.match(bulletsRepresentation.message, /Deterministic mirror rendering changed/);
  });
  await test('POST /api/planning/obsidian/representations/refresh fails closed on malformed mirror metadata', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    const mirrorDir = path.join(
      vaultPath,
      'Planning',
      'repo-workspace-repo',
      '_instruction-engine',
      'planning-mirrors',
    );
    fs.mkdirSync(mirrorDir, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
    }, null, 2));
    fs.mkdirSync(path.join(repoPath, 'docs', 'planning'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'docs', 'planning', 'bullets.md'), [
      '# Planning Bullets',
      '',
      'Repository-scoped bullet seeds for future planning sessions.',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(mirrorDir, 'bullets.md'), [
      '---',
      'ie_kind: planning-obsidian-representation',
      'ie_representation_id: wrong-id',
      '---',
      '',
      '# Broken mirror',
      '',
    ].join('\n'));
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      readJsonBody: async () => ({}),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const { res } = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
    const body = parseJsonBody(res);
    assert.equal(res.statusCode, 409);
    assert.equal(body.kind, 'planning.obsidian.representations.refresh');
    assert.equal(body.code, 'obsidian_representation_metadata_invalid');
  });
  await test('POST /api/planning/obsidian/representations/refresh aborts when canonical source drifts after preflight', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    const bulletsSourcePath = path.join(repoPath, 'docs', 'planning', 'bullets.md');
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
    }, null, 2));
    fs.mkdirSync(path.join(repoPath, 'docs', 'planning'), { recursive: true });
    fs.writeFileSync(bulletsSourcePath, [
      '# Planning Bullets',
      '',
      'Repository-scoped bullet seeds for future planning sessions.',
      '',
      '## PB-001 — Keep canonical snapshots stable',
      '- State: idea',
      '- Repo: repo-workspace-repo',
      '- Summary: Refresh mirrors from repo docs.',
      '- Notes:',
      '  - Keep source revalidation fail-closed.',
      '- Promoted to plan: none',
      '- Promoted to backlog: none',
      '',
    ].join('\n'));
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const initialRefresh = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
    assert.equal(initialRefresh.res.statusCode, 200);
    const bulletsMirrorPath = path.join(
      vaultPath,
      'Planning',
      'repo-workspace-repo',
      '_instruction-engine',
      'planning-mirrors',
      'bullets.md',
    );
    const initialMirrorContent = fs.readFileSync(bulletsMirrorPath, 'utf8');
    const refreshedSourceContent = [
      '# Planning Bullets',
      '',
      'Repository-scoped bullet seeds for future planning sessions.',
      '',
      '## PB-001 — Keep canonical snapshots stable',
      '- State: idea',
      '- Repo: repo-workspace-repo',
      '- Summary: Refresh mirrors from repo docs before the concurrent drift arrives.',
      '- Notes:',
      '  - This change should make the mirror stale but still valid.',
      '- Promoted to plan: none',
      '- Promoted to backlog: none',
      '',
    ].join('\n');
    fs.writeFileSync(bulletsSourcePath, refreshedSourceContent);
    const concurrentSourceContent = [
      '# Planning Bullets',
      '',
      'Repository-scoped bullet seeds for future planning sessions.',
      '',
      '## PB-001 — Keep canonical snapshots stable',
      '- State: idea',
      '- Repo: repo-workspace-repo',
      '- Summary: Refresh mirrors from repo docs after re-reading the source.',
      '- Notes:',
      '  - Concurrent source edits must block stale mirror writes.',
      '- Promoted to plan: none',
      '- Promoted to backlog: none',
      '',
    ].join('\n');
    const originalWriteFileSync = fs.writeFileSync;
    let injectedSourceDrift = false;
    try {
      fs.writeFileSync = function patchedWriteFileSync(filePath, ...args) {
        const normalizedPath = typeof filePath === 'string' ? path.resolve(filePath) : filePath;
        const basename = typeof normalizedPath === 'string' ? path.basename(normalizedPath) : '';
        const result = originalWriteFileSync.call(fs, filePath, ...args);
        if (!injectedSourceDrift && basename.startsWith('.bullets.md.') && basename.endsWith('.tmp')) {
          injectedSourceDrift = true;
          originalWriteFileSync.call(fs, bulletsSourcePath, concurrentSourceContent, 'utf8');
        }
        return result;
      };
      const conflictedRefresh = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
      const conflictedBody = parseJsonBody(conflictedRefresh.res);
      assert.equal(conflictedRefresh.res.statusCode, 409);
      assert.equal(conflictedBody.kind, 'planning.obsidian.representations.refresh');
      assert.equal(conflictedBody.code, 'obsidian_representation_conflict');
    } finally {
      fs.writeFileSync = originalWriteFileSync;
    }
    assert.equal(injectedSourceDrift, true);
    assert.equal(fs.readFileSync(bulletsMirrorPath, 'utf8'), initialMirrorContent);
    assert.equal(fs.readFileSync(bulletsSourcePath, 'utf8'), concurrentSourceContent);
  });
  await test('POST /api/planning/obsidian/representations/refresh rejects mirrors missing source content hash metadata', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
    }, null, 2));
    fs.mkdirSync(path.join(repoPath, 'docs', 'planning'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'docs', 'planning', 'bullets.md'), [
      '# Planning Bullets',
      '',
      'Repository-scoped bullet seeds for future planning sessions.',
      '',
    ].join('\n'));
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      readJsonBody: async () => ({}),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const initialRefresh = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
    assert.equal(initialRefresh.res.statusCode, 200);
    const bulletsMirrorPath = path.join(
      vaultPath,
      'Planning',
      'repo-workspace-repo',
      '_instruction-engine',
      'planning-mirrors',
      'bullets.md',
    );
    const mirrorContent = fs.readFileSync(bulletsMirrorPath, 'utf8');
    fs.writeFileSync(
      bulletsMirrorPath,
      mirrorContent.replace(/^ie_source_content_hash:.*\n/m, ''),
    );
    const { res } = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
    const body = parseJsonBody(res);
    assert.equal(res.statusCode, 409);
    assert.equal(body.kind, 'planning.obsidian.representations.refresh');
    assert.equal(body.code, 'obsidian_representation_metadata_invalid');
  });
  await test('POST /api/planning/obsidian/representations/refresh requires repoId-gated mutation targeting while GET routes still honor read-context repoPath selectors', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const otherRepoPath = path.join(path.dirname(repoPath), 'secondary-repo');
    const inventory = createMultiRepoInventory(repoPath, otherRepoPath);
    fs.mkdirSync(path.join(otherRepoPath, '.git'), { recursive: true });
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
    }, null, 2));
    fs.mkdirSync(path.join(otherRepoPath, 'docs', 'planning'), { recursive: true });
    fs.writeFileSync(path.join(otherRepoPath, 'docs', 'planning', 'bullets.md'), '# Planning Bullets\n');
    fs.writeFileSync(roadmapSourcePath(otherRepoPath), [
      '---',
      'doc_kind: roadmap',
      'roadmap_slug: platform-foundation',
      'title: Platform Foundation',
      'version: 1',
      '---',
      '',
      '# Platform Foundation',
      '',
      '## Overview',
      'Secondary repo roadmap.',
      '',
      '## Roadmap Items',
      '',
    ].join('\n'));
    const routes = register({
      repoInventory: inventory,
      readJsonBody: async () => ({}),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const readResult = await invoke(
      routes,
      { elegyHomeAbs },
      'GET',
      `/api/planning/obsidian/representations?repoPath=${encodeURIComponent(otherRepoPath)}`,
    );
    const refreshResult = await invoke(
      routes,
      { elegyHomeAbs },
      'POST',
      `/api/planning/obsidian/representations/refresh?repoPath=${encodeURIComponent(otherRepoPath)}`,
    );
    const readBody = parseJsonBody(readResult.res);
    const refreshBody = parseJsonBody(refreshResult.res);
    assert.equal(readResult.res.statusCode, 200);
    assert.equal(readBody.repo.repoId, 'repo-secondary');
    assert.equal(refreshResult.res.statusCode, 409);
    assert.equal(refreshBody.code, 'catalog_repo_id_required_for_mutation');
  });
  await test('POST /api/planning/obsidian/representations/refresh fails closed on concurrent mirror drift before overwrite', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
    }, null, 2));
    fs.mkdirSync(path.join(repoPath, 'docs', 'planning'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'docs', 'planning', 'bullets.md'), [
      '# Planning Bullets',
      '',
      'Repository-scoped bullet seeds for future planning sessions.',
      '',
    ].join('\n'));
    fs.writeFileSync(roadmapSourcePath(repoPath), [
      '---',
      'doc_kind: roadmap',
      'roadmap_slug: platform-foundation',
      'title: Platform Foundation',
      'version: 1',
      '---',
      '',
      '# Platform Foundation',
      '',
      '## Overview',
      'Primary roadmap.',
      '',
      '## Roadmap Items',
      '',
    ].join('\n'));
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      readJsonBody: async () => ({}),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const firstRefresh = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
    assert.equal(firstRefresh.res.statusCode, 200);
    const bulletsMirrorPath = path.join(
      vaultPath,
      'Planning',
      'repo-workspace-repo',
      '_instruction-engine',
      'planning-mirrors',
      'bullets.md',
    );
    const originalReadFileSync = fs.readFileSync;
    let targetReadCount = 0;
    try {
      fs.readFileSync = function patchedReadFileSync(filePath, ...args) {
        const resolvedPath = typeof filePath === 'string' ? path.resolve(filePath) : filePath;
        if (resolvedPath === path.resolve(bulletsMirrorPath)) {
          targetReadCount += 1;
          if (targetReadCount === 2) {
            originalReadFileSync.call(fs, bulletsMirrorPath, 'utf8');
            originalReadFileSync.call(fs, bulletsMirrorPath, 'utf8');
            fs.writeFileSync(bulletsMirrorPath, [
              '---',
              'ie_kind: planning-obsidian-representation',
              'ie_schema_version: 1',
              'ie_representation_id: concurrent-edit',
              'ie_representation_kind: bullets',
              'ie_external: true',
              'ie_canonical_authority: false',
              'ie_source_repo_relative_path: docs/planning/bullets.md',
              'ie_source_content_hash: drifted',
              'ie_generated_at: 2026-03-23T00:00:00.000Z',
              'ie_rendered_content_hash: drifted',
              '---',
              '',
              '# Concurrent edit',
              '',
            ].join('\n'));
          }
        }
        return originalReadFileSync.call(fs, filePath, ...args);
      };
      const drifted = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
      const driftBody = parseJsonBody(drifted.res);
      assert.equal(drifted.res.statusCode, 409);
      assert.equal(driftBody.code, 'obsidian_representation_conflict');
      assert.match(driftBody.error, /concurrent/i);
    } finally {
      fs.readFileSync = originalReadFileSync;
    }
  });
  await test('POST /api/planning/obsidian/representations/refresh preflights all writes before mutating any mirror', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
    }, null, 2));
    fs.mkdirSync(path.join(repoPath, 'docs', 'planning'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'docs', 'planning', 'bullets.md'), [
      '# Planning Bullets',
      '',
      'Initial bullet mirror source.',
      '',
    ].join('\n'));
    fs.writeFileSync(roadmapSourcePath(repoPath), [
      '---',
      'doc_kind: roadmap',
      'roadmap_slug: platform-foundation',
      'title: Platform Foundation',
      'version: 1',
      '---',
      '',
      '# Platform Foundation',
      '',
      '## Overview',
      'Initial roadmap content.',
      '',
      '## Roadmap Items',
      '',
    ].join('\n'));
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      readJsonBody: async () => ({}),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const firstRefresh = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
    assert.equal(firstRefresh.res.statusCode, 200);
    const mirrorBaseDir = path.join(
      vaultPath,
      'Planning',
      'repo-workspace-repo',
      '_instruction-engine',
      'planning-mirrors',
    );
    const bulletsMirrorPath = path.join(mirrorBaseDir, 'bullets.md');
    const roadmapMirrorPath = path.join(mirrorBaseDir, 'roadmaps', 'platform-foundation.md');
    const originalBulletsMirror = fs.readFileSync(bulletsMirrorPath, 'utf8');
    const originalRoadmapMirror = fs.readFileSync(roadmapMirrorPath, 'utf8');
    fs.writeFileSync(path.join(repoPath, 'docs', 'planning', 'bullets.md'), [
      '# Planning Bullets',
      '',
      'Updated bullet mirror source that would be written first.',
      '',
    ].join('\n'));
    fs.writeFileSync(roadmapSourcePath(repoPath), [
      '---',
      'doc_kind: roadmap',
      'roadmap_slug: platform-foundation',
      'title: Platform Foundation',
      'version: 1',
      '---',
      '',
      '# Platform Foundation',
      '',
      '## Overview',
      'Updated roadmap content that should never be mirrored because preflight fails.',
      '',
      '## Roadmap Items',
      '',
    ].join('\n'));
    const originalReadFileSync = fs.readFileSync;
    let roadmapReadCount = 0;
    const concurrentRoadmapContent = [
      '---',
      'ie_kind: planning-obsidian-representation',
      'ie_schema_version: 1',
      'ie_representation_id: concurrent-roadmap-edit',
      'ie_representation_kind: roadmap',
      'ie_external: true',
      'ie_canonical_authority: false',
      'ie_roadmap_slug: platform-foundation',
      'ie_source_repo_relative_path: docs/planning/platform-foundation/index.md',
      'ie_source_content_hash: drifted',
      'ie_generated_at: 2026-03-23T00:00:00.000Z',
      'ie_rendered_content_hash: drifted',
      '---',
      '',
      '# Concurrent roadmap edit',
      '',
    ].join('\n');
    try {
      fs.readFileSync = function patchedReadFileSync(filePath, ...args) {
        const resolvedPath = typeof filePath === 'string' ? path.resolve(filePath) : filePath;
        if (resolvedPath === path.resolve(roadmapMirrorPath)) {
          roadmapReadCount += 1;
          if (roadmapReadCount === 2) {
            fs.writeFileSync(roadmapMirrorPath, concurrentRoadmapContent);
          }
        }
        return originalReadFileSync.call(fs, filePath, ...args);
      };
      const refresh = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
      const body = parseJsonBody(refresh.res);
      assert.equal(refresh.res.statusCode, 409);
      assert.equal(body.code, 'obsidian_representation_conflict');
      assert.match(body.error, /concurrent/i);
    } finally {
      fs.readFileSync = originalReadFileSync;
    }
    assert.equal(fs.readFileSync(bulletsMirrorPath, 'utf8'), originalBulletsMirror);
    assert.equal(fs.readFileSync(roadmapMirrorPath, 'utf8'), concurrentRoadmapContent);
    assert.notEqual(originalRoadmapMirror, concurrentRoadmapContent);
    assert.doesNotMatch(fs.readFileSync(bulletsMirrorPath, 'utf8'), /Updated bullet mirror source that would be written first/);
  });
  await test('POST /api/planning/obsidian/representations/refresh revalidates mirrors again after staging and before rename', async () => {
    const { elegyHomeAbs, repoPath } = createFixture();
    const vaultPath = path.join(elegyHomeAbs, 'planning-vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.writeFileSync(path.join(elegyHomeAbs, 'obsidian-planning.json'), JSON.stringify({
      vaultPath,
      notesPathTemplate: 'Planning/{repoId}',
    }, null, 2));
    fs.mkdirSync(path.join(repoPath, 'docs', 'planning'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'docs', 'planning', 'bullets.md'), [
      '# Planning Bullets',
      '',
      'Initial bullet mirror source.',
      '',
    ].join('\n'));
    fs.writeFileSync(roadmapSourcePath(repoPath), [
      '---',
      'doc_kind: roadmap',
      'roadmap_slug: platform-foundation',
      'title: Platform Foundation',
      'version: 1',
      '---',
      '',
      '# Platform Foundation',
      '',
      '## Overview',
      'Initial roadmap content.',
      '',
      '## Roadmap Items',
      '',
    ].join('\n'));
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      readJsonBody: async () => ({}),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });
    const firstRefresh = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
    assert.equal(firstRefresh.res.statusCode, 200);
    const mirrorBaseDir = path.join(
      vaultPath,
      'Planning',
      'repo-workspace-repo',
      '_instruction-engine',
      'planning-mirrors',
    );
    const bulletsMirrorPath = path.join(mirrorBaseDir, 'bullets.md');
    const roadmapMirrorPath = path.join(mirrorBaseDir, 'roadmaps', 'platform-foundation.md');
    const originalBulletsMirror = fs.readFileSync(bulletsMirrorPath, 'utf8');
    const originalRoadmapMirror = fs.readFileSync(roadmapMirrorPath, 'utf8');
    fs.writeFileSync(path.join(repoPath, 'docs', 'planning', 'bullets.md'), [
      '# Planning Bullets',
      '',
      'Updated bullet mirror source that should remain unapplied.',
      '',
    ].join('\n'));
    fs.writeFileSync(roadmapSourcePath(repoPath), [
      '---',
      'doc_kind: roadmap',
      'roadmap_slug: platform-foundation',
      'title: Platform Foundation',
      'version: 1',
      '---',
      '',
      '# Platform Foundation',
      '',
      '## Overview',
      'Updated roadmap content that should also remain unapplied.',
      '',
      '## Roadmap Items',
      '',
    ].join('\n'));
    const originalWriteFileSync = fs.writeFileSync;
    let injectedConcurrentDrift = false;
    const concurrentRoadmapContent = [
      '---',
      'ie_kind: planning-obsidian-representation',
      'ie_schema_version: 1',
      'ie_representation_id: concurrent-roadmap-edit',
      'ie_representation_kind: roadmap',
      'ie_external: true',
      'ie_canonical_authority: false',
      'ie_roadmap_slug: platform-foundation',
      'ie_source_repo_relative_path: docs/planning/platform-foundation/index.md',
      'ie_source_content_hash: drifted',
      'ie_generated_at: 2026-03-23T00:00:00.000Z',
      'ie_rendered_content_hash: drifted',
      '---',
      '',
      '# Concurrent roadmap edit',
      '',
    ].join('\n');
    try {
      fs.writeFileSync = function patchedWriteFileSync(filePath, ...args) {
        const normalizedPath = typeof filePath === 'string' ? path.resolve(filePath) : filePath;
        const basename = typeof normalizedPath === 'string' ? path.basename(normalizedPath) : '';
        if (!injectedConcurrentDrift && basename.startsWith('.bullets.md.') && basename.endsWith('.tmp')) {
          injectedConcurrentDrift = true;
          originalWriteFileSync.call(fs, roadmapMirrorPath, concurrentRoadmapContent, 'utf8');
        }
        return originalWriteFileSync.call(fs, filePath, ...args);
      };
      const refresh = await invoke(routes, { elegyHomeAbs }, 'POST', '/api/planning/obsidian/representations/refresh');
      const body = parseJsonBody(refresh.res);
      assert.equal(refresh.res.statusCode, 409);
      assert.equal(body.code, 'obsidian_representation_conflict');
      assert.match(body.error, /concurrent/i);
    } finally {
      fs.writeFileSync = originalWriteFileSync;
    }
    assert.equal(fs.readFileSync(bulletsMirrorPath, 'utf8'), originalBulletsMirror);
    assert.equal(fs.readFileSync(roadmapMirrorPath, 'utf8'), concurrentRoadmapContent);
    assert.notEqual(originalRoadmapMirror, concurrentRoadmapContent);
    assert.doesNotMatch(fs.readFileSync(bulletsMirrorPath, 'utf8'), /Updated bullet mirror source that should remain unapplied/);
  });
  console.log(`\nPlanning Obsidian Route Tests: ${passed} passed`);
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
