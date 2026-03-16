import { useEffect, useMemo, useState } from 'react';
import { Button, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { navigationStore } from '../../stores/navigation';
import { catalogWorkspaceStore } from '../Assets/catalogWorkspaceStore';
import MermaidViewer from './MermaidViewer';
import PlanningIdeasPanel from './PlanningIdeasPanel';
import { planningStore } from './planningStore';
import { planningWorkspaceStore } from './planningWorkspaceStore';
import ResearchNotesPanel from './ResearchNotesPanel';

function normalizeCatalogRepoEntry(repo: unknown) {
  if (!repo || typeof repo !== 'object') {
    return null;
  }

  const record = repo as Record<string, unknown>;
  const repoId = typeof record.repoId === 'string' ? record.repoId.trim() : '';
  const repoPath = typeof record.repoPath === 'string' ? record.repoPath.trim() : '';
  const repoLabel = typeof record.repoLabel === 'string' ? record.repoLabel.trim() : '';
  const sources = Array.isArray(record.sources)
    ? record.sources.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];

  if (!repoId && !repoPath && !repoLabel && sources.length === 0) {
    return null;
  }

  return {
    repoId,
    repoPath,
    repoLabel,
    sources,
  };
}

function resolveCatalogRepoContext(catalogState: ReturnType<typeof catalogWorkspaceStore.getState>) {
  const selectedRepo = normalizeCatalogRepoEntry(catalogState.repoInventory?.selectedRepo);
  if (selectedRepo) {
    return selectedRepo;
  }

  const repos = Array.isArray(catalogState.repoInventory?.repos) ? catalogState.repoInventory.repos : [];
  const activeRepoId = typeof catalogState.activeRepoId === 'string' ? catalogState.activeRepoId.trim() : '';
  const activeRepoPath = typeof catalogState.activeRepoPath === 'string' ? catalogState.activeRepoPath.trim() : '';

  return (
    normalizeCatalogRepoEntry(
      repos.find((repo) => {
        const repoRecord = repo as Record<string, unknown>;
        const repoId = typeof repoRecord.repoId === 'string' ? repoRecord.repoId.trim() : '';
        const repoPath = typeof repoRecord.repoPath === 'string' ? repoRecord.repoPath.trim() : '';
        return (activeRepoId && repoId === activeRepoId) || (activeRepoPath && repoPath === activeRepoPath);
      })
    )
    ?? null
  );
}

