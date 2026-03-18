'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  appendCatalogAuditEvent,
  buildAssetAuditAnalytics,
  readCatalogAuditEvents,
} = require('../lib/catalogAuditAnalytics');
const {
  getSessionSkillUsageSummary,
  recordExplicitAssetInvocation,
} = require('../lib/assetInvocationAudit');
const {
  getRepoStateKey,
  resolveProjectionStorage,
} = require('../lib/catalogProjectionService');
const {
  persistTelemetryEvent,
} = require('../lib/skillSearchService');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

function writeJson(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(value, null, 2));
}

function writeJsonl(targetPath, entries) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(
    targetPath,
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  );
}

function createEffectiveAsset(overrides = {}) {
  return {
    assetId: overrides.assetId,
    assetKey: overrides.assetKey,
    kind: overrides.kind,
    scope: overrides.scope,
    selectedLayer: overrides.selectedLayer || 'user-installed',
    selectedEntry: {
      title: overrides.title || overrides.assetKey,
      description: overrides.description || `${overrides.assetKey} description`,
      metadata: overrides.metadata || {},
    },
    installState: {
      availability: 'installed',
      isInstalled: true,
    },
    recommendations: [],
    reasons: [],
    available: true,
    installed: true,
    enabled: true,
    recommended: false,
    deprecated: false,
    overridden: false,
    hiddenFromAutoLoad: false,
  };
}

