import { useEffect, useMemo } from 'react';
import { Button, Panel, StatusBadge } from '../../components';
import { useStoreValue } from '../../lib/store';
import type { CatalogEffectiveAsset, CatalogEntry, CatalogProviderProjection } from '../../lib/types';
import { catalogWorkspaceStore } from '../Assets/catalogWorkspaceStore';
import { skillsPreviewStore } from '../SkillsPreview/skillsPreviewStore';

type CatalogSectionId = 'overview' | 'assets' | 'skills' | 'agents';

interface CatalogOverviewViewProps {
  onOpenSection: (section: CatalogSectionId) => void;
  onEngageRuntime: () => void;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return `${parsed.toLocaleDateString()} ${parsed.toLocaleTimeString()}`;
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

export default function CatalogOverviewView({
  onOpenSection,
  onEngageRuntime,
}: CatalogOverviewViewProps) {
  const catalogState = useStoreValue(catalogWorkspaceStore);
  const skillsState = useStoreValue(skillsPreviewStore);

  useEffect(() => {
    void catalogWorkspaceStore.loadWorkspace();
    void skillsPreviewStore.loadSkills();
  }, []);

  const providerProjections = Array.isArray(catalogState.summary?.providers)
    ? catalogState.summary.providers
    : [];
  const summaryStats = catalogState.summary?.stats;
  const activeRepo = catalogState.repoInventory?.selectedRepo ?? null;
  const featuredProvider =
    providerProjections.find((provider) => provider.providerId === 'superpowers-copilot') ?? null;
  const featuredSkills = useMemo(() => (
    skillsState.skills.filter((skill) => (
      skill.provider === 'superpowers-copilot' || skill.namespace === 'superpowers'
    ))
  ), [skillsState.skills]);
  const featuredAgents = useMemo(() => (
    catalogState.assets.filter((asset) => (
      asset.kind === 'agent' && readAssetProviderId(asset) === 'superpowers-copilot'
    ))
  ), [catalogState.assets]);

  const featuredProviderInstalled = providerLooksInstalled(featuredProvider);
  const featuredProviderError = readProviderStateString(featuredProvider, 'lastError');
  const featuredProviderAction = featuredProviderInstalled ? 'update' : 'install';
  const featuredSkillCount = Number(
    featuredProvider?.discoveredAssets?.byKind?.skill ??
    featuredSkills.length
  );
  const featuredAgentCount = Number(
    featuredProvider?.discoveredAssets?.byKind?.agent ??
    featuredAgents.length
  );

  return (
    <section className="catalog-overview-view" data-testid="catalog-overview-view">
      {catalogState.error ? (
        <p className="state-message state-error" role="alert">
          {catalogState.error}
        </p>
      ) : null}
      {catalogState.summaryError ? (
        <p className="state-message state-error" role="alert">
          {catalogState.summaryError}
        </p>
      ) : null}
      {skillsState.error ? (
        <p className="state-message state-error" role="alert">
          {skillsState.error}
        </p>
      ) : null}

      <div className="catalog-overview-grid">
        <Panel
          subtitle="Installed vs effective counts, discovery mix, and immediate routing into dedicated catalog surfaces."
          testId="catalog-overview-summary-panel"
          title="Catalog Overview"
        >
          <div className="catalog-metric-grid">
            <article className="catalog-metric-card" data-testid="catalog-overview-effective-count">
              <p className="catalog-metric-label">Effective assets</p>
              <p className="catalog-metric-value">{summaryStats?.effectiveCount ?? catalogState.assets.length}</p>
            </article>
            <article className="catalog-metric-card" data-testid="catalog-overview-installed-count">
              <p className="catalog-metric-label">Installed assets</p>
              <p className="catalog-metric-value">{summaryStats?.installedCount ?? 0}</p>
            </article>
            <article className="catalog-metric-card" data-testid="catalog-overview-skill-count">
              <p className="catalog-metric-label">Skills ready to preview</p>
              <p className="catalog-metric-value">{skillsState.skills.length}</p>
            </article>
            <article className="catalog-metric-card" data-testid="catalog-overview-agent-count">
              <p className="catalog-metric-label">Agent inventory</p>
              <p className="catalog-metric-value">
                {summaryStats?.byKind?.agent ?? catalogState.assets.filter((asset) => asset.kind === 'agent').length}
              </p>
            </article>
          </div>

          <div className="catalog-overview-actions">
            <Button onClick={() => onOpenSection('assets')} testId="catalog-overview-open-assets">
              Open Assets
            </Button>
            <Button onClick={() => onOpenSection('skills')} testId="catalog-overview-open-skills" variant="secondary">
              Browse Skills
            </Button>
            <Button onClick={() => onOpenSection('agents')} testId="catalog-overview-open-agents" variant="secondary">
              Browse Agents
            </Button>
          </div>
        </Panel>

        <Panel
          subtitle="The current projection keeps repo-aware context, bundle routing, and provider installs visible before deeper browsing."
          testId="catalog-overview-context-panel"
          title="Projection Context"
        >
          <dl className="catalog-definition-grid">
            <div>
              <dt>Selected repo</dt>
              <dd>{activeRepo?.repoLabel || activeRepo?.repoPath || catalogState.activeRepoPath || 'Global projection'}</dd>
            </div>
            <div>
              <dt>Generated</dt>
              <dd>{formatTimestamp(catalogState.summary?.generatedAt)}</dd>
            </div>
            <div>
              <dt>Read mode</dt>
              <dd>{catalogState.summary?.readMode || catalogState.runtimeHealth?.projection?.readMode || 'unknown'}</dd>
            </div>
            <div>
              <dt>Bundles</dt>
              <dd>{catalogState.bundles.length}</dd>
            </div>
            <div>
              <dt>Providers</dt>
              <dd>{providerProjections.length}</dd>
            </div>
            <div>
              <dt>Managed-import providers</dt>
              <dd>{catalogState.summary?.activation?.managedImportProviderIds?.join(', ') || 'None surfaced'}</dd>
            </div>
          </dl>
        </Panel>
      </div>

      <Panel
        subtitle="superpowers-copilot is a first-class provider-backed capability pack, not just metadata on individual rows."
        testId="catalog-overview-featured-provider-panel"
        title="Featured provider"
      >
        <article className="catalog-spotlight-card" data-testid="catalog-overview-superpowers-provider">
          <div className="catalog-spotlight-header">
            <div>
              <p className="catalog-spotlight-kicker">Provider pack</p>
              <h4>{featuredProvider?.title || 'Superpowers for GitHub Copilot'}</h4>
              <p className="catalog-spotlight-copy">{featuredProvider?.description || 'Provider-backed skills and agents surfaced from the frozen catalog architecture.'}</p>
            </div>
            <StatusBadge
              status={featuredProviderInstalled ? 'installed' : 'not-installed'}
              testId="catalog-overview-superpowers-status"
            />
          </div>

          <div className="catalog-metric-grid">
            <article className="catalog-metric-card">
              <p className="catalog-metric-label">Provider ID</p>
              <p className="catalog-metric-value catalog-metric-value-small">superpowers-copilot</p>
            </article>
            <article className="catalog-metric-card">
              <p className="catalog-metric-label">Skills discovered</p>
              <p className="catalog-metric-value">{featuredSkillCount}</p>
            </article>
            <article className="catalog-metric-card">
              <p className="catalog-metric-label">Agents discovered</p>
              <p className="catalog-metric-value">{featuredAgentCount}</p>
            </article>
            <article className="catalog-metric-card">
              <p className="catalog-metric-label">Install strategy</p>
              <p className="catalog-metric-value catalog-metric-value-small">{featuredProvider?.installStrategy || 'managed-import'}</p>
            </article>
          </div>

          <p className="catalog-inline-note">
            Provider-qualified identities remain visible across skills and agents, and externally sourced assets stay read-only in catalog management surfaces.
          </p>
          {featuredProviderError ? <p className="state-message state-error">{featuredProviderError}</p> : null}

          <div className="catalog-overview-actions">
            <Button onClick={() => onOpenSection('skills')} testId="catalog-overview-open-superpowers-skills">
              View provider skills
            </Button>
            <Button onClick={() => onOpenSection('agents')} testId="catalog-overview-open-superpowers-agents" variant="secondary">
              View provider agents
            </Button>
            <Button onClick={onEngageRuntime} testId="catalog-overview-engage-runtime" variant="secondary">
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
                testId="catalog-overview-install-provider"
                variant="ghost"
              >
                {featuredProviderAction === 'update' ? 'Update provider' : 'Install provider'}
              </Button>
            ) : null}
          </div>
        </article>
      </Panel>
    </section>
  );
}
