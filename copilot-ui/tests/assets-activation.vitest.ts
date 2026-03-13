import { describe, expect, it } from 'vitest';

import { buildAssetBundleIndex, deriveAssetActivationSummary } from '../ui/src/tabs/Assets/AssetsView';
import type { CatalogBundle, CatalogEffectiveAsset } from '../ui/src/lib/types';

describe('catalog asset activation summary', () => {
  const asset: CatalogEffectiveAsset = {
    assetId: 'skill-repo-helper',
    assetKey: 'repo-helper',
    kind: 'skill',
    installed: true,
    enabled: true,
    available: true,
  };

  it('prefers persisted activationStatus over computed bundle status', () => {
    const bundles: CatalogBundle[] = [
      {
        bundleId: 'repo-helper-pack',
        status: 'active',
        activationStatus: 'inactive',
        members: [{ assetId: 'skill-repo-helper' }],
      },
    ];

    const index = buildAssetBundleIndex(bundles);
    const summary = deriveAssetActivationSummary(asset, index[asset.assetId]);

    expect(summary.activationLabel).toBe('inactive-bundle');
    expect(summary.routingLabel).toBe('bundle inactive');
    expect(summary.activeBundleIds).toEqual([]);
  });

  it('marks active bundle memberships as auto-routable when the asset is eligible', () => {
    const bundles: CatalogBundle[] = [
      {
        bundleId: 'core-global',
        status: 'available',
        activationStatus: 'active',
        members: [{ assetId: 'skill-repo-helper' }],
      },
    ];

    const index = buildAssetBundleIndex(bundles);
    const summary = deriveAssetActivationSummary(asset, index[asset.assetId]);

    expect(summary.activationLabel).toBe('active');
    expect(summary.routingLabel).toBe('auto-routable');
    expect(summary.activeBundleIds).toEqual(['core-global']);
  });
});
