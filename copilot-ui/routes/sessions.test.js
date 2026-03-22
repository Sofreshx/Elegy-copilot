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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      if (chunk != null) {
        state.chunks.push(String(chunk));
      }
      return true;
    },
    end(chunk) {
      if (chunk != null) {
        state.chunks.push(String(chunk));
      }
    },
  };
}

function createSendJson() {
  return (res, code, payload) => {
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(payload, null, 2));
  };
}

function parseJson(text) {
  return JSON.parse(String(text || '').trim() || '{}');
}

function findRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }
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

async function invoke(routes, ctxOrMethod, method, pathname, body) {
  let ctx = {};
  if (typeof ctxOrMethod === 'string') {
    body = pathname;
    pathname = method;
    method = ctxOrMethod;
  } else {
    ctx = ctxOrMethod || {};
  }

  const res = createResponse();
  const u = new URL(`http://127.0.0.1${pathname}`);
  const { route, match } = findRoute(routes, method, u.pathname);
  route.handler({
    copilotHome: 'C:/copilot',
    vscodeHome: 'C:/vscode',
    sandboxesHome: 'C:/sandboxes',
    ...ctx,
    req: { __body: body || {} },
    res,
    u,
    match,
    pathname: u.pathname,
  });
  await sleep(0);
  return { res, body: parseJson(res.bodyText) };
}

function createSessionFs() {
  return {
    existsSync(targetPath) {
      return String(targetPath || '').includes('session-state');
    },
    statSync() {
      return {
        isDirectory() {
          return true;
        },
      };
    },
  };
}

