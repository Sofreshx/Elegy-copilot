import { useEffect, useMemo, useState } from 'react';
import { Button, FormInput, Panel, StatusBadge } from '../../components';
import { useStoreValue } from '../../lib/store';
import type { CatalogEffectiveAsset, CatalogEntry } from '../../lib/types';
import { catalogWorkspaceStore } from '../Assets/catalogWorkspaceStore';
import { navigationStore } from '../../stores/navigation';
import { assetCreationStore } from '../../views/Catalog/assetCreationStore';

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
          </div>

          <FormInput
            label="Filter agents"
            onValueChange={setSearchQuery}
            placeholder="Search by title, provider, namespace, or source package"
            testId="catalog-agents-search"
            type="search"
            value={searchQuery}
          />
          <Button
            onClick={() => {
              assetCreationStore.reset();
              assetCreationStore.setKind('agent');
              navigationStore.openWizard('asset');
            }}
            testId="catalog-create-agent"
            variant="secondary"
          >
            + Create Agent
          </Button>
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
