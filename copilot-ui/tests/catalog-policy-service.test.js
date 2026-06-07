'use strict';

const assert = require('node:assert/strict');
const policyService = require('../lib/catalogPolicyService');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

// Helper to build a minimal effective asset fixture
function makeAsset(overrides = {}) {
  return {
    assetId: overrides.assetId || 'test-skill',
    assetKey: overrides.assetKey || 'test-skill',
    kind: overrides.kind || 'skill',
    available: overrides.available !== false,
    installed: overrides.installed === true,
    enabled: overrides.enabled !== false,
    deprecated: overrides.deprecated === true,
    recommended: overrides.recommended === true,
    selectedLayer: overrides.selectedLayer || 'source',
    selectedEntry: {
      title: overrides.title || 'Test Skill',
      description: overrides.description || 'A test skill for testing',
      targeting: { tags: overrides.tags || ['test'] },
      installState: { loadMode: overrides.loadMode || 'always' },
      provenance: { providerId: overrides.providerId || 'test-provider' },
    },
    installState: { loadMode: overrides.loadMode || 'always' },
    bundleIds: Array.isArray(overrides.bundleIds) ? overrides.bundleIds : [],
    provenance: { providerId: overrides.providerId || 'test-provider' },
    ...overrides,
  };
}

// Helper to build a minimal external installable fixture
function makeInstallable(overrides = {}) {
  return {
    id: overrides.id || 'test-mcp',
    key: overrides.key || 'test-mcp',
    name: overrides.name || 'Test MCP',
    kind: overrides.kind || 'mcp',
    title: overrides.title || 'Test MCP Server',
    description: overrides.description || 'A test MCP server',
    available: overrides.available !== false,
    deprecated: overrides.deprecated === true,
  };
}

// Helper to build a source wrapper for installables
function makeSource(sourceId, installables) {
  return {
    sourceId,
    sync: { status: 'ok', lastSyncedAt: new Date().toISOString() },
    activation: {},
    installables: Array.isArray(installables) ? installables : [],
  };
}

