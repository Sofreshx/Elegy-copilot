'use strict';

const assert = require('node:assert/strict');

const { register } = require('./sessions');

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
    ended: false,
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
      state.ended = true;
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
  throw new Error(`Route not found: ${method} ${pathname}`);
}

async function invoke(routes, ctx, method, pathname, body) {
  const res = createResponse();
  const u = new URL(`http://127.0.0.1${pathname}`);
  const { route, match } = findRoute(routes, method, u.pathname);
  route.handler({
    ...ctx,
    req: { __body: body || {} },
    res,
    u,
    match,
    pathname: u.pathname,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { res, body: parseJsonBody(res) };
}

test('GET /api/sessions exposes runtime-first authority metadata for artifact inventory listings', async () => {
  const routes = register({
    sessions: {
      listSessions(home) {
        assert.equal(home, 'C:\\cli-home');
        return [
          {
            id: 'session-1',
            source: 'cli',
            status: 'idle',
          },
        ];
      },
      listSandboxSessions() {
        return [];
      },
      applySessionReconciliation(session) {
        return {
          ...session,
          authority: 'fs',
          reconciliation: {
            reason: 'artifact_only',
            sourceOfTruth: 'artifact',
          },
        };
      },
      buildSessionIdentity(session) {
        return {
          canonicalKey: String(session.id || '').toLowerCase(),
          dedupeEligible: true,
        };
      },
      dedupeAllSources(rows) {
        return rows;
      },
    },
  });

  const { res, body } = await invoke(routes, {
    copilotHome: 'C:\\cli-home',
    vscodeHome: 'C:\\vscode-home',
    sandboxesHome: 'C:\\sandboxes-home',
  }, 'GET', '/api/sessions');

  assert.equal(res.statusCode, 200);
  assert.equal(body.authorityModel.liveAuthority, 'acp');
  assert.equal(body.authorityModel.artifactFallbackAuthority, 'fs');
  assert.equal(body.authorityModel.listingSurface, 'artifact_inventory');
  assert.equal(body.authorityModel.artifactAccessRole, 'archive_offline');
  assert.equal(body.sessions.length, 1);
  assert.equal(body.sessions[0].authority, 'fs');
});

test('GET /api/sessions?source=all&dedupe=off marks the listing as multi-source artifact inventory', async () => {
  const routes = register({
    sessions: {
      listSessions(home) {
        if (home === 'C:\\cli-home') {
          return [{ id: 'session-1', status: 'idle' }];
        }
        if (home === 'C:\\vscode-home') {
          return [{ id: 'session-1', status: 'idle' }];
        }
        return [];
      },
      listSandboxSessions() {
        return [];
      },
      applySessionReconciliation(session) {
        return {
          ...session,
          authority: 'fs',
          reconciliation: {
            reason: 'artifact_only',
            sourceOfTruth: 'artifact',
          },
        };
      },
      buildSessionIdentity(session) {
        return {
          canonicalKey: String(session.id || '').toLowerCase(),
          dedupeEligible: true,
        };
      },
      dedupeAllSources() {
        throw new Error('dedupeAllSources should not be called when dedupe=off');
      },
    },
  });

  const { res, body } = await invoke(routes, {
    copilotHome: 'C:\\cli-home',
    vscodeHome: 'C:\\vscode-home',
    sandboxesHome: 'C:\\sandboxes-home',
  }, 'GET', '/api/sessions?source=all&dedupe=off');

  assert.equal(res.statusCode, 200);
  assert.equal(body.authorityModel.liveAuthority, 'acp');
  assert.equal(body.authorityModel.listingSurface, 'artifact_inventory_multi_source');
  assert.equal(body.sessions.length, 2);
});

test('POST /api/sessions/:id/roadmap-sync reads linked plan markers and syncs roadmap/backlog state', async () => {
  const linkedPlan = [
    '# Plan Pack',
    '',
    '<!-- IE_LINKED_BACKLOG_IDS: RB-001 -->',
    '<!-- IE_LINKED_ROADMAP_IDS: RM-platform-foundation-001 -->',
    '',
    '# Plan-Pack Progress Tracker',
    '',
    '## Work Unit Groups Overview',
    '',
    '| Group | Title | Status | WUs Done | WUs Total | Depends On |',
    '| --- | --- | --- | --- | --- | --- |',
    '| G-01 | Platform Foundation | merged | 1 | 1 | — |',
    '',
    '## Work Unit Status Table',
    '',
    '| Group | Work Unit ID | Status | Next Unit | Notes |',
    '| --- | --- | --- | --- | --- |',
    '| G-01 | WU-001 | merged | — | complete |',
    '',
    '## Next Unit',
    '',
    '**NONE** — terminal outcome reached',
    '',
    '## Checkpoints',
    '',
    '| Group | Checkpoint | Trigger | Notes |',
    '| --- | --- | --- | --- |',
    '| G-01 | unit-tests | After G-01 | status: passed |',
    '',
  ].join('\n');

  const routes = register({
    readJsonBody: async (req) => req.__body || {},
    readPlanArtifact(sessionDir, planId) {
      assert.equal(sessionDir, 'C:\\cli-home\\session-state\\session-1');
      assert.equal(planId, 'latest');
      return linkedPlan;
    },
    repoInventory: {
      listKnownRepos() {
        return {
          selectedRepo: {
            repoId: 'repo-1',
            repoPath: 'C:\\repo',
            repoLabel: 'repo',
          },
          repos: [{
            repoId: 'repo-1',
            repoPath: 'C:\\repo',
            repoLabel: 'repo',
          }],
        };
      },
      resolveRepoEntry(inventory) {
        return inventory.selectedRepo;
      },
    },
    sessionPlanRoadmapSync: {
      syncSessionPlanToRoadmap(repoPath, sessionId, planText) {
        assert.equal(repoPath, 'C:\\repo');
        assert.equal(sessionId, 'session-1');
        assert.equal(planText, linkedPlan);
        return {
          deterministic: true,
          sessionId,
          planRef: 'session:session-1',
          outcome: 'completed',
          linkedBacklogIds: ['RB-001'],
          linkedRoadmapIds: ['RM-platform-foundation-001'],
          backlog: {
            backlogPath: 'C:\\repo\\docs\\backlog.md',
            changed: true,
            items: [{ id: 'RB-001', status: 'satisfied' }],
          },
          roadmaps: [{
            slug: 'platform-foundation',
            filePath: 'C:\\repo\\docs\\roadmaps\\platform-foundation.md',
            repoRelativePath: 'docs/roadmaps/platform-foundation.md',
            items: [{ id: 'RM-platform-foundation-001', status: 'done' }],
          }],
        };
      },
    },
    sendJson(res, code, payload) {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    },
  });

  const { res, body } = await invoke(routes, {
    engineRoot: 'C:\\engine',
    copilotHome: 'C:\\cli-home',
    copilotHomeAbs: 'C:\\cli-home',
    vscodeHome: 'C:\\vscode-home',
    sandboxesHome: 'C:\\sandboxes-home',
  }, 'POST', '/api/sessions/session-1/roadmap-sync', {});

  assert.equal(res.statusCode, 200);
  assert.equal(body.kind, 'sessions.roadmap-sync');
  assert.equal(body.repo.repoPath, 'C:\\repo');
  assert.equal(body.planRef, 'session:session-1');
  assert.equal(body.outcome, 'completed');
  assert.deepEqual(body.linkedBacklogIds, ['RB-001']);
});

process.on('exit', () => {
  console.log(`\n${passed} tests passed`);
  if (process.exitCode) {
    console.error('Some tests FAILED');
  } else {
    console.log('All tests passed');
  }
});
