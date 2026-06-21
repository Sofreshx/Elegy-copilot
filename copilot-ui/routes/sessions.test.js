'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  CONTINUATION_PACKAGE_CONTRACT_VERSION,
} = require('@elegy-copilot/contracts');
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
    elegyHome: 'C:/copilot',
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
      elegyHome: 'C:\\cli-home',
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
          return [];
        },
        listSandboxSessions(home) {
          if (home === 'C:\\sandboxes-home') {
            return [{ id: 'sandbox-session-1', status: 'active' }];
          }
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
      elegyHome: 'C:\\cli-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'GET', '/api/sessions?source=all&dedupe=off');
    assert.equal(res.statusCode, 200);
    assert.equal(body.authorityModel.liveAuthority, 'acp');
    assert.equal(body.authorityModel.listingSurface, 'artifact_inventory_multi_source');
    assert.equal(body.sessions.length, 2);
  });
  await test('GET /api/sessions/workspace returns runtime-first active entries plus durable history', async () => {
    const routes = register({
      sessions: {
        listSessions(home) {
          if (home === 'C:\\cli-home') {
            return [
              {
                id: 'session-1',
                cwd: 'C:\\repo-one',
                status: 'active',
                resolvedStatus: 'active',
              },
              {
                id: 'session-2',
                cwd: 'C:\\repo-two',
                status: 'idle',
                resolvedStatus: 'idle',
              },
            ];
          }
          return [];
        },
        listSandboxSessions() {
          return [];
        },
        listArchivedSessions(home) {
          if (home === 'C:\\cli-home') {
            return [
              {
                id: 'session-3',
                archiveId: 'session-3',
                cwd: 'C:\\repo-three',
                status: 'archived',
              },
            ];
          }
          return [];
        },
        listSandboxArchivedSessions() {
          return [];
        },
        applySessionReconciliation(session) {
          return {
            ...session,
            authority: 'fs',
            reconciliation: {
              reason: session.resolvedStatus === 'active' ? 'runtime_and_artifact' : 'artifact_only',
              sourceOfTruth: session.resolvedStatus === 'active' ? 'runtime' : 'artifact',
            },
          };
        },
        dedupeAllSources(rows) {
          return rows;
        },
      },
      sdkBridge: {
        listSdkSessions() {
          return [
            {
              sessionId: 'session-1',
              createdAt: '2026-04-07T12:00:00.000Z',
              cwd: 'C:\\repo-one',
              orchestration: {
                repo: {
                  repoId: 'repo-one',
                  repoPath: 'C:\\repo-one',
                  repoLabel: 'Repo One',
                },
              },
            },
          ];
        },
      },
      uiRuntimeOverlayService: {
        listSessions() {
          return [
            {
              id: 'overlay-1',
              linkedSessionId: 'session-overlay-linked',
              status: 'attached',
              repoId: 'repo-overlay',
              repoPath: 'C:\\repo-overlay',
              repoLabel: 'Repo Overlay',
              createdAt: '2026-04-07T12:05:00.000Z',
              updatedAt: '2026-04-07T12:06:00.000Z',
            },
          ];
        },
      },
    });
    const { res, body } = await invoke(routes, {
      elegyHome: 'C:\\cli-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'GET', '/api/sessions/workspace');
    assert.equal(res.statusCode, 200);
    assert.equal(body.authorityModel.activeAuthority, 'acp');
    assert.equal(body.authorityModel.historyAuthority, 'fs');
    assert.equal(body.authorityModel.multiRepoModel, 'primary_plus_linked');
    assert.deepEqual(body.active.map((entry) => entry.kind), ['overlay', 'sdk']);
    assert.deepEqual(body.active.map((entry) => entry.title), ['overlay-1', 'session-1']);
    assert.deepEqual(body.history.map((entry) => entry.kind), ['artifact', 'archive']);
    assert.equal(body.history[0].workspace.primaryRepo.repoPath, 'C:\\repo-two');
    assert.deepEqual(body.history[0].workspace.linkedRepos, []);
  });
  await test('GET /api/sessions/workspace excludes history artifact and archive rows when a linked overlay session is live in runtime', async () => {
    const routes = register({
      sessions: {
        listSessions(home) {
          if (home === 'C:\\cli-home') {
            return [
              {
                id: 'session-overlay-linked',
                cwd: 'C:\\repo-overlay',
                status: 'idle',
                resolvedStatus: 'idle',
              },
            ];
          }
          return [];
        },
        listSandboxSessions() {
          return [];
        },
        listArchivedSessions(home) {
          if (home === 'C:\\cli-home') {
            return [
              {
                id: 'session-overlay-linked',
                archiveId: 'session-overlay-linked',
                cwd: 'C:\\repo-overlay',
                status: 'archived',
              },
            ];
          }
          return [];
        },
        listSandboxArchivedSessions() {
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
        dedupeAllSources(rows) {
          return rows;
        },
      },
      sdkBridge: {
        listSdkSessions() {
          return [];
        },
      },
      uiRuntimeOverlayService: {
        listSessions() {
          return [
            {
              id: 'overlay-1',
              linkedSessionId: 'session-overlay-linked',
              status: 'attached',
              repoId: 'repo-overlay',
              repoPath: 'C:\\repo-overlay',
              repoLabel: 'Repo Overlay',
              createdAt: '2026-04-07T12:05:00.000Z',
              updatedAt: '2026-04-07T12:06:00.000Z',
            },
          ];
        },
      },
    });
    const { res, body } = await invoke(routes, {
      elegyHome: 'C:\\cli-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'GET', '/api/sessions/workspace');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(body.active.map((entry) => entry.kind), ['overlay']);
    assert.deepEqual(body.active.map((entry) => entry.title), ['overlay-1']);
    assert.deepEqual(body.history, []);
  });
  await test('GET /api/sessions?source=all does not duplicate projected sessions when only elegyHome is configured', async () => {
    const listSessionHomes = [];
    const routes = register({
      path: path.win32,
      sessions: {
        listSessions(home) {
          listSessionHomes.push(home);
          return [{ id: 'session-1', status: 'idle' }];
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
      elegyHome: 'C:\\Shared\\Copilot',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'GET', '/api/sessions?source=all');
    assert.equal(res.statusCode, 200);
    assert.equal(listSessionHomes.length, 1);
    assert.equal(listSessionHomes[0], 'C:\\Shared\\Copilot');
    assert.deepEqual(body.sessions.map((session) => session.source), ['cli']);
  });
  await test('GET /api/sessions?source=all&dedupe=off still avoids duplicate shared-root projections', async () => {
    const listSessionHomes = [];
    const routes = register({
      path: path.win32,
      sessions: {
        listSessions(home) {
          listSessionHomes.push(home);
          return [{ id: 'session-1', status: 'idle' }];
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
      elegyHome: 'C:\\Shared\\Copilot',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'GET', '/api/sessions?source=all&dedupe=off');
    assert.equal(res.statusCode, 200);
    assert.equal(listSessionHomes.length, 1);
    assert.equal(body.sessions.length, 1);
    assert.deepEqual(body.sessions.map((session) => session.source), ['cli']);
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
  await test('GET /api/sessions/:id/structured-state derives framing summaries from existing artifacts', async () => {
    const assetReads = [];
    const routes = register({
      sendJson: createSendJson(),
      fs: createSessionFs(),
      assets: {
        readTextFileSafe(targetPath) {
          assetReads.push(String(targetPath));
          if (String(targetPath).endsWith('handoff.md')) {
            return `## Handoff Manifest
- Session: session-123
- Plan: plan.md (status: APPROVED)
- Reviewer: Verdict: APPROVED
## Key Decisions
- Publish derived summaries through structured-state metadata.
## Exploration Summary
- copilot-ui/routes/sessions.js
## User Constraints
- Do not add new required files.
## Immediate Next Actions
- Confirm the derived summaries render in Session Details.
## Next Plan Ideas
- Reuse the same summaries in later planning surfaces.
## Watch Outs
- Keep raw artifacts available as supporting detail.
## Open Risks
- Verification evidence is still narrow.
`;
          }
          if (String(targetPath).endsWith('proposition.md')) {
            return `## 2026-03-23T12:00:00Z — after-execution — workflow-executor
### Summary
- Session framing cards render before raw artifacts.
- Structured-state now exposes intent and closure summaries.
### Immediate Next Actions
- Check the Sessions UI output.
### Next Plan Ideas
- Add planning-surface reuse later.
### Watch Outs
- Keep derived output additive only.
### Open Risks
- Verification remains targeted.
### Details
Minimal runtime adoption is now backed by derived session artifact summaries.
`;
          }
          if (String(targetPath).endsWith('verification-guide.md')) {
            return `## Summary
Verify the new framing surfaces in Sessions.
## Changed Files
- copilot-ui/routes/sessions.js
## Where to Verify
- UI: Sessions > Session Details
## Validation Requirements
- unit: Required for the structured-state route.
- browser: Not required for this route-only slice.
## Tested Coverage
- unit: Focused unit structured-state route parsing through the Sessions API.
## Coverage Gaps
- browser: No browser-driven validation ran for this route-only slice.
## Verification Steps
- Run node copilot-ui/lib/planState.test.js
## Expected Outcomes
- Session Intent Frame leads the details pane.
`;
          }
          if (String(targetPath).endsWith('execution-state.json')) {
            return JSON.stringify({
              schemaVersion: 'execution-state-v1',
              updatedAt: '2026-03-23T12:00:00Z',
              lifecycle: 'executing',
              status: 'active',
              mode: 'resumed',
              summary: 'Execution overlay tracks the active group and work unit.',
              activeGroup: { groupId: 'G-01', title: 'Runtime Adoption', status: 'in-progress' },
              activeWorkUnit: { workUnitId: 'WU-002', title: 'Session Detail', status: 'in-progress' },
              nextUnit: { workUnitId: 'WU-003', rationale: 'render the execution tree' },
              blockers: [{ label: 'Need narrow validation', details: 'Do not run integration coverage in this slice.' }],
              replanCount: 1,
              tree: [
                {
                  groupId: 'G-01',
                  kind: 'group',
                  title: 'Runtime Adoption',
                  status: 'in-progress',
                  current: true,
                  children: [
                    { workUnitId: 'WU-001', kind: 'work-unit', title: 'Contract', status: 'done' },
                    { workUnitId: 'WU-002', kind: 'work-unit', title: 'Session Detail', status: 'in-progress', current: true },
                    { workUnitId: 'WU-003', kind: 'work-unit', title: 'Execution Tree', status: 'queued', next: true },
                  ],
                },
              ],
            }, null, 2);
          }
          return null;
        },
      },
      readPlanArtifact() {
        return `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |
# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->
## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Runtime Adoption | implemented | 1 | 2 | — |
## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | WU-002 | framing landed |
## Next Unit
**WU-002** — finish the session detail presentation
## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: passed |
`;
      },
      listPlanArtifacts() {
        return [];
      },
    });
    const { res, body } = await invoke(routes, 'GET', '/api/sessions/session-123/structured-state');
    assert.equal(res.statusCode, 200);
    assert.equal(body.meta.intentFrame.summary, 'Session framing cards render before raw artifacts. Structured-state now exposes intent and closure summaries.');
    assert.deepEqual(body.meta.intentFrame.inScope, [
      'Check the Sessions UI output.',
      'Confirm the derived summaries render in Session Details.',
    ]);
    assert.equal(body.meta.closureSummary.outcome, 'completed');
    assert.equal(body.meta.closureSummary.confidence, 'high');
    assert.deepEqual(body.meta.intentFrame.validationRequirements, [
      'unit: Required for the structured-state route.',
      'browser: Not required for this route-only slice.',
    ]);
    assert.deepEqual(body.meta.closureSummary.changedFiles, ['copilot-ui/routes/sessions.js']);
    assert.deepEqual(body.meta.closureSummary.validationCoverage, [
      'unit: Focused unit structured-state route parsing through the Sessions API.',
    ]);
    assert.deepEqual(body.meta.closureSummary.coverageGaps, [
      'browser: No browser-driven validation ran for this route-only slice.',
    ]);
    assert.ok(body.meta.closureSummary.validationEvidence.some((entry) => entry.includes('Review ledger verdict: APPROVED')));
    assert.equal(body.meta.executionOverlay.present, true);
    assert.equal(body.meta.executionOverlay.applied, true);
    assert.equal(body.meta.executionState.lifecycle, 'executing');
    assert.equal(body.meta.executionState.activeWorkUnit.id, 'WU-002');
    assert.equal(body.nextUnit.workUnitId, 'WU-003');
    assert.equal(body.groups[0].status, 'in-progress');
    assert.equal(body.workUnits[0].status, 'done');
    assert.equal(body.workUnits[1].status, 'in-progress');
    assert.ok(!body.meta.closureSummary.sourceArtifacts.includes('final'));
    assert.ok(!assetReads.some((targetPath) => targetPath.endsWith('final.md')));
    assert.ok(assetReads.some((targetPath) => targetPath.endsWith('execution-state.json')));
  });
  await test('GET /api/sessions/:id/structured-state adds authority-safe orchestration projections for repo, tasks, actors, workflows, and worktrees', async () => {
    const routes = register({
      sendJson: createSendJson(),
      fs: createSessionFs(),
      readPlanArtifact() {
        return '# Plan Pack\n\n# Plan-Pack Progress Tracker\n';
      },
      assets: {
        readTextFileSafe() {
          return null;
        },
      },
      planState: {
        parseStructuredState() {
          return {
            warnings: [],
            groups: [],
            workUnits: [],
            checkpoints: [],
            nextUnit: null,
            meta: {
              intentFrame: {
                summary: 'Ship the orchestration contract.',
              },
              closureSummary: {
                summary: 'Orchestration contract is in progress.',
              },
            },
          };
        },
      },
      sessionArtifacts: {
        deriveSessionObjective(input) {
          return input.intentFrame.summary;
        },
      },
      sessions: {
        getSessionStartContext() {
          return {
            cwd: 'C:\\Repos\\elegy-copilot',
            branch: 'main',
          };
        },
        listRepoStateTasks(elegyHome, repoId, options) {
          assert.equal(elegyHome, 'C:\\cli-home');
          assert.equal(repoId, 'elegy-copilot');
          assert.equal(options.sessionId, 'session-123');
          assert.deepEqual(options.workflowRunIds, ['run-1']);
          assert.deepEqual(options.worktreeIds, ['wt-1']);
          return [
            {
              taskId: 'TASK-1',
              repoId: 'elegy-copilot',
              title: 'Backend contract',
              status: 'in_progress',
              ownerSessionId: 'session-123',
              activeActorId: 'implementer',
              workflow: {
                mode: 'auto',
                workflowKind: 'task-execution',
                latestRunId: 'run-1',
              },
              worktree: {
                mode: 'dedicated',
                worktreeId: 'wt-1',
              },
              linkedPlanning: {
                backlogIds: ['RB-001'],
                roadmapIds: ['RM-platform-001'],
              },
              durablePath: 'C:\\cli-home\\repo-state\\elegy-copilot\\tasks\\TASK-1.json',
            },
          ];
        },
        buildSessionActorSummaries() {
          return [
            {
              actorId: 'implementer',
              label: 'Implementer',
              source: 'artifact-events',
              invocationCount: 2,
              taskIds: ['TASK-1'],
            },
          ];
        },
        readRepoStateWorktree(elegyHome, repoId, worktreeId) {
          assert.equal(elegyHome, 'C:\\cli-home');
          assert.equal(repoId, 'elegy-copilot');
          assert.equal(worktreeId, 'wt-1');
          return {
            worktreeId,
            path: 'C:\\Repos\\elegy-copilot-worktrees\\wt-1',
            branch: 'task/task-1',
            status: 'ready',
            launch: {
              blocked: false,
              reason: null,
            },
          };
        },
      },
      repoInventory: {
        listKnownRepos() {
          return [
            {
              repoId: 'elegy-copilot',
              repoPath: 'C:\\Repos\\elegy-copilot',
              repoLabel: 'Elegy Copilot',
            },
          ];
        },
        resolveRepoEntry() {
          return {
            repoId: 'elegy-copilot',
            repoPath: 'C:\\Repos\\elegy-copilot',
            repoLabel: 'Elegy Copilot',
          };
        },
      },
      sdkBridge: {
        getSdkSession(sessionId) {
          assert.equal(sessionId, 'session-123');
          return {
            sessionId,
            contextType: 'regular',
            sandboxId: null,
            cwd: 'C:\\Repos\\elegy-copilot-worktrees\\wt-1',
            orchestration: {
              repo: {
                repoId: 'elegy-copilot',
                repoPath: 'C:\\Repos\\elegy-copilot',
              },
              isolation: {
                worktreeId: 'wt-1',
              },
              actors: [
                {
                  actorId: 'planner',
                  label: 'Planner',
                  role: 'planner',
                },
              ],
            },
          };
        },
      },
      executorService: {
        listRuns() {
          return [
            {
              id: 'run-1',
              jobId: 'job-1',
              repoId: 'elegy-copilot',
              sessionId: 'session-123',
              status: 'running',
              createdAt: '2026-04-07T10:00:00.000Z',
              updatedAt: '2026-04-07T10:01:00.000Z',
              orchestration: {
                workflow: {
                  workflowKind: 'task-execution',
                  trigger: 'auto',
                  mode: 'auto',
                },
                taskRefs: [{ taskId: 'TASK-1' }],
              },
            },
          ];
        },
      },
      uiRuntimeOverlayService: {
        listSessions() {
          return [
            {
              id: 'overlay-1',
              repoId: 'elegy-copilot',
              linkedSessionId: 'session-123',
              runtimeUrl: 'http://127.0.0.1:4173',
              packageRoot: 'C:\\Repos\\elegy-copilot-worktrees\\wt-1',
              status: 'attached',
              phase: 'attached',
              updatedAt: '2026-04-07T10:02:00.000Z',
              worktree: {
                worktreeId: 'wt-1',
                mode: 'dedicated',
              },
            },
          ];
        },
      },
    });
    const { res, body } = await invoke(routes, {
      elegyHome: 'C:\\cli-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'GET', '/api/sessions/session-123/structured-state');
    assert.equal(res.statusCode, 200);
    assert.equal(body.orchestration.contractVersion, '1');
    assert.equal(body.orchestration.authority.liveSession, 'acp');
    assert.equal(body.orchestration.repo.repoId, 'elegy-copilot');
    assert.equal(body.orchestration.objective, 'Ship the orchestration contract.');
    assert.equal(body.orchestration.isolation.mode, 'dedicated');
    assert.equal(body.orchestration.isolation.worktreeStatus, 'ready');
    assert.equal(body.orchestration.isolation.launchBlocked, false);
    assert.equal(body.orchestration.isolation.worktree.worktreeId, 'wt-1');
    assert.deepEqual(body.orchestration.actors.items.map((actor) => actor.actorId), ['implementer', 'planner']);
    assert.equal(body.orchestration.taskBoard.items[0].taskId, 'TASK-1');
    assert.equal(body.orchestration.taskBoard.items[0].projection.durableStore, 'repo-state');
    assert.equal(body.orchestration.workflow.runs[0].runId, 'run-1');
    assert.equal(body.orchestration.overlays.sessions[0].linkedSessionId, 'session-123');
  });
  await test('GET /api/sessions/:id/structured-state excludes same-repo overlay sessions without an explicit current-session ref', async () => {
    const routes = register({
      sendJson: createSendJson(),
      fs: createSessionFs(),
      readPlanArtifact() {
        return '# Plan Pack\n\n## Work Units\n- none';
      },
      assets: {
        readTextFileSafe() {
          return null;
        },
      },
      sessions: {
        getSessionStartContext() {
          return {
            cwd: 'C:\\Repos\\elegy-copilot',
            branch: 'main',
          };
        },
        listRepoStateTasks() {
          return [];
        },
        buildSessionActorSummaries() {
          return [];
        },
        readRepoStateWorktree() {
          return null;
        },
      },
      repoInventory: {
        resolveRepoEntry() {
          return {
            repoId: 'elegy-copilot',
            repoPath: 'C:\\Repos\\elegy-copilot',
            repoLabel: 'Elegy Copilot',
          };
        },
      },
      sdkBridge: {
        getSdkSession(sessionId) {
          assert.equal(sessionId, 'session-123');
          return {
            sessionId,
            cwd: 'C:\\Repos\\elegy-copilot',
            orchestration: {
              repo: {
                repoId: 'elegy-copilot',
                repoPath: 'C:\\Repos\\elegy-copilot',
              },
            },
          };
        },
      },
      executorService: {
        listRuns() {
          return [];
        },
      },
      uiRuntimeOverlayService: {
        listSessions() {
          return [
            {
              id: 'overlay-keep',
              repoId: 'elegy-copilot',
              linkedSessionId: 'session-123',
              runtimeUrl: 'http://127.0.0.1:4173',
              packageRoot: 'C:\\Repos\\elegy-copilot-worktrees\\wt-1',
              status: 'attached',
              phase: 'attached',
              updatedAt: '2026-04-07T10:02:00.000Z',
              worktree: {
                worktreeId: 'wt-1',
                mode: 'dedicated',
              },
            },
            {
              id: 'overlay-leak',
              repoId: 'elegy-copilot',
              linkedSessionId: 'session-999',
              runtimeUrl: 'http://127.0.0.1:4273',
              packageRoot: 'C:\\Repos\\elegy-copilot-worktrees\\wt-2',
              status: 'attached',
              phase: 'attached',
              updatedAt: '2026-04-07T10:03:00.000Z',
              worktree: {
                worktreeId: 'wt-2',
                mode: 'dedicated',
              },
            },
          ];
        },
      },
    });
    const { res, body } = await invoke(routes, {
      elegyHome: 'C:\\cli-home',
    }, 'GET', '/api/sessions/session-123/structured-state');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(body.orchestration.overlays.sessions.map((session) => session.id), ['overlay-keep']);
  });
  await test('GET /api/sessions/:id/structured-state excludes same-repo workflow runs from sibling sessions', async () => {
    const routes = register({
      sendJson: createSendJson(),
      fs: createSessionFs(),
      readPlanArtifact() {
        return '# Plan Pack\n\n# Plan-Pack Progress Tracker\n';
      },
      assets: {
        readTextFileSafe() {
          return null;
        },
      },
      planState: {
        parseStructuredState() {
          return {
            warnings: [],
            groups: [],
            workUnits: [],
            checkpoints: [],
            nextUnit: null,
            meta: {},
          };
        },
      },
      sessions: {
        getSessionStartContext() {
          return {
            cwd: 'C:\\Repos\\elegy-copilot',
            branch: 'main',
          };
        },
        listRepoStateTasks() {
          return [
            {
              taskId: 'TASK-1',
              repoId: 'elegy-copilot',
              title: 'Scoped task',
              status: 'in_progress',
              ownerSessionId: 'session-123',
              workflow: {
                latestRunId: 'run-1',
              },
              worktree: {},
              linkedPlanning: {},
              durablePath: 'C:\\cli-home\\repo-state\\elegy-copilot\\tasks\\TASK-1.json',
            },
          ];
        },
        buildSessionActorSummaries() {
          return [];
        },
        readRepoStateWorktree() {
          return null;
        },
      },
      repoInventory: {
        resolveRepoEntry() {
          return {
            repoId: 'elegy-copilot',
            repoPath: 'C:\\Repos\\elegy-copilot',
            repoLabel: 'Elegy Copilot',
          };
        },
      },
      sdkBridge: {
        getSdkSession(sessionId) {
          assert.equal(sessionId, 'session-123');
          return {
            sessionId,
            cwd: 'C:\\Repos\\elegy-copilot',
            orchestration: {
              repo: {
                repoId: 'elegy-copilot',
                repoPath: 'C:\\Repos\\elegy-copilot',
              },
            },
          };
        },
      },
      executorService: {
        listRuns() {
          return [
            {
              id: 'run-1',
              repoId: 'elegy-copilot',
              sessionId: 'session-123',
              status: 'running',
              updatedAt: '2026-04-07T10:02:00.000Z',
              orchestration: {
                taskRefs: [{ taskId: 'TASK-1' }],
              },
            },
            {
              id: 'run-2',
              repoId: 'elegy-copilot',
              sessionId: 'session-999',
              status: 'running',
              updatedAt: '2026-04-07T10:03:00.000Z',
              orchestration: {
                taskRefs: [{ taskId: 'TASK-2' }],
              },
            },
            {
              id: 'run-3',
              repoId: 'elegy-copilot',
              sessionId: null,
              status: 'queued',
              updatedAt: '2026-04-07T10:04:00.000Z',
              orchestration: {
                taskRefs: [{ taskId: 'TASK-1' }],
              },
            },
          ];
        },
      },
      uiRuntimeOverlayService: {
        listSessions() {
          return [];
        },
      },
    });
    const { res, body } = await invoke(routes, {
      elegyHome: 'C:\\cli-home',
    }, 'GET', '/api/sessions/session-123/structured-state');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(body.orchestration.workflow.runs.map((run) => run.runId), ['run-3', 'run-1']);
  });
  await test('GET /api/sessions/:id/structured-state leaves structured validation requirements empty when the verification guide section is absent', async () => {
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
## Immediate Next Actions
- NONE
`;
          }
          if (String(targetPath).endsWith('proposition.md')) {
            return `## 2026-04-03T12:00:00Z - after-execution - workflow-executor
### Summary
- Structured validation requirements should stay empty when the section is missing.
`;
          }
          if (String(targetPath).endsWith('verification-guide.md')) {
            return `## Summary
Structured validation requirements should stay empty when the section is missing.
## Changed Files
- copilot-ui/lib/sessionArtifacts.js
## Where to Verify
- API: GET /api/sessions/:id/structured-state
## Verification Steps
- Run node copilot-ui/lib/planState.test.js
## Expected Outcomes
- Structured validation requirements stay empty when the section is absent.
`;
          }
          return null;
        },
      },
      readPlanArtifact() {
        return `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | - | accepted |
# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->
## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Runtime Adoption | implemented | 1 | 1 | - |
## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | - | execution finished |
## Next Unit
**NONE** - terminal outcome reached
## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: passed |
`;
      },
      listPlanArtifacts() {
        return [];
      },
    });
    const { res, body } = await invoke(routes, 'GET', '/api/sessions/session-123/structured-state');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(body.meta.intentFrame.successSignals, [
      'unit-tests — after group completion',
      'Structured validation requirements stay empty when the section is absent.',
    ]);
    assert.deepEqual(body.meta.intentFrame.validationRequirements, []);
    assert.deepEqual(body.meta.closureSummary.validationRequirements, []);
    assert.ok(body.meta.closureSummary.validationEvidence.includes('unit-tests passed (after group completion)'));
  });
  await test('GET /api/sessions/:id/structured-state keeps review approval in validation evidence without promoting confidence to high', async () => {
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
- Review approval stays visible in closure metadata.
## Exploration Summary
- docs/system/validation-governance.md
## User Constraints
- none
## Immediate Next Actions
- NONE
## Next Plan Ideas
- NONE
## Watch Outs
- Review approval alone must not create high confidence.
## Open Risks
- Focused validation coverage is still absent.
`;
          }
          if (String(targetPath).endsWith('proposition.md')) {
            return `## 2026-04-03T12:00:00Z - after-execution - workflow-executor
### Summary
- Structured-state now separates review approval from affirmative validation evidence.
### Immediate Next Actions
- NONE
### Next Plan Ideas
- NONE
### Watch Outs
- Do not let review approval alone imply tested confidence.
### Open Risks
- Persisted validation coverage is still absent.
`;
          }
          if (String(targetPath).endsWith('verification-guide.md')) {
            return `## Summary
Review approval remains visible in structured-state, but no validation coverage ran.
## Changed Files
- copilot-ui/lib/sessionArtifacts.js
## Where to Verify
- API: GET /api/sessions/:id/structured-state
## Verification Steps
- Inspect the closure summary confidence field.
## Expected Outcomes
- Review approval remains visible without producing high confidence.
`;
          }
          if (String(targetPath).endsWith('execution-state.json')) {
            return JSON.stringify({
              schemaVersion: 'execution-state-v1',
              lifecycle: 'finished',
              status: 'completed',
              summary: 'Execution finished without persisted validation coverage.',
            });
          }
          return null;
        },
      },
      readPlanArtifact() {
        return `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | - | accepted |
# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->
## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Structured State Confidence | implemented | 1 | 1 | - |
## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | - | execution finished |
## Next Unit
**NONE** - terminal outcome reached
`;
      },
      listPlanArtifacts() {
        return [];
      },
    });
    const { res, body } = await invoke(routes, 'GET', '/api/sessions/session-123/structured-state');
    assert.equal(res.statusCode, 200);
    assert.equal(body.meta.closureSummary.outcome, 'completed');
    assert.equal(body.meta.closureSummary.confidence, 'medium');
    assert.deepEqual(body.meta.closureSummary.validationCoverage, []);
    assert.ok(body.meta.closureSummary.validationEvidence.some((entry) => entry.includes('Review ledger verdict: APPROVED')));
  });
  await test('GET /api/sessions/:id/structured-state downgrades terminal closure when mandatory validation is still missing', async () => {
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
- Keep closure reporting aligned with validation governance.
## Exploration Summary
- docs/system/validation-governance.md
## User Constraints
- none
## Immediate Next Actions
- NONE
## Next Plan Ideas
- NONE
## Watch Outs
- Missing mandatory validation must stay explicit.
## Open Risks
- Integration validation has not run yet.
`;
          }
          if (String(targetPath).endsWith('proposition.md')) {
            return `## 2026-04-03T12:00:00Z - after-execution - workflow-executor
### Summary
- Structured-state now exposes validation-governance closure metadata.
### Immediate Next Actions
- NONE
### Next Plan Ideas
- NONE
### Watch Outs
- Do not mark the run as complete when required validation is missing.
### Open Risks
- Integration validation still has not run.
`;
          }
          if (String(targetPath).endsWith('verification-guide.md')) {
            return `## Summary
Structured-state now exposes validation-governance closure metadata.
## Changed Files
- copilot-ui/lib/sessionArtifacts.js
## Where to Verify
- API: GET /api/sessions/:id/structured-state
## Validation Requirements
- integration: Required for this cross-boundary workflow slice.
- browser: Not required for this non-UI change.
## Tested Coverage
- unit: Focused unit tests for the structured-state parser.
## Coverage Gaps
- integration: Validation did not run for this session.
## Verification Steps
- Run the focused structured-state tests.
## Expected Outcomes
- The closure summary stays paused when required validation is missing.
`;
          }
          if (String(targetPath).endsWith('execution-state.json')) {
            return JSON.stringify({
              schemaVersion: 'execution-state-v1',
              lifecycle: 'finished',
              status: 'completed',
              summary: 'Execution finished, but integration validation is still missing.',
            });
          }
          return null;
        },
      },
      readPlanArtifact() {
        return `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | - | accepted |
# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->
## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Validation Governance | implemented | 1 | 1 | - |
## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | - | execution finished |
## Next Unit
**NONE** - terminal outcome reached
## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: passed |
`;
      },
      listPlanArtifacts() {
        return [];
      },
    });
    const { res, body } = await invoke(routes, 'GET', '/api/sessions/session-123/structured-state');
    assert.equal(res.statusCode, 200);
    assert.equal(body.meta.closureSummary.reviewVerdict, 'APPROVED');
    assert.equal(body.meta.closureSummary.outcome, 'paused');
    assert.notEqual(body.meta.closureSummary.outcome, 'completed');
    assert.equal(body.meta.closureSummary.confidence, 'low');
    assert.deepEqual(body.meta.closureSummary.validationRequirements, [
      'integration: Required for this cross-boundary workflow slice.',
      'browser: Not required for this non-UI change.',
    ]);
    assert.deepEqual(body.meta.closureSummary.validationCoverage, [
      'unit: Focused unit tests for the structured-state parser.',
    ]);
    assert.deepEqual(body.meta.closureSummary.coverageGaps, [
      'integration: Validation did not run for this session.',
    ]);
    assert.ok(body.meta.closureSummary.blockers.includes('Mandatory validation is required but persisted validation coverage is incomplete.'));
  });
  await test('GET /api/sessions/:id/structured-state ignores unlabeled tested coverage and gaps', async () => {
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
- Keep closure reporting aligned with validation governance.
## Exploration Summary
- docs/system/validation-governance.md
## User Constraints
- none
## Immediate Next Actions
- NONE
## Next Plan Ideas
- NONE
## Watch Outs
- Missing mandatory validation must stay explicit.
## Open Risks
- Integration validation has not run yet.
`;
          }
          if (String(targetPath).endsWith('proposition.md')) {
            return `## 2026-04-03T12:00:00Z - after-execution - workflow-executor
### Summary
- Structured-state now exposes validation-governance closure metadata.
### Immediate Next Actions
- NONE
### Next Plan Ideas
- NONE
### Watch Outs
- Do not mark the run as complete when required validation is missing.
### Open Risks
- Integration validation still has not run.
`;
          }
          if (String(targetPath).endsWith('verification-guide.md')) {
            return `## Summary
Structured-state now exposes validation-governance closure metadata.
## Changed Files
- copilot-ui/lib/sessionArtifacts.js
## Where to Verify
- API: GET /api/sessions/:id/structured-state
## Validation Requirements
- integration: Required for this cross-boundary workflow slice.
- browser: Not required for this non-UI change.
## Tested Coverage
- Focused unit tests for the structured-state parser.
## Coverage Gaps
- Integration validation did not run for this session.
## Verification Steps
- Run the focused structured-state tests.
## Expected Outcomes
- The closure summary stays paused when required validation is missing.
`;
          }
          if (String(targetPath).endsWith('execution-state.json')) {
            return JSON.stringify({
              schemaVersion: 'execution-state-v1',
              lifecycle: 'finished',
              status: 'completed',
              summary: 'Execution finished, but integration validation is still missing.',
            });
          }
          return null;
        },
      },
      readPlanArtifact() {
        return `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | - | accepted |
# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->
## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Validation Governance | implemented | 1 | 1 | - |
## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | - | execution finished |
## Next Unit
**NONE** - terminal outcome reached
## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: passed |
`;
      },
      listPlanArtifacts() {
        return [];
      },
    });
    const { res, body } = await invoke(routes, 'GET', '/api/sessions/session-123/structured-state');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(body.meta.closureSummary.validationRequirements, [
      'integration: Required for this cross-boundary workflow slice.',
      'browser: Not required for this non-UI change.',
    ]);
    assert.deepEqual(body.meta.closureSummary.validationCoverage, []);
    assert.deepEqual(body.meta.closureSummary.coverageGaps, []);
    assert.ok(body.meta.closureSummary.blockers.includes('Mandatory validation is required but persisted validation coverage is incomplete.'));
  });
  await test('GET /api/sessions/:id/structured-state skips unversioned session-root artifacts for historical plan revisions', async () => {
    const assetReads = [];
    const routes = register({
      sendJson: createSendJson(),
      fs: createSessionFs(),
      assets: {
        readTextFileSafe(targetPath) {
          assetReads.push(String(targetPath));
          if (String(targetPath).endsWith('handoff.md')) {
            return `## Handoff Manifest
- Session: session-123
## Immediate Next Actions
- This current handoff must not contaminate historical reads.
`;
          }
          if (String(targetPath).endsWith('proposition.md')) {
            return `## 2026-03-23T12:00:00Z — after-execution — workflow-executor
### Summary
- This current proposition must not contaminate historical reads.
`;
          }
          if (String(targetPath).endsWith('verification-guide.md')) {
            return `## Summary
This current verification guide must not contaminate historical reads.
`;
          }
          if (String(targetPath).endsWith('execution-state.json')) {
            return JSON.stringify({
              schemaVersion: 'execution-state-v1',
              status: 'active',
              summary: 'Live overlay should not be applied to historical reads.',
            });
          }
          return null;
        },
      },
      readPlanArtifact(sessionDir, planId) {
        assert.equal(sessionDir, 'C:\\cli-home\\session-state\\session-123');
        assert.equal(planId, 'plan-2026-03-22T10-00-00Z');
        return `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |
# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->
## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Historical Revision | queued | 0 | 2 | — |
## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | queued | WU-002 | historical snapshot |
## Next Unit
**WU-002** — continue historical plan
`;
      },
      listPlanArtifacts() {
        return [];
      },
    });
    const { res, body } = await invoke(
      routes,
      {
        elegyHome: 'C:\\cli-home',
      },
      'GET',
      '/api/sessions/session-123/structured-state?planId=plan-2026-03-22T10-00-00Z'
    );
    assert.equal(res.statusCode, 200);
    assert.equal(body.planId, 'plan-2026-03-22T10-00-00Z');
    assert.equal(body.groups[0].status, 'queued');
    assert.equal(body.groups[0].planStatus, undefined);
    assert.equal(body.workUnits[0].status, 'queued');
    assert.equal(body.workUnits[0].planStatus, undefined);
    assert.equal(body.nextUnit.workUnitId, 'WU-002');
    assert.ok(!Object.prototype.hasOwnProperty.call(body.meta, 'executionOverlay'));
    assert.ok(!Object.prototype.hasOwnProperty.call(body.meta, 'executionState'));
    assert.ok(!Object.prototype.hasOwnProperty.call(body.meta, 'handoff'));
    assert.ok(!String(body.meta.intentFrame?.summary || '').includes('must not contaminate historical reads'));
    assert.ok(!assetReads.some((targetPath) => targetPath.endsWith('execution-state.json')));
    assert.ok(!assetReads.some((targetPath) => targetPath.endsWith('handoff.md')));
    assert.ok(!assetReads.some((targetPath) => targetPath.endsWith('proposition.md')));
    assert.ok(!assetReads.some((targetPath) => targetPath.endsWith('verification-guide.md')));
  });
  await test('GET /api/sessions/:id/structured-state still derives metadata without a progress tracker heading', async () => {
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
- Preserve derived session metadata for trackerless plans.
## Exploration Summary
- copilot-ui/lib/planState.js
## User Constraints
- Keep the fix narrowly scoped.
## Immediate Next Actions
- Resume the next targeted change.
## Next Plan Ideas
- Add broader coverage later.
## Watch Outs
- Do not block metadata on tracker parsing.
## Open Risks
- none
`;
          }
          if (String(targetPath).endsWith('proposition.md')) {
            return `## 2026-03-23T12:00:00Z — after-execution — workflow-executor
### Summary
- Trackerless plans still expose derived session metadata.
### Immediate Next Actions
- Resume the next targeted change.
### Details
Structured-state should keep review and framing metadata even without tracker sections.
`;
          }
          return null;
        },
      },
      readPlanArtifact() {
        return `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |
`;
      },
      listPlanArtifacts() {
        return [];
      },
    });
    const { res, body } = await invoke(routes, 'GET', '/api/sessions/session-123/structured-state');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(body.groups, []);
    assert.deepEqual(body.workUnits, []);
    assert.deepEqual(body.checkpoints, []);
    assert.equal(body.nextUnit, null);
    assert.ok(body.warnings.includes('No "# Plan-Pack Progress Tracker" heading found; treating as v0/unstructured'));
    assert.equal(body.meta.resume.ready, true);
    assert.equal(body.meta.intentFrame.summary, 'Trackerless plans still expose derived session metadata.');
    assert.equal(body.meta.closureSummary.reviewVerdict, 'APPROVED');
  });
  await test('GET /api/sessions/:id/final prefers derived compatibility closeout over raw final.md when structured closeout is available', async () => {
    const routes = register({
      fs: createSessionFs(),
      assets: {
        readTextFileSafe(targetPath) {
          if (String(targetPath).endsWith('final.md')) {
            return '## Summary\n- Compatibility-only final artifact.\n';
          }
          if (String(targetPath).endsWith('execution-state.json')) {
            return JSON.stringify({
              schemaVersion: 'execution-state-v1',
              lifecycle: 'closed',
              status: 'completed',
              summary: 'Structured closeout should override the legacy final artifact.',
            });
          }
          return null;
        },
      },
      planState: {
        parseStructuredState() {
          return {
            meta: {
              closureSummary: {
                summary: 'Structured closeout should override the legacy final artifact.',
                outcome: 'completed',
                validationRequirements: [
                  'integration: Preserve the canonical validation requirements section.',
                ],
                validationCoverage: [
                  'unit: Preserve the canonical tested coverage section.',
                ],
                coverageGaps: [
                  'integration: Cross-boundary validation still needs follow-up.',
                ],
              },
              executionState: {
                lifecycle: 'closed',
                status: 'completed',
                summary: 'Structured closeout should override the legacy final artifact.',
              },
            },
          };
        },
      },
      readPlanArtifact() {
        return '# Plan Pack\n';
      },
    });
    const res = createResponse();
    const u = new URL('http://127.0.0.1/api/sessions/session-123/final');
    const { route, match } = findRoute(routes, 'GET', u.pathname);
    route.handler({
      elegyHome: 'C:/copilot',
      sandboxesHome: 'C:/sandboxes',
      req: { __body: {} },
      res,
      u,
      match,
      pathname: u.pathname,
    });
    await sleep(0);
    assert.equal(res.statusCode, 200);
    assert.match(res.bodyText, /## Summary\r?\n- Structured closeout should override the legacy final artifact\./);
    assert.match(res.bodyText, /## Validation Requirements\r?\n- integration: Preserve the canonical validation requirements section\./);
    assert.match(res.bodyText, /## Tested Coverage\r?\n- unit: Preserve the canonical tested coverage section\./);
    assert.match(res.bodyText, /## Coverage Gaps\r?\n- integration: Cross-boundary validation still needs follow-up\./);
    assert.ok(!res.bodyText.includes('Compatibility-only final artifact.'));
  });
  await test('GET /api/sessions/:id/final falls back to raw final.md when no derived compatibility closeout is available', async () => {
    const routes = register({
      fs: createSessionFs(),
      assets: {
        readTextFileSafe(targetPath) {
          if (String(targetPath).endsWith('final.md')) {
            return '## Summary\n- Compatibility-only final artifact.\n';
          }
          return null;
        },
      },
      planState: {
        parseStructuredState() {
          return {
            meta: {
              closureSummary: {
                outcome: 'completed',
              },
              executionState: {
                lifecycle: 'closed',
                status: 'completed',
              },
            },
          };
        },
      },
      readPlanArtifact() {
        return '# Plan Pack\n';
      },
    });
    const res = createResponse();
    const u = new URL('http://127.0.0.1/api/sessions/session-123/final');
    const { route, match } = findRoute(routes, 'GET', u.pathname);
    route.handler({
      elegyHome: 'C:/copilot',
      sandboxesHome: 'C:/sandboxes',
      req: { __body: {} },
      res,
      u,
      match,
      pathname: u.pathname,
    });
    await sleep(0);
    assert.equal(res.statusCode, 200);
    assert.equal(res.bodyText, '## Summary\n- Compatibility-only final artifact.\n');
  });
  await test('GET /api/sessions/:id/final falls back to raw final.md when compatibility derivation throws after the legacy artifact is loaded', async () => {
    const assetReads = [];
    const routes = register({
      fs: createSessionFs(),
      assets: {
        readTextFileSafe(targetPath) {
          assetReads.push(String(targetPath));
          if (String(targetPath).endsWith('final.md')) {
            return '## Summary\n- Compatibility-only final artifact.\n';
          }
          if (String(targetPath).endsWith('execution-state.json')) {
            return JSON.stringify({
              schemaVersion: 'execution-state-v1',
              lifecycle: 'closed',
              status: 'completed',
            });
          }
          return null;
        },
      },
      planState: {
        parseStructuredState() {
          throw new Error('structured closeout derivation failed');
        },
      },
      readPlanArtifact() {
        return '# Plan Pack\n';
      },
    });
    const res = createResponse();
    const u = new URL('http://127.0.0.1/api/sessions/session-123/final');
    const { route, match } = findRoute(routes, 'GET', u.pathname);
    route.handler({
      elegyHome: 'C:/copilot',
      sandboxesHome: 'C:/sandboxes',
      req: { __body: {} },
      res,
      u,
      match,
      pathname: u.pathname,
    });
    await sleep(0);
    assert.equal(res.statusCode, 200);
    assert.equal(res.bodyText, '## Summary\n- Compatibility-only final artifact.\n');
    assert.ok(assetReads.some((targetPath) => targetPath.endsWith('final.md')));
  });
  await test('GET /api/sessions/:id/final derives a compatibility closeout from structured state when final.md is absent', async () => {
    const assetReads = [];
    const routes = register({
      fs: createSessionFs(),
      assets: {
        readTextFileSafe(targetPath) {
          assetReads.push(String(targetPath));
          if (String(targetPath).endsWith('handoff.md')) {
            return `## Handoff Manifest
- Session: session-123
- Plan: plan.md (status: APPROVED)
- Reviewer: Verdict: APPROVED
## Immediate Next Actions
- Resume stale handoff follow-up that should not survive terminal closeout.
`;
          }
          if (String(targetPath).endsWith('execution-state.json')) {
            return JSON.stringify({
              schemaVersion: 'execution-state-v1',
              lifecycle: 'closed',
              status: 'closed',
              summary: 'Runtime-derived closeout for compatibility clients.',
            });
          }
          return null;
        },
      },
      readPlanArtifact(sessionDir, planId) {
        assert.equal(sessionDir, 'C:\\copilot\\session-state\\session-123');
        assert.equal(planId, 'latest');
        return `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |
# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->
## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Compatibility closeout | implemented | 1 | 1 | — |
## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | — | closeout completed |
## Next Unit
NONE — terminal execution already completed
`;
      },
    });
    const res = createResponse();
    const u = new URL('http://127.0.0.1/api/sessions/session-123/final');
    const { route, match } = findRoute(routes, 'GET', u.pathname);
    route.handler({
      elegyHome: 'C:/copilot',
      sandboxesHome: 'C:/sandboxes',
      req: { __body: {} },
      res,
      u,
      match,
      pathname: u.pathname,
    });
    await sleep(0);
    assert.equal(res.statusCode, 200);
    assert.match(res.bodyText, /## Summary\r?\n- Runtime-derived closeout for compatibility clients\./);
    assert.match(res.bodyText, /## Status\r?\n- Outcome: completed/);
    assert.match(res.bodyText, /- Execution status: closed/);
    assert.ok(!res.bodyText.includes('Resume stale handoff follow-up'));
    assert.ok(assetReads.some((targetPath) => targetPath.endsWith('final.md')));
    assert.ok(assetReads.some((targetPath) => targetPath.endsWith('execution-state.json')));
  });
  await test('GET /api/sessions/:id/final preserves canonical validation sections when structured closure data provides them', async () => {
    const routes = register({
      fs: createSessionFs(),
      assets: {
        readTextFileSafe() {
          return null;
        },
      },
      planState: {
        parseStructuredState() {
          return {
            meta: {
              closureSummary: {
                summary: 'Compatibility closeout preserves validation governance buckets.',
                outcome: 'completed',
                validationRequirements: [
                  'integration: Required for this cross-boundary workflow slice.',
                ],
                validationCoverage: [
                  'unit: Focused unit coverage recorded for the compatibility formatter.',
                ],
                coverageGaps: [
                  'integration: Cross-boundary validation did not run in this session.',
                ],
                validationEvidence: [
                  'Review ledger verdict: APPROVED.',
                ],
              },
              executionState: {
                lifecycle: 'closed',
                status: 'completed',
                summary: 'Compatibility closeout preserves validation governance buckets.',
              },
            },
          };
        },
      },
      readPlanArtifact() {
        return '# Plan Pack\n';
      },
    });
    const res = createResponse();
    const u = new URL('http://127.0.0.1/api/sessions/session-123/final');
    const { route, match } = findRoute(routes, 'GET', u.pathname);
    route.handler({
      elegyHome: 'C:/copilot',
      sandboxesHome: 'C:/sandboxes',
      req: { __body: {} },
      res,
      u,
      match,
      pathname: u.pathname,
    });
    await sleep(0);
    assert.equal(res.statusCode, 200);
    assert.match(res.bodyText, /## Validation Requirements\r?\n- integration: Required for this cross-boundary workflow slice\./);
    assert.match(res.bodyText, /## Tested Coverage\r?\n- unit: Focused unit coverage recorded for the compatibility formatter\./);
    assert.match(res.bodyText, /## Coverage Gaps\r?\n- integration: Cross-boundary validation did not run in this session\./);
    assert.match(res.bodyText, /## Validation Evidence\r?\n- Review ledger verdict: APPROVED\./);
  });
  await test('GET /api/sessions/:id/final keeps not-required validation entries informational without synthesizing gaps', async () => {
    const routes = register({
      fs: createSessionFs(),
      assets: {
        readTextFileSafe() {
          return null;
        },
      },
      planState: {
        parseStructuredState() {
          return {
            meta: {
              closureSummary: {
                summary: 'Compatibility closeout should preserve waived validation without inventing gaps.',
                outcome: 'completed',
                validationRequirements: [
                  'browser: Not required for this non-UI workflow slice.',
                ],
                validationCoverage: [],
                coverageGaps: [],
              },
              executionState: {
                lifecycle: 'closed',
                status: 'completed',
                summary: 'Compatibility closeout should preserve waived validation without inventing gaps.',
              },
            },
          };
        },
      },
      readPlanArtifact() {
        return '# Plan Pack\n';
      },
    });
    const res = createResponse();
    const u = new URL('http://127.0.0.1/api/sessions/session-123/final');
    const { route, match } = findRoute(routes, 'GET', u.pathname);
    route.handler({
      elegyHome: 'C:/copilot',
      sandboxesHome: 'C:/sandboxes',
      req: { __body: {} },
      res,
      u,
      match,
      pathname: u.pathname,
    });
    await sleep(0);
    assert.equal(res.statusCode, 200);
    assert.match(res.bodyText, /## Validation Requirements\r?\n- browser: Not required for this non-UI workflow slice\./);
    assert.ok(!res.bodyText.includes('## Tested Coverage'));
    assert.ok(!res.bodyText.includes('## Coverage Gaps'));
    assert.ok(!res.bodyText.includes('Required validation coverage is still missing.'));
  });
  await test('GET /api/sessions/:id/final explicitly calls out missing required validation coverage', async () => {
    const routes = register({
      fs: createSessionFs(),
      assets: {
        readTextFileSafe() {
          return null;
        },
      },
      planState: {
        parseStructuredState() {
          return {
            meta: {
              closureSummary: {
                summary: 'Compatibility closeout must stay explicit when required validation is missing.',
                outcome: 'paused',
                validationRequirements: [
                  'integration: Required before this workflow can be treated as complete.',
                ],
                validationCoverage: [],
                coverageGaps: [],
                blockers: [
                  'Mandatory validation is required but persisted validation coverage is incomplete.',
                ],
              },
              executionState: {
                lifecycle: 'finished',
                status: 'completed',
                summary: 'Compatibility closeout must stay explicit when required validation is missing.',
              },
            },
          };
        },
      },
      readPlanArtifact() {
        return '# Plan Pack\n';
      },
    });
    const res = createResponse();
    const u = new URL('http://127.0.0.1/api/sessions/session-123/final');
    const { route, match } = findRoute(routes, 'GET', u.pathname);
    route.handler({
      elegyHome: 'C:/copilot',
      sandboxesHome: 'C:/sandboxes',
      req: { __body: {} },
      res,
      u,
      match,
      pathname: u.pathname,
    });
    await sleep(0);
    assert.equal(res.statusCode, 200);
    assert.match(res.bodyText, /## Validation Requirements\r?\n- integration: Required before this workflow can be treated as complete\./);
    assert.match(res.bodyText, /## Tested Coverage\r?\n- None recorded\./);
    assert.match(
      res.bodyText,
      /## Coverage Gaps\r?\n- Mandatory validation is required but persisted validation coverage is incomplete\.\r?\n- integration: Required validation coverage is still missing\./,
    );
  });
  await test('GET /api/sessions/:id/final keeps labeled mandatory requirements explicit when unrelated coverage exists', async () => {
    const routes = register({
      fs: createSessionFs(),
      assets: {
        readTextFileSafe() {
          return null;
        },
      },
      planState: {
        parseStructuredState() {
          return {
            meta: {
              closureSummary: {
                summary: 'Compatibility closeout must keep labeled required validation visible.',
                outcome: 'paused',
                validationRequirements: [
                  'integration: Required before this workflow can be treated as complete.',
                ],
                validationCoverage: [
                  'unit: Focused unit coverage recorded for the compatibility formatter.',
                ],
                coverageGaps: [],
              },
              executionState: {
                lifecycle: 'finished',
                status: 'completed',
                summary: 'Compatibility closeout must keep labeled required validation visible.',
              },
            },
          };
        },
      },
      readPlanArtifact() {
        return '# Plan Pack\n';
      },
    });
    const res = createResponse();
    const u = new URL('http://127.0.0.1/api/sessions/session-123/final');
    const { route, match } = findRoute(routes, 'GET', u.pathname);
    route.handler({
      elegyHome: 'C:/copilot',
      sandboxesHome: 'C:/sandboxes',
      req: { __body: {} },
      res,
      u,
      match,
      pathname: u.pathname,
    });
    await sleep(0);
    assert.equal(res.statusCode, 200);
    assert.match(res.bodyText, /## Validation Requirements\r?\n- integration: Required before this workflow can be treated as complete\./);
    assert.match(res.bodyText, /## Tested Coverage\r?\n- unit: Focused unit coverage recorded for the compatibility formatter\./);
    assert.match(res.bodyText, /## Coverage Gaps\r?\n- integration: Required validation coverage is still missing\./);
  });
  await test('GET /api/sessions/:id/final keeps unlabeled mandatory requirements explicit when other coverage exists', async () => {
    const routes = register({
      fs: createSessionFs(),
      assets: {
        readTextFileSafe() {
          return null;
        },
      },
      planState: {
        parseStructuredState() {
          return {
            meta: {
              closureSummary: {
                summary: 'Compatibility closeout must keep unlabeled required validation visible.',
                outcome: 'paused',
                validationRequirements: [
                  'Required before this workflow can be treated as complete.',
                ],
                validationCoverage: [
                  'unit: Focused unit coverage recorded for the compatibility formatter.',
                ],
                coverageGaps: [],
              },
              executionState: {
                lifecycle: 'finished',
                status: 'completed',
                summary: 'Compatibility closeout must keep unlabeled required validation visible.',
              },
            },
          };
        },
      },
      readPlanArtifact() {
        return '# Plan Pack\n';
      },
    });
    const res = createResponse();
    const u = new URL('http://127.0.0.1/api/sessions/session-123/final');
    const { route, match } = findRoute(routes, 'GET', u.pathname);
    route.handler({
      elegyHome: 'C:/copilot',
      sandboxesHome: 'C:/sandboxes',
      req: { __body: {} },
      res,
      u,
      match,
      pathname: u.pathname,
    });
    await sleep(0);
    assert.equal(res.statusCode, 200);
    assert.match(res.bodyText, /## Validation Requirements\r?\n- Required before this workflow can be treated as complete\./);
    assert.match(res.bodyText, /## Tested Coverage\r?\n- unit: Focused unit coverage recorded for the compatibility formatter\./);
    assert.match(res.bodyText, /## Coverage Gaps\r?\n- Unlabeled mandatory validation requirement remains unresolved: Required before this workflow can be treated as complete\./);
  });
  await test('GET /api/sessions/:id/final promotes blocker-only validation gaps when requirements are absent', async () => {
    const routes = register({
      fs: createSessionFs(),
      assets: {
        readTextFileSafe() {
          return null;
        },
      },
      planState: {
        parseStructuredState() {
          return {
            meta: {
              closureSummary: {
                summary: 'Compatibility closeout must surface blocker-only validation gaps.',
                outcome: 'paused',
                validationRequirements: [],
                validationCoverage: [],
                coverageGaps: [],
                blockers: [
                  'browser: Browser-driven validation did not run in this session.',
                ],
              },
              executionState: {
                lifecycle: 'finished',
                status: 'completed',
                summary: 'Compatibility closeout must surface blocker-only validation gaps.',
              },
            },
          };
        },
      },
      readPlanArtifact() {
        return '# Plan Pack\n';
      },
    });
    const res = createResponse();
    const u = new URL('http://127.0.0.1/api/sessions/session-123/final');
    const { route, match } = findRoute(routes, 'GET', u.pathname);
    route.handler({
      elegyHome: 'C:/copilot',
      sandboxesHome: 'C:/sandboxes',
      req: { __body: {} },
      res,
      u,
      match,
      pathname: u.pathname,
    });
    await sleep(0);
    assert.equal(res.statusCode, 200);
    assert.ok(!res.bodyText.includes('## Validation Requirements'));
    assert.match(res.bodyText, /## Tested Coverage\r?\n- None recorded\./);
    assert.match(res.bodyText, /## Coverage Gaps\r?\n- browser: Browser-driven validation did not run in this session\./);
  });
  await test('GET /api/sessions/:id/final keeps legacy validation evidence output when canonical buckets are absent', async () => {
    const routes = register({
      fs: createSessionFs(),
      assets: {
        readTextFileSafe() {
          return null;
        },
      },
      planState: {
        parseStructuredState() {
          return {
            meta: {
              closureSummary: {
                summary: 'Compatibility closeout still supports legacy evidence-only sessions.',
                outcome: 'completed',
                validationEvidence: [
                  'Legacy validation evidence remains visible.',
                ],
              },
              executionState: {
                lifecycle: 'closed',
                status: 'completed',
                summary: 'Compatibility closeout still supports legacy evidence-only sessions.',
              },
            },
          };
        },
      },
      readPlanArtifact() {
        return '# Plan Pack\n';
      },
    });
    const res = createResponse();
    const u = new URL('http://127.0.0.1/api/sessions/session-123/final');
    const { route, match } = findRoute(routes, 'GET', u.pathname);
    route.handler({
      elegyHome: 'C:/copilot',
      sandboxesHome: 'C:/sandboxes',
      req: { __body: {} },
      res,
      u,
      match,
      pathname: u.pathname,
    });
    await sleep(0);
    assert.equal(res.statusCode, 200);
    assert.match(res.bodyText, /## Validation Evidence\r?\n- Legacy validation evidence remains visible\./);
    assert.ok(!res.bodyText.includes('## Validation Requirements'));
    assert.ok(!res.bodyText.includes('## Tested Coverage'));
    assert.ok(!res.bodyText.includes('## Coverage Gaps'));
  });
  await test('GET /api/sessions/:id/final does not derive compatibility closeout from non-terminal closure summaries alone', async () => {
    const routes = register({
      fs: createSessionFs(),
      assets: {
        readTextFileSafe(targetPath) {
          if (String(targetPath).endsWith('verification-guide.md')) {
            return `## Summary
In-progress verification notes that should not unlock compatibility final reads.
## Changed Files
- copilot-ui/routes/sessions.js
## Where To Verify
- Session Detail
## Verification Steps
- Review the latest structured state
## Expected Outcomes
- Compatibility clients still receive 404 until terminal closeout exists.
`;
          }
          return null;
        },
      },
      readPlanArtifact(sessionDir, planId) {
        assert.equal(sessionDir, 'C:\\copilot\\session-state\\session-123');
        assert.equal(planId, 'latest');
        return `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |
# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->
## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Compatibility closeout | in_progress | 0 | 1 | — |
## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | in_progress | WU-001 | verification still running |
## Next Unit
WU-001 — Continue execution
`;
      },
    });
    const res = createResponse();
    const u = new URL('http://127.0.0.1/api/sessions/session-123/final');
    const { route, match } = findRoute(routes, 'GET', u.pathname);
    route.handler({
      elegyHome: 'C:/copilot',
      sandboxesHome: 'C:/sandboxes',
      req: { __body: {} },
      res,
      u,
      match,
      pathname: u.pathname,
    });
    await sleep(0);
    assert.equal(res.statusCode, 404);
    assert.equal(res.bodyText, 'Not found');
  });
  await test('GET /api/sessions/:id/final still requires terminal runtime evidence even when closure summary looks terminal', async () => {
    const routes = register({
      fs: createSessionFs(),
      assets: {
        readTextFileSafe() {
          return null;
        },
      },
      planState: {
        parseStructuredState() {
          return {
            meta: {
              closureSummary: {
                finality: 'terminal',
                summary: 'Derived closure summary claims terminal finality without runtime proof.',
                outcome: 'completed',
              },
              executionState: null,
            },
          };
        },
      },
      readPlanArtifact(sessionDir, planId) {
        assert.equal(sessionDir, 'C:\\copilot\\session-state\\session-123');
        assert.equal(planId, 'latest');
        return '# Plan Pack\n';
      },
    });
    const res = createResponse();
    const u = new URL('http://127.0.0.1/api/sessions/session-123/final');
    const { route, match } = findRoute(routes, 'GET', u.pathname);
    route.handler({
      elegyHome: 'C:/copilot',
      sandboxesHome: 'C:/sandboxes',
      req: { __body: {} },
      res,
      u,
      match,
      pathname: u.pathname,
    });
    await sleep(0);
    assert.equal(res.statusCode, 404);
    assert.equal(res.bodyText, 'Not found');
  });
  await test('GET /api/sessions/:id/final does not derive compatibility closeout for in-progress execution summaries', async () => {
    const routes = register({
      fs: createSessionFs(),
      assets: {
        readTextFileSafe(targetPath) {
          if (String(targetPath).endsWith('execution-state.json')) {
            return JSON.stringify({
              schemaVersion: 'execution-state-v1',
              lifecycle: 'active',
              status: 'running',
              summary: 'Runtime progress summary that should not be treated as final closeout.',
            });
          }
          return null;
        },
      },
      readPlanArtifact(sessionDir, planId) {
        assert.equal(sessionDir, 'C:\\copilot\\session-state\\session-123');
        assert.equal(planId, 'latest');
        return `# Plan Pack
# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->
## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Runtime execution | in_progress | 0 | 1 | — |
## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | in_progress | WU-001 | still working |
## Next Unit
WU-001 — Continue execution
`;
      },
    });
    const res = createResponse();
    const u = new URL('http://127.0.0.1/api/sessions/session-123/final');
    const { route, match } = findRoute(routes, 'GET', u.pathname);
    route.handler({
      elegyHome: 'C:/copilot',
      sandboxesHome: 'C:/sandboxes',
      req: { __body: {} },
      res,
      u,
      match,
      pathname: u.pathname,
    });
    await sleep(0);
    assert.equal(res.statusCode, 404);
    assert.equal(res.bodyText, 'Not found');
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
          assert.equal(input.elegyHome, 'C:\\cli-home');
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
      elegyHome: 'C:\\cli-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'GET', '/api/sessions/session-usage/agent-usage');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(body.usage, { reviewer: 2 });
    assert.equal(body.skillUsage.totalInvocations, 1);
    assert.equal(body.skillUsage.uniqueSkillCount, 1);
    assert.equal(body.skillUsage.skills[0].assetId, 'skill-react-query');
  });
  await test('GET /api/sessions/:id/proposition resolves sandbox artifact reads from the specific sandbox root', async () => {
    const assetReads = [];
    const routes = register({
      sendJson: createSendJson(),
      assets: {
        readTextFileSafe(targetPath) {
          assetReads.push(String(targetPath));
          return '# Proposition\n\nSandbox-specific artifact.\n';
        },
      },
      sessionArtifacts: {
        parsePropositionText() {
          return {
            entries: [],
          };
        },
      },
    });
    const { res, body } = await invoke(routes, {
      elegyHome: 'C:\\cli-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'GET', '/api/sessions/session-sandbox/proposition?source=sandbox&sandbox=sandbox-42');
    assert.equal(res.statusCode, 200);
    assert.equal(body.source, 'sandbox');
    assert.equal(assetReads[0], 'C:\\sandboxes-home\\sandbox-42\\session-state\\session-sandbox\\proposition.md');
  });
  await test('GET /api/sessions/:id sandbox detail and artifact reads require a sandbox discriminator', async () => {
    const assetReads = [];
    const routes = register({
      sendJson: createSendJson(),
      fs: createSessionFs(),
      readPlanArtifact() {
        return '# Plan\n';
      },
      assets: {
        readTextFileSafe(targetPath) {
          assetReads.push(String(targetPath));
          return '# Artifact\n';
        },
      },
      planState: {
        parseStructuredState() {
          return {
            warnings: [],
            nextUnit: null,
            meta: {},
          };
        },
      },
      sessionArtifacts: {
        parsePropositionText() {
          return { entries: [] };
        },
      },
    });
    const structuredStateResponse = await invoke(routes, {
      elegyHome: 'C:\\cli-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'GET', '/api/sessions/session-sandbox/structured-state?source=sandbox');
    const propositionResponse = await invoke(routes, {
      elegyHome: 'C:\\cli-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'GET', '/api/sessions/session-sandbox/proposition?source=sandbox');
    assert.equal(structuredStateResponse.res.statusCode, 400);
    assert.equal(structuredStateResponse.body.error, 'Missing sandbox id');
    assert.equal(propositionResponse.res.statusCode, 400);
    assert.equal(propositionResponse.body.error, 'Missing sandbox id');
    assert.deepEqual(assetReads, []);
  });
  await test('GET /api/sessions/:id/continuation-package returns a portable continuation package for the requested harness', async () => {
    const assetReads = [];
    const routes = register({
      sendJson: createSendJson(),
      fs: createSessionFs(),
      readPlanArtifact(sessionDir, planId) {
        assert.equal(sessionDir, 'C:\\cli-home\\session-state\\session-continue');
        assert.equal(planId, 'latest');
        return [
          '<!-- IE_PLAN_REF: session:session-continue -->',
          '<!-- IE_LINKED_BACKLOG_IDS: RB-200 -->',
          '<!-- IE_LINKED_ROADMAP_IDS: RM-platform -->',
          '',
          '# Plan Pack',
          '',
          '## Goal',
          '',
          'Ship portable continuation exports.',
        ].join('\n');
      },
      assets: {
        readTextFileSafe(targetPath) {
          assetReads.push(String(targetPath));
          if (String(targetPath).endsWith('handoff.md')) {
            return '# Handoff\n';
          }
          if (String(targetPath).endsWith('proposition.md')) {
            return '# Proposition\n';
          }
          if (String(targetPath).endsWith('verification-guide.md')) {
            return '# Verification Guide\n';
          }
          if (String(targetPath).endsWith('execution-state.json')) {
            return JSON.stringify({ status: 'active' });
          }
          return null;
        },
      },
      planState: {
        parseStructuredState(planText, options) {
          assert.equal(options.sessionId, 'session-continue');
          assert.match(planText, /portable continuation exports/);
          return {
            meta: {
              intentFrame: {
                summary: 'Continue the export implementation.',
                constraints: ['Keep exports explicit.'],
                watchOuts: ['Do not rely on hidden memory.'],
                nextSuggestedUnits: ['Finish the UI export actions.'],
                inScope: ['Add route coverage.'],
                carryoverSignals: ['Roadmap continuity remains required.'],
                outOfScope: ['Native session-store migration.'],
                sourceArtifacts: ['plan.md'],
              },
              closureSummary: {
                summary: 'Backend export routes landed; UI follow-up remains.',
                blockers: ['Session detail export buttons are still pending.'],
                coverageGaps: ['Route tests still need to run.'],
                roadmapIds: ['RM-platform'],
                followUps: {
                  activeContinuation: ['Wire Codex and OpenCode export actions.'],
                  durableCarryover: ['Keep roadmap artifacts portable across harnesses.'],
                },
              },
              resume: {
                blockers: ['Confirm copy/export UX in session detail.'],
              },
            },
          };
        },
      },
      sessionPlanRoadmapSync: {
        parsePlanSyncMarkers(planText) {
          assert.match(planText, /IE_PLAN_REF/);
          return {
            planRef: 'session:session-continue',
            linkedBacklogIds: ['RB-200'],
            linkedRoadmapIds: ['RM-platform'],
          };
        },
      },
      sessions: {
        readRecentEvents(sessionDir, limit) {
          assert.equal(sessionDir, 'C:\\cli-home\\session-state\\session-continue');
          assert.equal(limit, 120);
          return [
            {
              type: 'user.message',
              payload: { content: 'Can we continue this in Codex?' },
              timestamp: '2026-05-19T10:00:00.000Z',
            },
            {
              type: 'assistant.message',
              payload: { content: 'Yes, export a continuation package first.' },
              timestamp: '2026-05-19T10:01:00.000Z',
            },
          ];
        },
      },
      repoInventory: {
        listKnownRepos() {
          return {
            selectedRepo: {
              repoId: 'repo-1',
              repoPath: 'C:\\repo',
              repoLabel: 'Repo One',
            },
          };
        },
        resolveRepoEntry(inventory) {
          return inventory.selectedRepo;
        },
      },
      sdkBridge: {
        getSdkSession(sessionId) {
          assert.equal(sessionId, 'session-continue');
          return {
            sessionId,
            cwd: 'C:\\repo',
            orchestration: {
              repo: {
                repoId: 'repo-1',
                repoPath: 'C:\\repo',
                repoLabel: 'Repo One',
                branch: 'main',
              },
              workflow: {
                model: 'gpt-5.4',
              },
            },
          };
        },
      },
      sessionArtifacts: {
        deriveSessionObjective() {
          return 'Ship portable continuation exports.';
        },
      },
    });
    const { res, body } = await invoke(routes, {
      elegyHome: 'C:\\cli-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'GET', '/api/sessions/session-continue/continuation-package?targetHarness=codex');
    assert.equal(res.statusCode, 200);
    assert.equal(body.contractVersion, CONTINUATION_PACKAGE_CONTRACT_VERSION);
    assert.equal(body.kind, 'session.continuation-package');
    assert.equal(body.targetHarness, 'codex');
    assert.equal(body.source.kind, 'session');
    assert.equal(body.source.sessionId, 'session-continue');
    assert.equal(body.source.sessionSource, 'cli');
    assert.equal(body.repo.repoId, 'repo-1');
    assert.equal(body.repo.branch, 'main');
    assert.deepEqual(body.roadmap.roadmapIds, ['RM-platform']);
    assert.deepEqual(body.roadmap.linkedBacklogIds, ['RB-200']);
    assert.ok(body.constraints.includes('Keep exports explicit.'));
    assert.ok(body.openQuestions.includes('Confirm copy/export UX in session detail.'));
    assert.ok(body.nextActions.includes('Wire Codex and OpenCode export actions.'));
    assert.ok(body.carryover.includes('Keep roadmap artifacts portable across harnesses.'));
    assert.ok(body.skillsRequired.includes('implementation-handoff'));
    assert.ok(body.skillsRequired.includes('roadmap-planning'));
    assert.deepEqual(body.transcriptExcerpt.map((entry) => entry.role), ['user', 'assistant']);
    assert.match(body.prompt.title, /Codex/);
    assert.match(body.prompt.text, /Continue this discussion in Codex\./);
    assert.ok(assetReads.some((targetPath) => targetPath.endsWith('handoff.md')));
    assert.ok(assetReads.some((targetPath) => targetPath.endsWith('execution-state.json')));
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
      elegyHome: 'C:\\cli-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'POST', '/api/sessions/plan', {
      title: 'Planning follow-up',
      content: '# Planning follow-up\n\n## Problem\n\nClose the planning gap.\n',
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\elegy-copilot',
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
      elegyHome: 'C:\\cli-home',
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
  await test('POST /api/sessions/plan writes sandbox plans beneath the requested sandbox session-state root', async () => {
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
        existsSync() {
          return false;
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
      elegyHome: 'C:\\cli-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'POST', '/api/sessions/plan?source=sandbox&sandbox=sandbox-42', {
      title: 'Sandbox planning follow-up',
      content: '# Sandbox planning follow-up\n',
    });
    assert.equal(res.statusCode, 200);
    assert.equal(body.source, 'sandbox');
    assert.deepEqual(ensuredDirs, ['C:\\sandboxes-home\\sandbox-42\\session-state\\planning-uuid-123']);
    assert.equal(
      writes.every((entry) => String(entry.targetPath).startsWith('C:\\sandboxes-home\\sandbox-42\\session-state\\planning-uuid-123\\')),
      true
    );
  });
  await test('POST /api/sessions/plan sandbox writes fail closed when the sandbox discriminator is missing or invalid', async () => {
    const writes = [];
    const ensuredDirs = [];
    const routes = register({
      sendJson: createSendJson(),
      readJsonBody: async (req) => req.__body || {},
      ensureDir(targetPath) {
        ensuredDirs.push(targetPath);
      },
      fs: {
        existsSync() {
          return false;
        },
        writeFileSync(targetPath, content, encoding) {
          writes.push({ kind: 'write', targetPath, content, encoding });
        },
        appendFileSync(targetPath, content, encoding) {
          writes.push({ kind: 'append', targetPath, content, encoding });
        },
      },
    });
    const missingSandbox = await invoke(routes, {
      elegyHome: 'C:\\cli-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'POST', '/api/sessions/plan?source=sandbox', {
      content: '# Missing sandbox\n',
    });
    assert.equal(missingSandbox.res.statusCode, 400);
    assert.equal(missingSandbox.body.error, 'Missing sandbox id');
    const invalidSandbox = await invoke(routes, {
      elegyHome: 'C:\\cli-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'POST', '/api/sessions/plan?source=sandbox&sandbox=bad%2Fid', {
      content: '# Invalid sandbox\n',
    });
    assert.equal(invalidSandbox.res.statusCode, 400);
    assert.equal(invalidSandbox.body.error, 'sandboxId must use only alphanumeric and hyphen characters');
    assert.deepEqual(ensuredDirs, []);
    assert.deepEqual(writes, []);
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
              filePath: 'C:\\repo\\docs\\planning\\platform-foundation\\index.md',
              repoRelativePath: 'docs/planning/platform-foundation/index.md',
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
      elegyHome: 'C:\\cli-home',
      elegyHomeAbs: 'C:\\cli-home',
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