async function run() {
  // =========================================================================
  // normalizeEffectiveAsset
  // =========================================================================
  test('normalizeEffectiveAsset produces a catalog candidate', () => {
    const asset = makeAsset({ assetId: 'my-skill', assetKey: 'my-skill', kind: 'skill', title: 'My Skill' });
    const candidate = policyService.normalizeEffectiveAsset(asset);
    assert.equal(candidate.id, 'my-skill');
    assert.equal(candidate.key, 'my-skill');
    assert.equal(candidate.kind, 'skill');
    assert.equal(candidate.title, 'My Skill');
    assert.equal(candidate.sourceType, 'catalog');
    assert.equal(candidate.available, true);
    assert.equal(candidate.eligible, true);
    assert.equal(candidate.blockedReasons.length, 0);
  });

  test('normalizeEffectiveAsset correctly reflects disabled state', () => {
    const asset = makeAsset({ assetId: 'disabled-skill', enabled: false });
    const candidate = policyService.normalizeEffectiveAsset(asset);
    assert.equal(candidate.enabled, false);
    assert.equal(candidate.eligible, true); // eligibility is separate from normalization
  });

  test('normalizeEffectiveAsset correctly reflects deprecated state', () => {
    const asset = makeAsset({ assetId: 'old-skill', deprecated: true });
    const candidate = policyService.normalizeEffectiveAsset(asset);
    assert.equal(candidate.deprecated, true);
  });

  test('normalizeEffectiveAsset preserves bundle IDs', () => {
    const asset = makeAsset({ assetId: 'bundled-skill', bundleIds: ['bundle-a', 'bundle-b'] });
    const candidate = policyService.normalizeEffectiveAsset(asset);
    assert.deepStrictEqual(candidate.bundleIds, ['bundle-a', 'bundle-b']);
  });

  // =========================================================================
  // normalizeExternalInstallable
  // =========================================================================
  test('normalizeExternalInstallable produces an external candidate', () => {
    const installable = makeInstallable({ id: 'ext-mcp', kind: 'mcp', title: 'External MCP' });
    const source = makeSource('gh-test', [installable]);
    const candidate = policyService.normalizeExternalInstallable(installable, source);
    assert.equal(candidate.id, 'ext-mcp');
    assert.equal(candidate.kind, 'mcp');
    assert.equal(candidate.sourceType, 'external');
    assert.equal(candidate.sourceId, 'gh-test');
  });

  test('normalizeExternalInstallable with target harness activation', () => {
    const installable = makeInstallable({ id: 'ext-mcp', kind: 'mcp' });
    const source = makeSource('gh-test', [installable]);
    source.activation = { codex: true };
    const candidate = policyService.normalizeExternalInstallable(installable, source, { targetHarness: 'codex' });
    assert.equal(candidate.installed, true);
  });

  test('normalizeExternalInstallable not activated for different harness', () => {
    const installable = makeInstallable({ id: 'ext-mcp', kind: 'mcp' });
    const source = makeSource('gh-test', [installable]);
    source.activation = { copilot: true };
    const candidate = policyService.normalizeExternalInstallable(installable, source, { targetHarness: 'codex' });
    assert.equal(candidate.installed, false);
  });

  // =========================================================================
  // collectCandidates
  // =========================================================================
  test('collectCandidates gathers from snapshot effectiveAssets', () => {
    const snapshot = {
      effectiveAssets: [
        makeAsset({ assetId: 'skill-1', kind: 'skill' }),
        makeAsset({ assetId: 'agent-1', kind: 'agent' }),
      ],
    };
    const candidates = policyService.collectCandidates({ snapshot });
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].id, 'skill-1');
    assert.equal(candidates[1].id, 'agent-1');
  });

  test('collectCandidates filters out non-routing kinds like prompt', () => {
    const snapshot = {
      effectiveAssets: [
        makeAsset({ assetId: 'skill-1', kind: 'skill' }),
        makeAsset({ assetId: 'prompt-1', kind: 'prompt' }),
      ],
    };
    const candidates = policyService.collectCandidates({ snapshot });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].kind, 'skill');
  });

  test('collectCandidates gathers from external sources', () => {
    const installable = makeInstallable({ id: 'ext-mcp', kind: 'mcp' });
    const source = makeSource('gh-test', [installable]);
    const externalSources = { sources: [source] };
    const candidates = policyService.collectCandidates({ externalSources });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].id, 'ext-mcp');
    assert.equal(candidates[0].sourceType, 'external');
  });

  test('collectCandidates merges catalog and external candidates', () => {
    const snapshot = {
      effectiveAssets: [makeAsset({ assetId: 'skill-1', kind: 'skill' })],
    };
    const installable = makeInstallable({ id: 'ext-mcp', kind: 'mcp' });
    const source = makeSource('gh-test', [installable]);
    const externalSources = { sources: [source] };
    const candidates = policyService.collectCandidates({ snapshot, externalSources });
    assert.equal(candidates.length, 2);
  });

  // =========================================================================
  // Block reasons
  // =========================================================================
  test('enabled, installed asset has no block reasons', () => {
    const candidate = {
      id: 'good-skill', key: 'good-skill', kind: 'skill',
      available: true, installed: true, enabled: true,
      deprecated: false, sourceType: 'catalog', bundleIds: [],
      blockedReasons: [], actions: [],
    };
    const reasons = policyService.computeBlockReasons(candidate, {
      intent: 'task-routing', kinds: ['skill'],
    });
    assert.deepStrictEqual(reasons, []);
  });

  test('disabled asset is blocked', () => {
    const candidate = {
      id: 'disabled-skill', key: 'disabled-skill', kind: 'skill',
      available: true, installed: true, enabled: false,
      deprecated: false, sourceType: 'catalog', bundleIds: [],
      blockedReasons: [], actions: [],
    };
    const reasons = policyService.computeBlockReasons(candidate, {
      intent: 'task-routing', kinds: ['skill'],
    });
    assert.ok(reasons.includes('disabled'));
  });

  test('deprecated asset is blocked', () => {
    const candidate = {
      id: 'old-skill', key: 'old-skill', kind: 'skill',
      available: true, installed: true, enabled: true,
      deprecated: true, sourceType: 'catalog', bundleIds: [],
      blockedReasons: [], actions: [],
    };
    const reasons = policyService.computeBlockReasons(candidate, {
      intent: 'task-routing', kinds: ['skill'],
    });
    assert.ok(reasons.includes('deprecated'));
  });

  test('external source not activated is blocked for target harness', () => {
    const source = makeSource('gh-test', []);
    source.activation = { copilot: true };
    const candidate = {
      id: 'ext-mcp', key: 'ext-mcp', kind: 'mcp',
      available: true, installed: false, enabled: false,
      deprecated: false, sourceType: 'external', bundleIds: [],
      blockedReasons: [], actions: [],
      _staleSource: false, _sourceId: 'gh-test', _targetHarness: 'codex',
    };
    const reasons = policyService.computeBlockReasons(candidate, {
      intent: 'tool-routing', kinds: ['mcp'], targetHarness: 'codex',
    });
    assert.ok(reasons.includes('external-source-not-activated'));
  });

  test('overrideRoutingPolicy bypasses all blocks', () => {
    const candidate = {
      id: 'any-skill', key: 'any-skill', kind: 'skill',
      available: true, installed: false, enabled: false,
      deprecated: true, sourceType: 'catalog', bundleIds: [],
      blockedReasons: [], actions: [],
    };
    const reasons = policyService.computeBlockReasons(candidate, {
      intent: 'task-routing', kinds: ['skill'], overrideRoutingPolicy: true,
    });
    assert.deepStrictEqual(reasons, []);
  });

  test('not-in-active-bundle blocks asset not in routing policy eligible set', () => {
    const candidate = {
      id: 'bundled-skill', key: 'bundled-skill', kind: 'skill',
      available: true, installed: true, enabled: true,
      deprecated: false, sourceType: 'catalog', bundleIds: ['bundle-x'],
      blockedReasons: [], actions: [],
    };
    const routingPolicy = { eligibleAssetIds: ['some-other-skill'] };
    const reasons = policyService.computeBlockReasons(candidate, {
      intent: 'task-routing', kinds: ['skill'], routingPolicy,
    });
    assert.ok(reasons.includes('not-in-active-bundle'));
  });

  test('eligible asset in routing policy is not blocked', () => {
    const candidate = {
      id: 'bundled-skill', key: 'bundled-skill', kind: 'skill',
      available: true, installed: true, enabled: true,
      deprecated: false, sourceType: 'catalog', bundleIds: ['bundle-x'],
      blockedReasons: [], actions: [],
    };
    const routingPolicy = { eligibleAssetIds: ['bundled-skill', 'other'] };
    const reasons = policyService.computeBlockReasons(candidate, {
      intent: 'task-routing', kinds: ['skill'], routingPolicy,
    });
    assert.deepStrictEqual(reasons, []);
  });

  test('kind-not-applicable when kind not in requested kinds', () => {
    const candidate = {
      id: 'mcp-srv', key: 'mcp-srv', kind: 'mcp',
      available: true, installed: true, enabled: true,
      deprecated: false, sourceType: 'external', bundleIds: [],
      blockedReasons: [], actions: [],
      _staleSource: false, _sourceId: 'gh-test', _targetHarness: 'codex',
    };
    const reasons = policyService.computeBlockReasons(candidate, {
      intent: 'task-routing', kinds: ['skill', 'agent'],
    });
    assert.ok(reasons.includes('kind-not-applicable'));
  });

  test('stale source is blocked', () => {
    const candidate = {
      id: 'stale-mcp', key: 'stale-mcp', kind: 'mcp',
      available: true, installed: false, enabled: false,
      deprecated: false, sourceType: 'external', bundleIds: [],
      blockedReasons: [], actions: [],
      _staleSource: true, _sourceId: 'gh-test', _targetHarness: 'codex',
    };
    const reasons = policyService.computeBlockReasons(candidate, {
      intent: 'tool-routing', kinds: ['mcp'],
    });
    assert.ok(reasons.includes('stale-source'));
  });

  // =========================================================================
  // Suggested actions
  // =========================================================================
  test('suggested actions for disabled asset include enable-asset', () => {
    const candidate = { id: 'disabled-skill', key: 'disabled-skill', kind: 'skill', title: 'Disabled Skill' };
    const actions = policyService.computeSuggestedActions(candidate, ['disabled']);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].operation, 'enable-asset');
  });

  test('suggested actions for external-source-not-activated include activate-source-installable', () => {
    const candidate = {
      id: 'ext-mcp', key: 'ext-mcp', kind: 'mcp', title: 'External MCP',
      _sourceId: 'gh-test',
    };
    const actions = policyService.computeSuggestedActions(candidate, ['external-source-not-activated'], { targetHarness: 'codex' });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].operation, 'activate-source-installable');
  });

  test('suggested actions deduplicate by operation+targetId', () => {
    const candidate = {
      id: 'dup-skill', key: 'dup-skill', kind: 'skill', title: 'Dup Skill',
      sourceType: 'catalog',
    };
    const actions = policyService.computeSuggestedActions(candidate, ['disabled', 'not-installed'], { targetHarness: 'codex' });
    // Both disabled and not-installed can result in enable-asset for catalog assets
    // But they should be deduplicated
    const uniqueOps = [...new Set(actions.map(a => a.operation))];
    assert.equal(uniqueOps.length, actions.length); // All unique
  });

  // =========================================================================
  // Scoring
  // =========================================================================
  test('exact name match scores 100 + eligibility bonus', () => {
    const candidate = {
      id: 'python-linting', key: 'python-linting', kind: 'skill',
      title: 'Python Linting', description: 'Lint Python code',
      available: true, installed: true, enabled: true,
      deprecated: false, sourceType: 'catalog', bundleIds: [],
      blockedReasons: [], actions: [], eligible: true,
    };
    const { score, explanations } = policyService.scoreCandidate(candidate, 'python-linting', 'task-routing', ['skill']);
    assert.ok(score >= 100, `score ${score} should be >= 100`);
    const exactName = explanations.find(e => e.code === 'exact-name');
    assert.ok(exactName, 'should have exact-name explanation');
    assert.equal(exactName.weight, 100);
  });

  test('partial name match scores 60 + eligibility bonus', () => {
    const candidate = {
      id: 'python-linting', key: 'python-linting', kind: 'skill',
      title: 'Python Linting', description: 'Lint Python code',
      available: true, installed: true, enabled: true,
      deprecated: false, sourceType: 'catalog', bundleIds: [],
      blockedReasons: [], actions: [], eligible: true,
    };
    const { score, explanations } = policyService.scoreCandidate(candidate, 'linting', 'task-routing', ['skill']);
    assert.ok(score >= 60, `score ${score} should be >= 60`);
    const name = explanations.find(e => e.code === 'name');
    assert.ok(name, 'should have name explanation');
  });

  test('eligible installed enabled candidate gets eligibility bonuses', () => {
    const candidate = {
      id: 'test-skill', key: 'test-skill', kind: 'skill',
      title: 'Test Skill', description: 'Test',
      available: true, installed: true, enabled: true,
      deprecated: false, sourceType: 'catalog', bundleIds: ['bundle-1'],
      blockedReasons: [], actions: [], eligible: true,
    };
    const { explanations } = policyService.scoreCandidate(candidate, '', 'task-routing', ['skill']);
    const codes = explanations.map(e => e.code);
    assert.ok(codes.includes('eligible'), 'should have eligible bonus');
    assert.ok(codes.includes('installed'), 'should have installed bonus');
    assert.ok(codes.includes('enabled'), 'should have enabled bonus');
    assert.ok(codes.includes('in-bundle'), 'should have in-bundle bonus');
  });

  test('repo-local candidate gets repo-local bonus', () => {
    const candidate = {
      id: 'repo-skill', key: 'repo-skill', kind: 'skill',
      title: 'Repo Skill', description: 'Repo-local skill',
      available: true, installed: true, enabled: true,
      deprecated: false, sourceType: 'catalog', bundleIds: [],
      blockedReasons: [], actions: [], eligible: true,
      contentLayer: 'repo-local',
    };
    const { explanations } = policyService.scoreCandidate(candidate, '', 'task-routing', ['skill']);
    const repoLocal = explanations.find(e => e.code === 'repo-local');
    assert.ok(repoLocal, 'should have repo-local bonus');
  });

  // =========================================================================
  // Sorting
  // =========================================================================
  test('sortCandidates puts eligible before blocked', () => {
    const candidates = [
      { id: 'blocked', key: 'blocked', eligible: false, score: 100, sourceType: 'catalog', installed: true, enabled: true },
      { id: 'eligible', key: 'eligible', eligible: true, score: 10, sourceType: 'catalog', installed: true, enabled: true },
    ];
    const sorted = policyService.sortCandidates(candidates);
    assert.equal(sorted[0].id, 'eligible');
    assert.equal(sorted[1].id, 'blocked');
  });

  test('sortCandidates puts higher score first among eligible', () => {
    const candidates = [
      { id: 'low', key: 'low', eligible: true, score: 50, sourceType: 'catalog', installed: true, enabled: true },
      { id: 'high', key: 'high', eligible: true, score: 100, sourceType: 'catalog', installed: true, enabled: true },
    ];
    const sorted = policyService.sortCandidates(candidates);
    assert.equal(sorted[0].id, 'high');
    assert.equal(sorted[1].id, 'low');
  });

  // =========================================================================
  // explainRoute main function
  // =========================================================================
  test('explainRoute returns deterministic decision shape', () => {
    const snapshot = {
      effectiveAssets: [
        makeAsset({ assetId: 'skill-a', kind: 'skill', title: 'Skill A', installed: true, enabled: true }),
      ],
    };
    const routingPolicy = { eligibleAssetIds: ['skill-a'], profile: 'balanced', failClosed: true, activeBundleIds: ['core'] };
    const result = policyService.explainRoute(
      { query: 'skill', intent: 'task-routing', kinds: ['skill'] },
      { snapshot, routingPolicy },
    );
    assert.equal(result.kind, 'catalog.route.explanation');
    assert.equal(result.deterministic, true);
    assert.ok(result.correlationId);
    assert.ok(result.decidedAt);
    assert.ok(Array.isArray(result.candidates));
    assert.equal(result.candidates.length, 1);
    assert.ok(result.policy);
    assert.equal(result.policy.totalCandidates, 1);
  });

  test('explainRoute with blocked disabled asset returns blocks', () => {
    const snapshot = {
      effectiveAssets: [
        makeAsset({ assetId: 'disabled-skill', kind: 'skill', enabled: false }),
      ],
    };
    const routingPolicy = { eligibleAssetIds: ['disabled-skill'], profile: 'balanced' };
    const result = policyService.explainRoute(
      { query: 'skill', intent: 'task-routing', kinds: ['skill'] },
      { snapshot, routingPolicy },
    );
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].eligible, false);
    assert.ok(result.candidates[0].blockedReasons.includes('disabled'));
    assert.ok(result.blocks);
    assert.equal(result.blocks.length, 1);
    assert.ok(result.suggestedActions);
  });

  test('explainRoute selects best eligible candidate as decision', () => {
    const snapshot = {
      effectiveAssets: [
        makeAsset({ assetId: 'python-lint', assetKey: 'python-lint', kind: 'skill', title: 'Python Lint', installed: true, enabled: true }),
        makeAsset({ assetId: 'other-skill', assetKey: 'other-skill', kind: 'skill', title: 'Other', installed: true, enabled: true }),
      ],
    };
    const routingPolicy = { eligibleAssetIds: ['python-lint', 'other-skill'], profile: 'balanced' };
    const result = policyService.explainRoute(
      { query: 'python-lint', intent: 'task-routing', kinds: ['skill'] },
      { snapshot, routingPolicy },
    );
    assert.ok(result.decision);
    assert.equal(result.decision.id, 'python-lint');
  });

  test('explainRoute with overrideRoutingPolicy includes all candidates as eligible', () => {
    const snapshot = {
      effectiveAssets: [
        makeAsset({ assetId: 'disabled-skill', kind: 'skill', enabled: false, deprecated: true }),
      ],
    };
    const result = policyService.explainRoute(
      { query: 'skill', intent: 'task-routing', kinds: ['skill'], overrideRoutingPolicy: true },
      { snapshot },
    );
    assert.equal(result.candidates[0].eligible, true);
    assert.equal(result.candidates[0].blockedReasons.length, 0);
  });

  test('explainRoute with external MCP returns as blocked when not activated', () => {
    const installable = makeInstallable({ id: 'ext-mcp', kind: 'mcp', title: 'External MCP' });
    const source = makeSource('gh-test', [installable]);
    source.activation = { copilot: true }; // not activated for codex
    const externalSources = { sources: [source] };
    const result = policyService.explainRoute(
      { query: 'mcp', intent: 'tool-routing', kinds: ['mcp'], targetHarness: 'codex' },
      { externalSources, routingPolicy: { eligibleAssetIds: [], profile: 'balanced' } },
    );
    assert.equal(result.candidates.length, 1);
    const candidate = result.candidates[0];
    assert.equal(candidate.eligible, false);
    assert.ok(candidate.blockedReasons.includes('external-source-not-activated'));
  });

  test('explainRoute with tool-routing intent includes CLI tool candidates', () => {
    const installable = makeInstallable({ id: 'cli-tool-1', kind: 'cli-tool', title: 'CLI Tool' });
    const source = makeSource('gh-test', [installable]);
    const externalSources = { sources: [source] };
    const result = policyService.explainRoute(
      { query: 'cli', intent: 'tool-routing', kinds: ['cli-tool'] },
      { externalSources },
    );
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].kind, 'cli-tool');
  });

  test('buildEligibilityFilter returns eligibleAssetIds and blockMap', () => {
    const snapshot = {
      effectiveAssets: [
        makeAsset({ assetId: 'skill-a', kind: 'skill', installed: true, enabled: true }),
        makeAsset({ assetId: 'skill-b', kind: 'skill', enabled: false }),
      ],
    };
    const routingPolicy = { eligibleAssetIds: ['skill-a', 'skill-b'], profile: 'balanced' };
    const filter = policyService.buildEligibilityFilter(
      { query: '', intent: 'task-routing', kinds: ['skill'] },
      { snapshot, routingPolicy },
    );
    assert.ok(filter.eligibleAssetIds instanceof Set);
    assert.equal(filter.eligibleAssetIds.size, 1);
    assert.ok(filter.eligibleAssetIds.has('skill-a'));
    assert.ok(filter.blockMap);
    assert.ok(Object.keys(filter.blockMap).length >= 0);
    assert.ok(filter.routingPolicy);
  });

  // Summary
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
