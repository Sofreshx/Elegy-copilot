import { useEffect } from 'react';
import { Button, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
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

    </section>
  );
}
