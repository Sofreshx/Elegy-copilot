const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareAssetCatalogEntries,
  getAssetLayerPrecedence,
  resolveEffectiveAssetState,
  ASSET_CATALOG_LAYER_PRECEDENCE,
} = require('../dist');

function entry(overrides = {}) {
  const layer = overrides.layer ?? 'source';
  return {
    assetId: overrides.assetId ?? 'skill-search',
    assetKey: overrides.assetKey ?? 'search',
    kind: overrides.kind ?? 'skill',
    title: overrides.title ?? 'Search',
    layer,
    scope: overrides.scope ?? { kind: 'global' },
    installState: overrides.installState,
    overlay: overrides.overlay,
    recommendation: overrides.recommendation,
    lifecycle: overrides.lifecycle,
    metadata: overrides.metadata,
    contentPath: overrides.contentPath,
  };
}

test('layer precedence order stays canonical', () => {
  assert.deepEqual(ASSET_CATALOG_LAYER_PRECEDENCE, [
    'source',
    'user-installed',
    'vault-only',
    'repo-local',
    'repo-state-overlay',
    'targeted-recommendation',
  ]);
  assert.equal(getAssetLayerPrecedence('source'), 0);
  assert.equal(getAssetLayerPrecedence('repo-local'), 3);
  assert.ok(compareAssetCatalogEntries(entry({ layer: 'repo-local' }), entry({ layer: 'source' })) > 0);
});

test('repo-local content overrides user-installed and source entries', () => {
  const state = resolveEffectiveAssetState([
    entry({ layer: 'source', contentPath: 'engine-assets/skills/search/SKILL.md' }),
    entry({ layer: 'user-installed', contentPath: '~/.copilot/skills/search/SKILL.md' }),
    entry({
      layer: 'repo-local',
      scope: { kind: 'repo', repoId: 'repo-1', repoPath: 'C:/repo' },
      contentPath: 'C:/repo/.github/skills/search/SKILL.md',
      installState: { availability: 'repo-local', isInstalled: true },
    }),
  ]);

  assert.equal(state.selectedLayer, 'repo-local');
  assert.equal(state.overridden, true);
  assert.equal(state.enabled, true);
  assert.ok(state.labels.includes('overridden'));
});

test('repo-state overlay disables effective asset without replacing content', () => {
  const state = resolveEffectiveAssetState([
    entry({
      layer: 'user-installed',
      contentPath: '~/.copilot/skills/security/SKILL.md',
      installState: { availability: 'installed', isInstalled: true, loadMode: 'always' },
    }),
    entry({
      layer: 'repo-state-overlay',
      scope: { kind: 'repo', repoId: 'repo-1' },
      overlay: { repoId: 'repo-1', enabled: false, blockedReason: 'conflicts with repo policy' },
    }),
    entry({
      layer: 'targeted-recommendation',
      scope: { kind: 'framework', frameworkIds: ['react'] },
      recommendation: {
        source: 'framework',
        reasonCode: 'react-stack',
        reason: 'Recommended for React repos.',
      },
    }),
  ]);

  assert.equal(state.selectedLayer, 'user-installed');
  assert.equal(state.enabled, false);
  assert.equal(state.recommended, true);
  assert.ok(state.labels.includes('disabled'));
  assert.ok(state.labels.includes('recommended'));
});

test('vault content wins over pointer stubs in user install location', () => {
  const state = resolveEffectiveAssetState([
    entry({
      layer: 'user-installed',
      contentPath: '~/.copilot/skills/react-query/SKILL.md',
      installState: {
        availability: 'installed',
        isInstalled: true,
        materialization: 'pointer',
        loadMode: 'on-demand',
      },
    }),
    entry({
      layer: 'vault-only',
      contentPath: '~/.copilot/skills-vault/react-query/SKILL.md',
      installState: {
        availability: 'vault-only',
        isInstalled: true,
        materialization: 'vault-only',
        loadMode: 'on-demand',
      },
    }),
  ]);

  assert.equal(state.selectedLayer, 'vault-only');
  assert.equal(state.hiddenFromAutoLoad, true);
  assert.equal(state.installState?.installedPaths?.['vault-only'], '~/.copilot/skills-vault/react-query/SKILL.md');
  assert.ok(state.reasons.some((reason) => reason.code === 'vault-preferred-over-pointer'));
});