async function run() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-observability-'));

  try {
    const copilotHome = path.join(tmpRoot, '.copilot');
    const repoPath = path.join(tmpRoot, 'repo');
    fs.mkdirSync(repoPath, { recursive: true });
    const repoContext = getRepoStateKey(repoPath);
    const projectionStorage = resolveProjectionStorage({ copilotHome });
    const snapshot = {
      storage: projectionStorage,
      effectiveAssets: [
        createEffectiveAsset({
          assetId: 'skill-react-query',
          assetKey: 'react-query',
          kind: 'skill',
          scope: { kind: 'repo', repoId: repoContext.repoId, displayName: repoContext.repoLabel },
          metadata: {
            logicalName: 'react-query',
            aliasKeys: ['react_query'],
          },
        }),
        createEffectiveAsset({
          assetId: 'agent-reviewer',
          assetKey: 'reviewer',
          kind: 'agent',
          scope: { kind: 'global' },
          metadata: {
            aliasKeys: ['reviewer'],
          },
        }),
        createEffectiveAsset({
          assetId: 'agent-researcher',
          assetKey: 'researcher',
          kind: 'agent',
          scope: { kind: 'global' },
          metadata: {
            aliasKeys: ['researcher'],
          },
        }),
      ],
    };
    writeJson(projectionStorage.snapshotPath, snapshot);

    await test('explicit invocation audit records asset.invoked with bounded correlation metadata', async () => {
      persistTelemetryEvent(
        'asset.search.selected',
        {
          assetId: 'skill-react-query',
          assetKey: 'react-query',
          assetKind: 'skill',
          repoId: repoContext.repoId,
          sessionId: 'session-1',
          correlationId: 'corr-selected-1',
          search: {
            selectedAssetId: 'skill-react-query',
          },
        },
        {
          copilotHome,
        },
      );

      const result = recordExplicitAssetInvocation({
        copilotHome,
        repoPath,
        sessionId: 'session-1',
        toolName: 'react-query',
        toolCallId: 'tool-call-1',
      });

      assert.equal(result.logged, true);
      assert.equal(result.event.eventType, 'asset.invoked');
      assert.equal(result.event.assetId, 'skill-react-query');
      assert.equal(result.event.assetKind, 'skill');
      assert.equal(result.event.repoId, repoContext.repoId);
      assert.equal(result.event.correlationId, 'corr-selected-1');
      assert.equal(result.event.toolName, 'react-query');
      assert.equal(result.event.toolCallId, 'tool-call-1');
      assert.equal(result.event.details.hookEventType, 'tool.user_requested');
      assert.equal(result.event.details.correlationSource, 'search-selected');

      const events = readCatalogAuditEvents(copilotHome, 20);
      assert.ok(events.some((event) => event.eventType === 'asset.invoked' && event.toolCallId === 'tool-call-1'));

      const skillUsage = getSessionSkillUsageSummary({
        copilotHome,
        sessionId: 'session-1',
        limit: 20,
      });
      assert.equal(skillUsage.totalInvocations, 1);
      assert.equal(skillUsage.uniqueSkillCount, 1);
      assert.equal(skillUsage.skills[0].assetId, 'skill-react-query');
      assert.equal(skillUsage.skills[0].invocationCount, 1);
    });

    await test('asset audit analytics separate explicit invocation counts from proxy-only fallback usage', async () => {
      appendCatalogAuditEvent(copilotHome, {
        eventType: 'asset.invoked',
        actor: { kind: 'runtime', id: 'sdk-bridge', label: 'sdk-bridge' },
        assetId: 'agent-reviewer',
        assetKey: 'reviewer',
        assetKind: 'agent',
        sessionId: 'session-1',
        repoId: repoContext.repoId,
        toolName: 'run_agent',
        toolCallId: 'tool-call-agent-reviewer',
      });

      writeJsonl(path.join(copilotHome, 'session-state', 'session-1', 'events.jsonl'), [
        {
          type: 'session.start',
          time: '2026-01-01T00:00:00Z',
          payload: {
            repo: repoPath,
            cwd: repoPath,
            startTime: '2026-01-01T00:00:00Z',
          },
        },
        {
          type: 'tool.execution_start',
          time: '2026-01-01T00:01:00Z',
          payload: {
            toolName: 'run_agent',
            arguments: { agentName: 'reviewer' },
          },
        },
        {
          type: 'tool.execution_start',
          time: '2026-01-01T00:02:00Z',
          payload: {
            toolName: 'run_agent',
            arguments: { agentName: 'researcher' },
          },
        },
      ]);

      const analytics = buildAssetAuditAnalytics({
        copilotHome,
        snapshot,
      });

      const skillSummary = analytics.assets.find((asset) => asset.assetId === 'skill-react-query');
      assert.ok(skillSummary, 'expected explicit skill summary');
      assert.equal(skillSummary.search.sampled.selectedCount, 1);
      assert.equal(skillSummary.usage.invocationCount, 1);
      assert.equal(skillSummary.usage.explicitInvocationCount, 1);
      assert.equal(skillSummary.usage.proxyInvocationCount, 0);

      const reviewerSummary = analytics.assets.find((asset) => asset.assetId === 'agent-reviewer');
      assert.ok(reviewerSummary, 'expected explicit agent summary');
      assert.equal(reviewerSummary.usage.invocationCount, 1);
      assert.equal(reviewerSummary.usage.explicitInvocationCount, 1);
      assert.equal(reviewerSummary.usage.proxyInvocationCount, 0);

      const researcherSummary = analytics.assets.find((asset) => asset.assetId === 'agent-researcher');
      assert.ok(researcherSummary, 'expected proxy-only agent summary');
      assert.equal(researcherSummary.usage.invocationCount, 1);
      assert.equal(researcherSummary.usage.explicitInvocationCount, 0);
      assert.equal(researcherSummary.usage.proxyInvocationCount, 1);

      const sessionSummary = analytics.sessions.find((session) => session.sessionId === 'session-1');
      assert.ok(sessionSummary, 'expected session analytics summary');
      assert.equal(sessionSummary.search.selectedCount, 1);
      assert.equal(sessionSummary.usage.invocationCount, 3);
      assert.equal(sessionSummary.usage.explicitInvocationCount, 2);
      assert.equal(sessionSummary.usage.proxyInvocationCount, 1);
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
