import { useEffect, useMemo, useState } from 'react';
import { Button, FormInput, Panel, StatusBadge } from '../../components';
import { useStoreValue } from '../../lib/store';
import type { CatalogEffectiveAsset, CatalogEntry, CatalogProviderProjection } from '../../lib/types';
import { catalogWorkspaceStore } from '../Assets/catalogWorkspaceStore';

type CatalogSectionId = 'overview' | 'assets' | 'skills' | 'agents';

interface CatalogAgentsViewProps {
  onOpenSection: (section: CatalogSectionId) => void;
  onInspectAsset: (assetId: string) => Promise<void> | void;
  onEngageRuntime: () => void;
}

function readMetadataString(entry: CatalogEntry | null | undefined, key: string): string {
  const value = entry?.metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readProvenanceString(entry: CatalogEntry | null | undefined, key: string): string {
  const provenance = (entry as CatalogEntry & { provenance?: Record<string, unknown> } | null | undefined)?.provenance;
  const value = provenance?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readProviderStateString(provider: CatalogProviderProjection | null | undefined, key: string): string {
  const value = provider?.state?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function providerLooksInstalled(provider: CatalogProviderProjection | null | undefined): boolean {
  if (!provider) {
    return false;
  }

  if (provider.state?.installed === true) {
    return true;
  }

  return Number(provider.discoveredAssets?.count || 0) > 0;
}

function readAssetProviderId(asset: CatalogEffectiveAsset | null | undefined): string {
  if (!asset) {
    return '';
  }

  return String(
    readProvenanceString(asset.selectedEntry ?? null, 'providerId') ||
    readMetadataString(asset.selectedEntry ?? null, 'provider') ||
    readMetadataString(asset.selectedEntry ?? null, 'source')
  ).trim();
}

function buildIdentityLabel(asset: CatalogEffectiveAsset): string {
  const entry = asset.selectedEntry ?? null;
  const providerId = readAssetProviderId(asset);
  const sourcePackage = readMetadataString(entry, 'sourcePackage');
  const namespace = readMetadataString(entry, 'namespace');
  const segments = [
    providerId,
    sourcePackage,
    namespace ? `namespace: ${namespace}` : '',
    entry?.metadata?.readOnly === true ? 'read-only' : '',
  ].filter(Boolean);

  return segments.join(' · ');
}

function matchesAgentQuery(asset: CatalogEffectiveAsset, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const entry = asset.selectedEntry ?? null;
  return [
    asset.assetId,
    asset.assetKey,
    entry?.title,
    entry?.description,
    readAssetProviderId(asset),
    readMetadataString(entry, 'namespace'),
    readMetadataString(entry, 'sourcePackage'),
  ].some((value) => String(value || '').toLowerCase().includes(normalized));
}

export default function CatalogAgentsView({
  onOpenSection,
  onInspectAsset,
  onEngageRuntime,
}: CatalogAgentsViewProps) {
  const catalogState = useStoreValue(catalogWorkspaceStore);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    void catalogWorkspaceStore.loadWorkspace();
  }, []);

  const providerProjections = Array.isArray(catalogState.summary?.providers)
    ? catalogState.summary.providers
    : [];
  const allAgents = useMemo(() => (
    catalogState.assets
      .filter((asset) => asset.kind === 'agent')
      .sort((left, right) => {
        const leftTitle = String(left.selectedEntry?.title || left.assetKey || left.assetId);
        const rightTitle = String(right.selectedEntry?.title || right.assetKey || right.assetId);
        return leftTitle.localeCompare(rightTitle);
      })
  ), [catalogState.assets]);
  const filteredAgents = useMemo(() => (
    allAgents.filter((asset) => matchesAgentQuery(asset, searchQuery))
  ), [allAgents, searchQuery]);
  const featuredProvider =
    providerProjections.find((provider) => provider.providerId === 'superpowers-copilot') ?? null;
  const featuredAgents = useMemo(() => (
    allAgents.filter((asset) => readAssetProviderId(asset) === 'superpowers-copilot')
  ), [allAgents]);
  const featuredProviderInstalled = providerLooksInstalled(featuredProvider);
  const featuredProviderAction = featuredProviderInstalled ? 'update' : 'install';
  const featuredProviderError = readProviderStateString(featuredProvider, 'lastError');

  return (
    <section className="catalog-agents-view" data-testid="catalog-agents-view">
      {catalogState.error ? (
        <p className="state-message state-error" role="alert">
          {catalogState.error}
        </p>
      ) : null}

      <div className="catalog-overview-grid">
        <Panel
          subtitle="Agents now have a dedicated catalog surface for inventory, provider-qualified identity, and runtime handoff."
          testId="catalog-agents-summary-panel"
          title="Agents"
        >
          <div className="catalog-metric-grid">
            <article className="catalog-metric-card">
              <p className="catalog-metric-label">Effective agents</p>
              <p className="catalog-metric-value">{allAgents.length}</p>
            </article>
            <article className="catalog-metric-card">
              <p className="catalog-metric-label">Provider-backed agents</p>
              <p className="catalog-metric-value">
                {allAgents.filter((asset) => Boolean(readAssetProviderId(asset))).length}
              </p>
            </article>
            <article className="catalog-metric-card">
              <p className="catalog-metric-label">Superpowers agents</p>
              <p className="catalog-metric-value">{featuredAgents.length}</p>
            </article>
          </div>

          <FormInput
            label="Filter agents"
            onValueChange={setSearchQuery}
            placeholder="Search by title, provider, namespace, or source package"
            testId="catalog-agents-search"
            type="search"
            value={searchQuery}
          />
        </Panel>

        <Panel
          subtitle="Keep provider-backed agents visible by name and make runtime engagement explicit."
          testId="catalog-agents-featured-provider-panel"
          title="Superpowers engagement"
        >
          <article className="catalog-spotlight-card" data-testid="catalog-agents-superpowers-provider">
            <div className="catalog-spotlight-header">
              <div>
                <p className="catalog-spotlight-kicker">Featured provider</p>
                <h4>{featuredProvider?.title || 'Superpowers for GitHub Copilot'}</h4>
                <p className="catalog-spotlight-copy">
                  {featuredAgents.length > 0
                    ? `${featuredAgents.length} provider-backed agent(s) are ready to inspect or hand off into runtime work.`
                    : 'No superpowers agents are currently projected, but the provider remains surfaced here for discovery and install management.'}
                </p>
              </div>
              <StatusBadge
                status={featuredProviderInstalled ? 'installed' : 'not-installed'}
                testId="catalog-agents-superpowers-status"
              />
            </div>

            <div className="catalog-overview-actions">
              <Button onClick={() => onOpenSection('skills')} testId="catalog-agents-open-skills">
                Open provider skills
              </Button>
              <Button onClick={onEngageRuntime} testId="catalog-agents-engage-runtime" variant="secondary">
                Engage in runtime
              </Button>
              {featuredProvider ? (
                <Button
                  disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating}
                  onClick={() => {
                    void catalogWorkspaceStore.installProvider({
                      providerId: featuredProvider.providerId,
                      action: featuredProviderAction,
                    });
                  }}
                  testId="catalog-agents-install-provider"
                  variant="ghost"
                >
                  {featuredProviderAction === 'update' ? 'Update provider' : 'Install provider'}
                </Button>
              ) : null}
            </div>
            {featuredProviderError ? <p className="state-message state-error">{featuredProviderError}</p> : null}
          </article>
        </Panel>
      </div>

      <Panel
        subtitle="Inspect agents without burying provider identity in generic metadata, then jump into runtime work from the same card."
        testId="catalog-agents-list-panel"
        title="Agent inventory"
      >
        {filteredAgents.length === 0 ? (
          <p className="state-message">No agents matched the current filter.</p>
        ) : (
          <div className="catalog-agent-list">
            {filteredAgents.map((asset) => {
              const entry = asset.selectedEntry ?? null;
              const providerId = readAssetProviderId(asset);
              const identityLabel = buildIdentityLabel(asset);
              return (
                <article className="catalog-agent-card" key={asset.assetId}>
                  <div className="catalog-agent-card-header">
                    <div>
                      <h4>{entry?.title || asset.assetKey || asset.assetId}</h4>
                      <p className="catalog-agent-description">{entry?.description || asset.assetId}</p>
                    </div>
                    <div className="catalog-badge-row">
                      <StatusBadge status={asset.installed ? 'installed' : 'not-installed'} testId="catalog-agent-installed" />
                      <StatusBadge status={asset.enabled ? 'enabled' : 'disabled'} testId="catalog-agent-enabled" />
                      {providerId ? <StatusBadge status={providerId} testId="catalog-agent-provider" /> : null}
                    </div>
                  </div>

                  <p className="catalog-inline-note">
                    {identityLabel || 'Local agent with no provider-qualified identity.'}
                  </p>
                  <p className="catalog-inline-note">
                    {entry?.metadata?.readOnly === true
                      ? 'External provider-backed agents stay read-only in generic asset management surfaces.'
                      : 'Editable agents can still be managed from the Assets section when you need install or override controls.'}
                  </p>

                  <div className="catalog-overview-actions">
                    <Button
                      onClick={() => {
                        void onInspectAsset(asset.assetId);
                      }}
                      testId="catalog-agent-inspect"
                    >
                      Inspect in Assets
                    </Button>
                    <Button onClick={onEngageRuntime} testId="catalog-agent-engage" variant="secondary">
                      Engage in runtime
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>
    </section>
  );
}
