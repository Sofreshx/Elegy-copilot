const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const retiredAssetIds = new Set([
  'skill-ui-runtime-exploration',
  'skill-ui-system',
  'skill-ui-visual-review',
  'vendor-impeccable-codex-skill',
  'vendor-impeccable-opencode-skill',
]);

test('standalone UI assets are absent from shipped catalog and compatibility routes', async () => {
  const { SHIPPED_ASSET_CATALOG } = await import('../catalog-assets/shippedAssets.mjs');
  const { COMPATIBILITY_MANIFESTS } = await import('../catalog-assets/targetRouting.mjs');
  const shippedIds = SHIPPED_ASSET_CATALOG.assets.map((asset) => asset.id);
  const routedSourceIds = COMPATIBILITY_MANIFESTS.flatMap((manifest) => manifest.assetRoutes || [])
    .flatMap((route) => [route.assetId, route.sourceAssetId]);

  for (const assetId of retiredAssetIds) {
    assert.ok(!shippedIds.includes(assetId), `${assetId} remains shipped`);
    assert.ok(!routedSourceIds.includes(assetId), `${assetId} remains routed`);
  }
});

test('retired UI assets and Impeccable vendor maintenance are removed from the repository', () => {
  const retiredPaths = [
    'catalog-assets/shared-skills/ui-system',
    'catalog-assets/shared-skills/ui-visual-review',
    'engine-assets/skills/ui-runtime-exploration',
    'vendor-assets/impeccable',
    'scripts/sync-impeccable-vendor.mjs',
    'scripts/validate-vendor-assets.mjs',
  ];

  for (const relativePath of retiredPaths) {
    assert.ok(!fs.existsSync(path.join(repoRoot, relativePath)), `${relativePath} still exists`);
  }
});