async function run() {
  await test('GET /api/sessions exposes runtime-first authority metadata for artifact inventory listings', async () => {
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

  await test('GET /api/sessions?source=all&dedupe=off marks the listing as multi-source artifact inventory', async () => {
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

  await test('GET /api/sessions/:id/proposition returns raw and parsed structured entries', async () => {
    const routes = register({
      sendJson: createSendJson(),
      fs: createSessionFs(),
      assets: {
        readTextFileSafe(targetPath) {
          if (String(targetPath).endsWith('proposition.md')) {
            return `## 2026-03-12T12:00:00Z — after-execution — workflow-executor

### Summary
- Execution completed.

### Immediate Next Actions
- Verify the changed files.

### Next Plan Ideas
- Tighten resume heuristics.

### Watch Outs
- Keep parallel-safe ownership explicit.

### Open Risks
- None.

### Details
Completed successfully.
`;
          }
          return null;
        },
      },
      readPlanArtifact() {
        return null;
      },
      listPlanArtifacts() {
        return [];
      },
    });

    const { res, body } = await invoke(routes, 'GET', '/api/sessions/session-123/proposition');

    assert.equal(res.statusCode, 200);
    assert.equal(body.id, 'session-123');
    assert.ok(Array.isArray(body.entries));
    assert.equal(body.entries.length, 1);
    assert.equal(body.latestEntry.phase, 'after-execution');
    assert.ok(body.latestEntry.sections.some((section) => section.key === 'immediateNextActions'));
  });

  await test('GET /api/sessions/:id/handoff returns parsed manifest and required sections', async () => {
    const routes = register({
      sendJson: createSendJson(),
      fs: createSessionFs(),
      assets: {
        readTextFileSafe(targetPath) {
          if (String(targetPath).endsWith('handoff.md')) {
            return `## Handoff Manifest
- Session: session-123
- Plan: plan.md (status: APPROVED)
- Reviewer: Verdict: APPROVED

## Key Decisions
- Use serial execution until file ownership is disjoint.

## Exploration Summary
- docs/system/session-state-artifacts.md

## User Constraints
- none

## Immediate Next Actions
- Execute WU-001.

## Next Plan Ideas
- Add richer resume scoring later.

## Watch Outs
- Keep review ledger aligned with handoff state.

## Open Risks
- none
`;
          }
          return null;
        },
      },
      readPlanArtifact() {
        return null;
      },
      listPlanArtifacts() {
        return [];
      },
    });

    const { res, body } = await invoke(routes, 'GET', '/api/sessions/session-123/handoff');

    assert.equal(res.statusCode, 200);
    assert.equal(body.parsed.manifest.session, 'session-123');
    assert.equal(body.parsed.manifest.planStatus, 'APPROVED');
    assert.ok(Array.isArray(body.parsed.sections));
    assert.equal(body.parsed.warnings.length, 0);
  });

  await test('GET /api/sessions/:id/agent-usage exposes additive skill usage summaries', async () => {
    const routes = register({
      sessions: {
        getAgentUsage(sessionDir, limit) {
          assert.equal(sessionDir, 'C:\\cli-home\\session-state\\session-usage');
          assert.equal(limit, 500);
          return {
            reviewer: 2,
          };
        },
      },
      assetInvocationAudit: {
        getSessionSkillUsageSummary(input) {
          assert.equal(input.copilotHome, 'C:\\cli-home');
          assert.equal(input.sessionId, 'session-usage');
          return {
            contractVersion: 'session_skill_usage_v1',
            sessionId: 'session-usage',
            totalInvocations: 1,
            uniqueSkillCount: 1,
            skills: [
              {
                assetId: 'skill-react-query',
                assetKey: 'react-query',
                invocationCount: 1,
              },
            ],
          };
        },
      },
      sendJson: createSendJson(),
    });

    const { res, body } = await invoke(routes, {
      copilotHome: 'C:\\cli-home',
      vscodeHome: 'C:\\vscode-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'GET', '/api/sessions/session-usage/agent-usage');

    assert.equal(res.statusCode, 200);
    assert.deepEqual(body.usage, { reviewer: 2 });
    assert.equal(body.skillUsage.totalInvocations, 1);
    assert.equal(body.skillUsage.uniqueSkillCount, 1);
    assert.equal(body.skillUsage.skills[0].assetId, 'skill-react-query');
  });

  await test('POST /api/sessions/plan creates a linked local plan session and writes plan/events artifacts', async () => {
    const writes = [];
    const ensuredDirs = [];
    const routes = register({
      sendJson: createSendJson(),
      readJsonBody: async (req) => req.__body || {},
      crypto: {
        randomUUID() {
          return 'uuid-123';
        },
      },
      ensureDir(targetPath) {
        ensuredDirs.push(targetPath);
      },
      fs: {
        existsSync(targetPath) {
          return String(targetPath).endsWith('events.jsonl') ? false : false;
        },
        writeFileSync(targetPath, content, encoding) {
          writes.push({ kind: 'write', targetPath, content, encoding });
        },
        appendFileSync(targetPath, content, encoding) {
          writes.push({ kind: 'append', targetPath, content, encoding });
        },
      },
    });

    const { res, body } = await invoke(routes, {
      copilotHome: 'C:\\cli-home',
      vscodeHome: 'C:\\vscode-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'POST', '/api/sessions/plan', {
      title: 'Planning follow-up',
      content: '# Planning follow-up\n\n## Problem\n\nClose the planning gap.\n',
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      seedArtifact: {
        id: 'PI-001',
        category: 'audit-request',
        title: 'Audit planning workflow',
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(body.sessionId, 'planning-uuid-123');
    assert.equal(body.created, true);
    assert.equal(body.linkedRepoId, 'repo-1');
    assert.equal(body.seededFromArtifactId, 'PI-001');
    assert.deepEqual(ensuredDirs, ['C:\\cli-home\\session-state\\planning-uuid-123']);
    assert.equal(writes.some((entry) => entry.kind === 'write' && String(entry.targetPath).endsWith('\\plan.md')), true);
    assert.equal(
      writes.some((entry) =>
        entry.kind === 'append'
        && String(entry.targetPath).endsWith('\\events.jsonl')
        && String(entry.content).includes('"type":"session.start"')
      ),
      true
    );
    assert.equal(
      writes.some((entry) =>
        entry.kind === 'append'
        && String(entry.targetPath).endsWith('\\events.jsonl')
        && String(entry.content).includes('"type":"session.plan_updated"')
      ),
      true
    );
  });

  await test('POST /api/sessions/plan updates an existing linked plan session without regenerating the session id', async () => {
    const writes = [];
    const routes = register({
      sendJson: createSendJson(),
      readJsonBody: async (req) => req.__body || {},
      ensureDir() {},
      fs: {
        existsSync(targetPath) {
          return String(targetPath).includes('existing-plan-session');
        },
        writeFileSync(targetPath, content, encoding) {
          writes.push({ kind: 'write', targetPath, content, encoding });
        },
        appendFileSync(targetPath, content, encoding) {
          writes.push({ kind: 'append', targetPath, content, encoding });
        },
      },
    });

    const { res, body } = await invoke(routes, {
      copilotHome: 'C:\\cli-home',
      vscodeHome: 'C:\\vscode-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'POST', '/api/sessions/plan', {
      sessionId: 'existing-plan-session',
      title: 'Updated plan',
      content: '# Updated plan\n',
      repoId: 'repo-1',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(body.sessionId, 'existing-plan-session');
    assert.equal(body.created, false);
    assert.equal(
      writes.some((entry) =>
        entry.kind === 'append'
        && String(entry.targetPath).endsWith('\\events.jsonl')
        && String(entry.content).includes('"type":"session.plan_updated"')
      ),
      true
    );
  });

  await test('POST /api/sessions/:id/roadmap-sync reads linked plan markers and syncs roadmap/backlog state', async () => {
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

  console.log(`\n${passed} tests passed`);
  if (process.exitCode) {
    console.error('Some tests FAILED');
  } else {
    console.log('All tests passed');
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
