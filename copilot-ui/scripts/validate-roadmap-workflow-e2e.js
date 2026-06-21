'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('../server');
const { startDesktopPlanningPersistence } = require('../lib/desktopPlanningPersistence');
function mkdtemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}
function writeJson(filePath, value) {
  writeFile(filePath, JSON.stringify(value, null, 2) + '\n');
}
async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}
async function waitFor(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}
function buildRoadmapMarkdown() {
  return [
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
    'Sequenced outcomes for roadmap workflow persistence.',
    '',
    '## Roadmap Items',
    '',
    '### RM-platform-foundation-001 — Bootstrap roadmap storage',
    '- Phase: foundation',
    '- Status: planned',
    '- Summary: Add first workflow persistence path.',
    '- Backlog IDs: RB-001',
    '- Plan Refs: none',
    '- Satisfied By Plan Ref: none',
    '- Superseded By Plan Ref: none',
    '- Abandoned By Plan Ref: none',
    '',
  ].join('\n');
}
function buildWorkflowArtifactMarkdown() {
  return [
    '# Review',
    '',
    'Validation passed for the first workflow persistence bridge.',
    '',
    '## Structured State',
    '```json',
    JSON.stringify({
      kind: 'roadmap.review.result',
      roadmapId: 'RM-platform-foundation',
      sliceId: 'RM-platform-foundation-001',
      phase: 'review',
      status: 'pass',
      repoId: 'repo-elegy-copilot-fixture',
      sourceHarness: 'opencode',
      sourceModel: 'github-copilot/gpt-5.4',
      sessionId: 'session-e2e-1',
      followUps: ['Expose workflow status in Planning UI'],
      requiresUserDecision: false,
      suggestedNextAction: 'render-workflow-state',
      roadmapImpact: 'Review is complete but UI visibility is still missing.',
      acceptance: {
        allPassed: true,
        failedChecks: [],
        passedChecks: ['node copilot-ui/routes/planning.test.js'],
      },
      memoryCandidates: [{
        kind: 'roadmap-review-summary',
        summary: 'Roadmap review for RM-platform-foundation-001 passed and points to rendering workflow state next.',
      }],
    }, null, 2),
    '```',
    '',
  ].join('\n');
}
async function main() {
  const root = mkdtemp('elegy-copilot-roadmap-e2e-');
  const repoRoot = path.join(root, 'repo');
  const elegyHome = path.join(root, '.elegy');
  const sandboxesHome = path.join(elegyHome, 'sandboxes');
  const planningStateRoot = path.join(root, 'planning-db');
  const elegyDbPath = path.join(root, 'elegy-memory.db');
  const elegyPlanningDbPath = path.join(root, 'elegy-planning.db');
  const elegyCliPath = path.join(
    'C:',
    'Users',
    'lolzi',
    'Documents',
    'GitHub',
    'Elegy',
    'rust',
    'target',
    'debug',
    'elegy-memory.exe',
  );
  const elegyPlanningCliPath = path.join(
    'C:',
    'Users',
    'lolzi',
    'Documents',
    'GitHub',
    'Elegy',
    'rust',
    'target',
    'debug',
    'elegy-planning.exe',
  );
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(elegyHome, { recursive: true });  fs.mkdirSync(sandboxesHome, { recursive: true });
  fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
  writeFile(path.join(repoRoot, 'docs', 'planning', 'platform-foundation', 'index.md'), buildRoadmapMarkdown());
  writeJson(path.join(elegyHome, 'catalog', 'repo-inventory.json'), {
    schemaVersion: 1,
    selectedRepoId: 'repo-elegy-copilot-fixture',
    selectedRepoPath: repoRoot,
    selectedAt: new Date().toISOString(),
    manualRepos: [{
      repoId: 'repo-elegy-copilot-fixture',
      repoPath: repoRoot,
      repoLabel: 'Elegy Copilot Fixture',
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pinned: true,
      lastActivityMs: Date.now(),
      canonicalRemote: null,
    }],
  });
  const planningPersistence = await startDesktopPlanningPersistence({
    stateRoot: planningStateRoot,
    logger: () => {},
  });
  const server = await startServer({
    port: 0,
    host: '127.0.0.1',
    quiet: true,
    engineRoot: path.resolve(__dirname, '..', '..'),
    elegyHome,    sandboxesHome,
    planningPersistenceClient: planningPersistence.queryClient,
    env: {
      ...process.env,
      INSTRUCTION_ENGINE_DISABLE_STARTUP_ASSET_SYNC: '1',
      INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED: '0',
      INSTRUCTION_ENGINE_PLANNING_DB_URL: planningPersistence.connectionString,
      INSTRUCTION_ENGINE_ELEGY_MEMORY_CLI_PATH: elegyCliPath,
      INSTRUCTION_ENGINE_ELEGY_MEMORY_DB_PATH: elegyDbPath,
      INSTRUCTION_ENGINE_ELEGY_PLANNING_ENABLED: '1',
      INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH: elegyPlanningCliPath,
      INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH: elegyPlanningDbPath,
    },
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  try {
    await waitFor(`${baseUrl}/api/health`);
    const persistResponse = await requestJson(baseUrl, '/api/planning/workflow-artifacts', {
      method: 'POST',
      body: {
        repoId: 'repo-elegy-copilot-fixture',
        artifact: {
          body: buildWorkflowArtifactMarkdown(),
        },
      },
    });
    assert.equal(persistResponse.status, 200);
    assert.equal(persistResponse.body.kind, 'planning.workflow-artifact.persist');
    assert.equal(persistResponse.body.artifact.roadmapId, 'RM-platform-foundation');
    assert.equal(persistResponse.body.artifact.sliceId, 'RM-platform-foundation-001');
    assert.ok(persistResponse.body.memorySync);
    assert.equal(persistResponse.body.memorySync.status, 'synced');
    assert.equal(persistResponse.body.memorySync.synced, 1);
    assert.ok(Array.isArray(persistResponse.body.memorySync.memoryIds));
    assert.equal(persistResponse.body.memorySync.memoryIds.length, 1);
    assert.ok(persistResponse.body.elegyPlanningSync);
    assert.equal(persistResponse.body.elegyPlanningSync.status, 'synced');
    assert.equal(persistResponse.body.elegyPlanningSync.synced, 3);
    assert.equal(persistResponse.body.elegyPlanningSync.validationStatus, 'valid');
    assert.deepEqual(persistResponse.body.elegyPlanningSync.entities, {
      goalId: 'ie-goal-RM-platform-foundation',
      roadmapId: 'RM-platform-foundation',
      workPointId: 'RM-platform-foundation-001',
    });
    const retiredRoadmapsResponse = await requestJson(
      baseUrl,
      `/api/planning/roadmaps?repoId=repo-elegy-copilot-fixture&repoPath=${encodeURIComponent(repoRoot)}`,
    );
    assert.equal(retiredRoadmapsResponse.status, 410);
    assert.equal(retiredRoadmapsResponse.body.kind, 'planning.roadmaps.list');
    assert.equal(retiredRoadmapsResponse.body.code, 'planning_repo_file_authority_retired');
    const retiredRoadmapResponse = await requestJson(
      baseUrl,
      `/api/planning/roadmaps/platform-foundation?repoId=repo-elegy-copilot-fixture&repoPath=${encodeURIComponent(repoRoot)}`,
    );
    assert.equal(retiredRoadmapResponse.status, 410);
    assert.equal(retiredRoadmapResponse.body.kind, 'planning.roadmaps.read');
    const workflowReadResponse = await requestJson(
      baseUrl,
      `/api/planning/workflow-artifacts?artifactId=${encodeURIComponent(persistResponse.body.artifact.artifactId)}&repoId=repo-elegy-copilot-fixture`,
    );
    assert.equal(workflowReadResponse.status, 200);
    assert.equal(workflowReadResponse.body.artifact.kind, 'roadmap.review.result');
    const planningRoadmapShow = await new Promise((resolve, reject) => {
      const childProcess = require('node:child_process');
      childProcess.execFile(
        elegyPlanningCliPath,
        [
          '--json',
          '--non-interactive',
          '--correlation-id',
          'e2e-roadmap-show',
          '--db',
          elegyPlanningDbPath,
          'roadmap',
          'show',
          '--roadmap-id',
          'RM-platform-foundation',
        ],
        { windowsHide: true, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(Object.assign(error, { stdout, stderr }));
            return;
          }
          resolve(JSON.parse(String(stdout || '{}')));
        },
      );
    });
    assert.equal(planningRoadmapShow.status, 'ok');
    assert.equal(planningRoadmapShow.data.roadmap.id, 'RM-platform-foundation');
    assert.equal(planningRoadmapShow.data.roadmap.goalId, 'ie-goal-RM-platform-foundation');
    assert.equal(planningRoadmapShow.data.validation.status, 'valid');
    assert.equal(Array.isArray(planningRoadmapShow.data.workPoints), true);
    assert.equal(planningRoadmapShow.data.workPoints.length, 1);
    assert.equal(planningRoadmapShow.data.workPoints[0].id, 'RM-platform-foundation-001');
    const listMemories = await new Promise((resolve, reject) => {
      const childProcess = require('node:child_process');
      childProcess.execFile(
        elegyCliPath,
        ['--format', 'json', 'list', '--db', elegyDbPath, '--scope', 'workspace', '--limit', '10'],
        { windowsHide: true, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(Object.assign(error, { stdout, stderr }));
            return;
          }
          resolve(JSON.parse(String(stdout || '{}')));
        },
      );
    });
    assert.equal(listMemories.command, 'list');
    assert.equal(Array.isArray(listMemories.data.memories), true);
    assert.equal(listMemories.data.memories.length >= 1, true);
    const inspectMemory = await new Promise((resolve, reject) => {
      const childProcess = require('node:child_process');
      childProcess.execFile(
        elegyCliPath,
        ['--format', 'json', 'inspect', persistResponse.body.memorySync.memoryIds[0], '--db', elegyDbPath, '--scope', 'workspace'],
        { windowsHide: true, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(Object.assign(error, { stdout, stderr }));
            return;
          }
          resolve(JSON.parse(String(stdout || '{}')));
        },
      );
    });
    assert.equal(inspectMemory.command, 'inspect');
    assert.match(inspectMemory.data.memory.content, /RM-platform-foundation-001/);
    assert.match(inspectMemory.data.memory.content, /render-workflow-state/);
    console.log(JSON.stringify({
      ok: true,
      root,
      baseUrl,
      artifactId: persistResponse.body.artifact.artifactId,
      memoryId: persistResponse.body.memorySync.memoryIds[0],
      elegyPlanningEntities: persistResponse.body.elegyPlanningSync.entities,
      elegyPlanningValidationStatus: persistResponse.body.elegyPlanningSync.validationStatus,
      retiredRoadmapsCode: retiredRoadmapsResponse.body.code,
      retiredRoadmapCode: retiredRoadmapResponse.body.code,
      memoryPreview: inspectMemory.data.memory.content,
    }, null, 2));
  } finally {
    await server.close();
    await planningPersistence.stop();
  }
}
main().catch((error) => {
  console.error(String(error && error.stack ? error.stack : error));
  process.exit(1);
});