export default function PlanningView({ onSdkSessionReady }: { onSdkSessionReady?: (sessionId: string) => void }) {
  const planningState = useStoreValue(planningStore);
  const planningWorkspaceState = useStoreValue(planningWorkspaceStore);
  const catalogState = useStoreValue(catalogWorkspaceStore);
  const [showLegacyArtifacts, setShowLegacyArtifacts] = useState(false);

  const selectedCatalogRepo = useMemo(() => resolveCatalogRepoContext(catalogState), [catalogState]);

  useEffect(() => {
    planningWorkspaceStore.syncCatalogRepoContext(selectedCatalogRepo);

    if (selectedCatalogRepo?.repoPath) {
      void planningWorkspaceStore.loadRoadmaps();
    }
  }, [
    selectedCatalogRepo?.repoId,
    selectedCatalogRepo?.repoLabel,
    selectedCatalogRepo?.repoPath,
    selectedCatalogRepo?.sources.join('|'),
  ]);

  useEffect(() => {
    if (showLegacyArtifacts) {
      void planningStore.loadInitial();
    }
  }, [showLegacyArtifacts]);

  const selectedRoadmap =
    planningWorkspaceState.roadmaps.find((roadmap) => roadmap.slug === planningWorkspaceState.selectedRoadmapSlug)
    ?? planningWorkspaceState.roadmaps[0]
    ?? null;
  const selectedLegacyRecord =
    planningState.records.find((record) => record.recordId === planningState.selectedRecordId)
    ?? planningState.records[0]
    ?? null;
  const selectedLegacyDiagram =
    planningState.diagrams.find((diagram) => diagram.id === planningState.selectedDiagramId)
    ?? planningState.diagrams[0]
    ?? null;

  return (
    <section className="planning-view" data-testid="planning-view">
      <Toolbar testId="planning-view-toolbar">
        <div className="planning-summary">
          <p className="planning-title">Repository Backlog + Roadmaps</p>
          <p className="planning-copy">
            Repo-backed planning surfaces resolve from the selected Catalog repository before legacy planning records.
          </p>
        </div>

        <div className="planning-toolbar-actions">
          <Button onClick={() => navigationStore.goToCatalog()} testId="planning-open-catalog" variant="secondary">
            Open Catalog repo selector
          </Button>
          <Button
            onClick={() => setShowLegacyArtifacts((value) => !value)}
            testId="planning-show-legacy-artifacts"
            variant="secondary"
          >
            {showLegacyArtifacts ? 'Hide legacy artifacts' : 'Show legacy artifacts'}
          </Button>
        </div>
      </Toolbar>

      {planningWorkspaceState.error ? (
        <p className="planning-error" role="alert">
          {planningWorkspaceState.error}
        </p>
      ) : null}

      <div className="planning-grid">
        <Panel
          subtitle="Planning uses the currently selected Catalog repo as the canonical source of backlog and roadmap files."
          testId="planning-backlog-surface-panel"
          title="Repository Backlog"
        >
          {selectedCatalogRepo ? (
            <div className="planning-controls">
              <label className="form-input" htmlFor="planning-repo-id-readonly">
                <span className="form-label">Catalog Repo ID</span>
                <input
                  data-testid="planning-repo-id-readonly"
                  id="planning-repo-id-readonly"
                  readOnly
                  type="text"
                  value={selectedCatalogRepo.repoId}
                />
              </label>

              <p className="planning-copy">
                {planningWorkspaceState.repositoryBacklog?.canonicalName || 'Repository Backlog'}
              </p>
              <p className="planning-copy">
                <code>{planningWorkspaceState.repositoryBacklog?.filePath || '(no backlog file resolved)'}</code>
              </p>
              <p className="planning-copy">
                Stable IDs: <code>{planningWorkspaceState.repositoryBacklog?.stableIdPattern || 'RB-###'}</code>
              </p>
            </div>
          ) : (
            <div className="planning-controls">
              <p className="state-message">Select a repository in Catalog to resolve backlog and roadmap surfaces.</p>
            </div>
          )}
        </Panel>

        <Panel
          subtitle="Roadmaps come from docs/roadmaps in the selected repository."
          testId="planning-roadmap-surface-panel"
          title="Roadmap Surface"
        >
          <div className="planning-controls">
            <p className="planning-copy">
              <code>{planningWorkspaceState.roadmapDirectory?.directoryPath || '(no roadmap directory resolved)'}</code>
            </p>
            <p className="planning-copy">
              Stable IDs: <code>{planningWorkspaceState.roadmapDirectory?.stableIdPattern || 'RM-<roadmap-slug>-###'}</code>
            </p>
            {planningWorkspaceState.loading ? (
              <p className="planning-copy">Loading roadmaps…</p>
            ) : null}
          </div>
        </Panel>

        <Panel
          subtitle="Choose a roadmap document for this repository."
          testId="planning-roadmap-list"
          title="Roadmaps"
        >
          <div className="planning-controls">
            <label className="form-input" htmlFor="planning-roadmap-select">
              <span className="form-label">Selected roadmap</span>
              <select
                data-testid="planning-roadmap-select"
                id="planning-roadmap-select"
                onChange={(event) => planningWorkspaceStore.setSelectedRoadmapSlug(event.target.value)}
                value={selectedRoadmap?.slug || ''}
              >
                {planningWorkspaceState.roadmaps.length === 0 ? <option value="">(no roadmaps found)</option> : null}
                {planningWorkspaceState.roadmaps.map((roadmap) => (
                  <option key={roadmap.slug} value={roadmap.slug}>
                    {roadmap.title}
                  </option>
                ))}
              </select>
            </label>

            <ul className="planning-record-list">
              {planningWorkspaceState.roadmaps.map((roadmap) => (
                <li key={roadmap.slug}>
                  <p className="planning-item-title">{roadmap.title}</p>
                  <p className="planning-item-copy">
                    <code>{roadmap.repoRelativePath || roadmap.filePath}</code>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <Panel
          subtitle="Roadmap items are the repo-backed execution roll-up above plan packs."
          testId="planning-roadmap-detail"
          title={selectedRoadmap?.title || 'Roadmap detail'}
        >
          {selectedRoadmap ? (
            <div className="planning-controls">
              {selectedRoadmap.overview ? <p className="planning-copy">{selectedRoadmap.overview}</p> : null}
              <p className="planning-copy">
                <code>{selectedRoadmap.filePath}</code>
              </p>
              <ul className="planning-record-list">
                {selectedRoadmap.items.map((item) => (
                  <li key={item.id}>
                    <p className="planning-item-title">{item.title}</p>
                    <p className="planning-item-copy">
                      <code>{item.id}</code> | phase={item.phase} | status={item.status}
                    </p>
                    {item.backlogIds.length > 0 ? (
                      <p className="planning-item-copy">Backlog links: {item.backlogIds.join(', ')}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="planning-controls">
              <p className="state-message">No roadmap selected for the active repository.</p>
            </div>
          )}
        </Panel>

        {showLegacyArtifacts ? (
          <Panel
            subtitle="Historical planning records and record-scoped artifacts remain available as compatibility-only context."
            testId="planning-legacy-artifacts-panel"
            title="Legacy Planning Artifacts"
          >
            <div className="planning-controls">
              <PlanningIdeasPanel onSdkSessionReady={onSdkSessionReady} planningState={planningState} />

              {planningState.records.length > 0 ? (
                <label className="form-input" htmlFor="planning-legacy-record-select">
                  <span className="form-label">Legacy record</span>
                  <select
                    data-testid="planning-legacy-record-select"
                    id="planning-legacy-record-select"
                    onChange={(event) => planningStore.setSelectedRecordId(event.target.value)}
                    value={selectedLegacyRecord?.recordId || ''}
                  >
                    {planningState.records.map((record) => (
                      <option key={record.recordId} value={record.recordId}>
                        {record.title || record.recordId}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="state-message">No legacy planning records available.</p>
              )}

              <ResearchNotesPanel
                deleting={planningState.artifactsDeleting}
                error={planningState.artifactsError}
                loading={planningState.artifactsLoading}
                notes={planningState.researchNotes}
                onDelete={async (noteId) => {
                  await planningStore.removeResearchNote(noteId);
                }}
                onRefresh={() => {
                  void planningStore.loadArtifacts(selectedLegacyRecord?.recordId || '');
                }}
                onSave={async (note) => {
                  await planningStore.saveResearchNote(note);
                }}
                recordId={selectedLegacyRecord?.recordId || planningState.selectedRecordId}
                saving={planningState.artifactsSaving}
              />

              <MermaidViewer diagram={selectedLegacyDiagram} />
            </div>
          </Panel>
        ) : null}
      </div>
    </section>
  );
}
