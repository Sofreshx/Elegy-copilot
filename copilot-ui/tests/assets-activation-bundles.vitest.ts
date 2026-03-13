import { describe, expect, it } from 'vitest';
import type { CatalogBundle, CatalogEffectiveAsset } from '../ui/src/lib/types';
import { buildAssetBundleIndex, deriveAssetActivationSummary } from '../ui/src/tabs/Assets/AssetsView';

describe('asset activation bundle helpers', () => {
  it('groups bundle memberships by asset id', () => {
    const bundles: CatalogBundle[] = [
      {
        bundleId: 'core-global',
        status: 'active',
        members: [{ assetId: 'skill-core-guardrails' }, { assetId: 'agent-repo-guide' }],
      },
      {
        bundleId: 'repo-helper-pack',
        status: 'inactive',
        members: [{ assetId: 'agent-repo-guide' }],
      },
    ];

    const index = buildAssetBundleIndex(bundles);

    expect(index['skill-core-guardrails']?.map((bundle) => bundle.bundleId)).toEqual(['core-global']);
    expect(index['agent-repo-guide']?.map((bundle) => bundle.bundleId)).toEqual(['core-global', 'repo-helper-pack']);
  });

  it('marks active installed members as auto-routable candidates', () => {
    const asset: CatalogEffectiveAsset = {
      assetId: 'agent-repo-guide',
      assetKey: 'repo-guide',
      kind: 'agent',
      available: true,
      installed: true,
      enabled: true,
    };

    const activation = deriveAssetActivationSummary(asset, [
      {
        bundleId: 'core-global',
        title: 'Core Global Assets',
        status: 'active',
        members: [{ assetId: 'agent-repo-guide', available: true, installed: true, enabled: true }],
      },
    ]);

    expect(activation.activationLabel).toBe('active');
    expect(activation.routingLabel).toBe('auto-routable');
    expect(activation.eligibleByDefault).toBe(true);
    expect(activation.bundleLabel).toContain('Core Global Assets');
  });

  it('distinguishes inactive bundle membership from overlay-disabled assets', () => {
    const inactiveBundleAsset: CatalogEffectiveAsset = {
      assetId: 'agent-repo-guide',
      assetKey: 'repo-guide',
      kind: 'agent',
      available: true,
      installed: true,
      enabled: true,
    };
    const disabledAsset: CatalogEffectiveAsset = {
      assetId: 'skill-review',
      assetKey: 'review-skill',
      kind: 'skill',
      available: true,
      installed: true,
      enabled: false,
    };

    const inactiveBundleActivation = deriveAssetActivationSummary(inactiveBundleAsset, [
      {
        bundleId: 'repo-helper-pack',
        status: 'inactive',
        members: [{ assetId: 'agent-repo-guide', available: true, installed: true, enabled: true }],
      },
    ]);
    const disabledActivation = deriveAssetActivationSummary(disabledAsset, [
      {
        bundleId: 'core-global',
        status: 'active',
        members: [{ assetId: 'skill-review', available: true, installed: true, enabled: false }],
      },
    ]);

    expect(inactiveBundleActivation.activationLabel).toBe('inactive-bundle');
    expect(inactiveBundleActivation.routingLabel).toBe('bundle inactive');
    expect(disabledActivation.activationLabel).toBe('active');
    expect(disabledActivation.routingLabel).toBe('overlay disabled');
  });
});
