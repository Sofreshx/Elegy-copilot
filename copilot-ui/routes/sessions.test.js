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
| 1 | reviewer-opus-4-6 | APPROVED | — | accepted |

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
    assert.deepEqual(body.meta.closureSummary.changedFiles, ['copilot-ui/routes/sessions.js']);
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
| 1 | reviewer-opus-4-6 | APPROVED | — | accepted |

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
        copilotHome: 'C:\\cli-home',
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
| 1 | reviewer-opus-4-6 | APPROVED | — | accepted |
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

  await test('GET /api/sessions/:id/final remains a compatibility read-only surface', async () => {
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
    });

    const res = createResponse();
    const u = new URL('http://127.0.0.1/api/sessions/session-123/final');
    const { route, match } = findRoute(routes, 'GET', u.pathname);
    route.handler({
      copilotHome: 'C:/copilot',
      vscodeHome: 'C:/vscode',
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
| 1 | reviewer-opus-4-6 | APPROVED | — | accepted |

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
      copilotHome: 'C:/copilot',
      vscodeHome: 'C:/vscode',
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
| 1 | reviewer-opus-4-6 | APPROVED | — | accepted |

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
      copilotHome: 'C:/copilot',
      vscodeHome: 'C:/vscode',
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
      copilotHome: 'C:/copilot',
      vscodeHome: 'C:/vscode',
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
      copilotHome: 'C:/copilot',
      vscodeHome: 'C:/vscode',
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
      copilotHome: 'C:\\cli-home',
      vscodeHome: 'C:\\vscode-home',
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
      copilotHome: 'C:\\cli-home',
      vscodeHome: 'C:\\vscode-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'GET', '/api/sessions/session-sandbox/structured-state?source=sandbox');

    const propositionResponse = await invoke(routes, {
      copilotHome: 'C:\\cli-home',
      vscodeHome: 'C:\\vscode-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'GET', '/api/sessions/session-sandbox/proposition?source=sandbox');

    assert.equal(structuredStateResponse.res.statusCode, 400);
    assert.equal(structuredStateResponse.body.error, 'Missing sandbox id');
    assert.equal(propositionResponse.res.statusCode, 400);
    assert.equal(propositionResponse.body.error, 'Missing sandbox id');
    assert.deepEqual(assetReads, []);
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
      copilotHome: 'C:\\cli-home',
      vscodeHome: 'C:\\vscode-home',
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
      copilotHome: 'C:\\cli-home',
      vscodeHome: 'C:\\vscode-home',
      sandboxesHome: 'C:\\sandboxes-home',
    }, 'POST', '/api/sessions/plan?source=sandbox', {
      content: '# Missing sandbox\n',
    });
    assert.equal(missingSandbox.res.statusCode, 400);
    assert.equal(missingSandbox.body.error, 'Missing sandbox id');

    const invalidSandbox = await invoke(routes, {
      copilotHome: 'C:\\cli-home',
      vscodeHome: 'C:\\vscode-home',
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
