import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Button, Panel, Toolbar } from '../../components';
import type { PlanningLinkedPlanSession } from '../../lib/types';
import { useStoreValue } from '../../lib/store';
import { navigationStore } from '../../stores/navigation';
import { catalogWorkspaceStore } from '../Assets/catalogWorkspaceStore';
import { sessionsStore } from '../Sessions/sessionsStore';
import PlanningIdeasPanel from './PlanningIdeasPanel';
import PlanningPathActions from './PlanningPathActions';
import { planningStore } from './planningStore';
import { planningWorkspaceStore } from './planningWorkspaceStore';

const ObsidianNotesPanel = lazy(() => import('./ObsidianNotesPanel'));
const ResearchNotesPanel = lazy(() => import('./ResearchNotesPanel'));
const MermaidViewer = lazy(() => import('./MermaidViewer'));

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

type NormalizedCatalogRepoEntry = NonNullable<ReturnType<typeof normalizeCatalogRepoEntry>>;

type SeedablePlanningArtifact = {
  id: string;
  title: string;
  promotedPlanRefs?: string[];
  [key: string]: unknown;
};

type PlanningMode = 'workflow' | 'compatibility';
type PlanningSection = 'plans' | 'bullets' | 'backlog' | 'roadmaps';

function PlanningPlanAuthoringPanel(props: {
  linkedPlanSession: PlanningLinkedPlanSession | null;
  selectedCatalogRepoId: string;
  selectedCatalogRepoLabel: string;
  planTitleDraft: string;
  planContentDraft: string;
  planLoading: boolean;
  planSaving: boolean;
  planError: string | null;
  onPlanTitleChange: (value: string) => void;
  onPlanContentChange: (value: string) => void;
  onSaveBlankPlan: () => void;
  onReloadPlan: () => void;
  onOpenLinkedPlanSession: (sessionId: string) => void;
}) {
  return (
    <Panel
      subtitle="Create or reopen a linked session plan.md directly from Planning. Use Bullets, Backlog, or Roadmaps to seed a plan when you want a linked starting artifact."
      testId="planning-plan-authoring-panel"
      title="Create / Edit Plan"
    >
      <div className="planning-controls">
        <p className="planning-copy">
          <strong>Repo scope:</strong> <code>{props.selectedCatalogRepoId || '(workspace)'}</code>
        </p>
        <p className="planning-copy">
          {props.linkedPlanSession
            ? `Linked local session ${props.linkedPlanSession.sessionId} is ready for direct plan authoring.`
            : `No linked local planning session yet for ${props.selectedCatalogRepoLabel || 'the current workspace'}.`}
        </p>
        {props.linkedPlanSession ? (
          <PlanningPathActions
            emptyMessage="The linked session exists, but its plan path has not been resolved yet."
            openLabel="Open linked plan"
            path={props.linkedPlanSession.planPath || null}
            testIdPrefix="planning-linked-plan-file"
          />
        ) : null}
        <label className="form-input" htmlFor="planning-plan-title">
          <span className="form-label">Plan title</span>
          <input
            data-testid="planning-plan-title"
            id="planning-plan-title"
            onChange={(event) => props.onPlanTitleChange(event.target.value)}
            placeholder="Elegy Copilot planning follow-up"
            type="text"
            value={props.planTitleDraft}
          />
        </label>
        <label className="form-input" htmlFor="planning-plan-content">
          <span className="form-label">Session plan.md</span>
          <textarea
            data-testid="planning-plan-content"
            id="planning-plan-content"
            onChange={(event) => props.onPlanContentChange(event.target.value)}
            placeholder="Use Create plan to generate a repo-scoped session plan, then continue editing here."
            rows={18}
            value={props.planContentDraft}
          />
        </label>
        {props.planLoading ? <p className="planning-copy">Loading linked plan…</p> : null}
        {props.planError ? (
          <p className="planning-error" role="alert">
            {props.planError}
          </p>
        ) : null}
        <div className="planning-actions">
          <Button
            disabled={props.planSaving}
            onClick={props.onSaveBlankPlan}
            testId="planning-save-plan"
          >
            {props.linkedPlanSession ? 'Save plan' : 'Create plan'}
          </Button>
          <Button
            disabled={!props.linkedPlanSession || props.planSaving}
            onClick={() => {
              if (props.linkedPlanSession) {
                props.onOpenLinkedPlanSession(props.linkedPlanSession.sessionId);
              }
            }}
            testId="planning-open-linked-plan-session"
            variant="secondary"
          >
            Open in Sessions
          </Button>
          <Button
            disabled={!props.linkedPlanSession || props.planSaving}
            onClick={props.onReloadPlan}
            testId="planning-reload-linked-plan"
            variant="ghost"
          >
            Reload linked plan
          </Button>
        </div>
      </div>
    </Panel>
  );
}

export default function PlanningView() {
  const planningState = useStoreValue(planningStore);
  const planningWorkspaceState = useStoreValue(planningWorkspaceStore);
  const catalogState = useStoreValue(catalogWorkspaceStore);
  const [activeMode, setActiveMode] = useState<PlanningMode>('workflow');
  const [activeSection, setActiveSection] = useState<PlanningSection>('plans');

  const selectedCatalogRepo = useMemo(() => resolveCatalogRepoContext(catalogState), [catalogState]);
  const knownCatalogRepos = useMemo(() => {
    const repos = Array.isArray(catalogState.repoInventory?.repos) ? catalogState.repoInventory.repos : [];
    return repos
      .map((repo) => normalizeCatalogRepoEntry(repo))
      .filter((repo): repo is NormalizedCatalogRepoEntry => repo !== null);
  }, [catalogState.repoInventory?.repos]);
  const selectedRoadmap =
    planningWorkspaceState.roadmaps.find((roadmap) => roadmap.slug === planningWorkspaceState.selectedRoadmapSlug)
    ?? planningWorkspaceState.roadmaps[0]
    ?? null;
  const selectedPlanningRecord =
    planningState.records.find((record) => record.recordId === planningState.selectedRecordId)
    ?? planningState.records[0]
    ?? null;
  const selectedDiagram =
    planningState.diagrams.find((diagram) => diagram.id === planningState.selectedDiagramId)
    ?? planningState.diagrams[0]
    ?? null;
  const intakeArtifactCount = planningWorkspaceState.intakeSummary?.artifactCount ?? planningWorkspaceState.intakeArtifacts.length;

  const loadCompatibilityContext = () => {
    const work: Array<Promise<unknown>> = [planningStore.loadInitial()];

    if (selectedCatalogRepo?.repoPath) {
      work.push(
        planningWorkspaceStore.loadIntakeArtifacts(),
        planningWorkspaceStore.loadObsidianNotes(),
        planningWorkspaceStore.loadObsidianRepresentations(),
      );
    }

    return Promise.allSettled(work);
  };

  useEffect(() => {
    if (catalogState.repoInventory || catalogState.repoInventoryLoading || catalogState.loading) {
      return;
    }

    void catalogWorkspaceStore.loadWorkspace();
  }, [catalogState.repoInventory, catalogState.repoInventoryLoading, catalogState.loading]);

  useEffect(() => {
    planningStore.applyCatalogRepoContext(selectedCatalogRepo);
    planningWorkspaceStore.syncCatalogRepoContext(selectedCatalogRepo);

    if (selectedCatalogRepo?.repoPath) {
      void Promise.allSettled([
        planningWorkspaceStore.loadBullets(),
        planningWorkspaceStore.loadBacklog(),
        planningWorkspaceStore.loadRoadmaps(),
      ]);
    }
  }, [
    selectedCatalogRepo?.repoId,
    selectedCatalogRepo?.repoLabel,
    selectedCatalogRepo?.repoPath,
    selectedCatalogRepo?.sources.join('|'),
  ]);

  useEffect(() => {
    if (!planningState.linkedPlanSession?.sessionId) {
      return;
    }

    if (planningState.planContentDraft.trim()) {
      return;
    }

    void planningStore.loadLinkedPlan();
  }, [planningState.linkedPlanSession?.sessionId]);

  useEffect(() => {
    if (activeMode !== 'compatibility') {
      return;
    }

    void loadCompatibilityContext();
  }, [
    activeMode,
    selectedCatalogRepo?.repoId,
    selectedCatalogRepo?.repoLabel,
    selectedCatalogRepo?.repoPath,
    selectedCatalogRepo?.sources.join('|'),
  ]);

  const planningCounts = useMemo(() => ({
    bullets: planningWorkspaceState.bullets.length,
    backlog: planningWorkspaceState.backlogSummary?.items?.length ?? 0,
    roadmaps: planningWorkspaceState.roadmaps.length,
  }), [
    planningWorkspaceState.bullets,
    planningWorkspaceState.backlogSummary?.items,
    planningWorkspaceState.roadmaps,
  ]);
  const backlogPrimarySurfacePath = planningWorkspaceState.backlogSummary?.primaryDirectoryPath
    || planningWorkspaceState.repositoryBacklog?.primaryDirectoryPath
    || planningWorkspaceState.repositoryBacklog?.filePath
    || planningWorkspaceState.backlogSummary?.backlogPath
    || null;
  const backlogPrimarySurfaceRepoRelativePath = planningWorkspaceState.backlogSummary?.primaryRepoRelativePath
    || planningWorkspaceState.repositoryBacklog?.primaryRepoRelativePath
    || planningWorkspaceState.repositoryBacklog?.repoRelativePath
    || planningWorkspaceState.backlogSummary?.repoRelativePath
    || 'docs/backlogs';
  const backlogPrimaryFamilyRepoRelativePath = planningWorkspaceState.backlogSummary?.primaryFamilyRepoRelativePath
    || planningWorkspaceState.repositoryBacklog?.primaryFamilyRepoRelativePath
    || 'docs/backlogs/*.md';
  const backlogLegacyRepoRelativePath = planningWorkspaceState.backlogSummary?.legacyRepoRelativePath
    || planningWorkspaceState.repositoryBacklog?.legacyRepoRelativePath
    || 'docs/backlog.md';
  const backlogResolvedSources = planningWorkspaceState.backlogSummary?.resolvedRepoRelativePaths ?? [];

  const sectionCopy: Record<PlanningSection, { title: string; body: string }> = {
    plans: {
      title: 'Plans',
      body: 'Author or reopen the active session plan and keep linked PB/RB/RM context explicit.',
    },
    bullets: {
      title: 'Bullets',
      body: 'Capture repo-scoped bullet seeds in docs/planning/bullets.md and promote them into backlog, roadmaps, or plans without losing linkage.',
    },
    backlog: {
      title: 'Backlog',
      body: 'Browse docs/backlogs/*.md as the primary queued-work surface and start plans from accepted backlog slices, while docs/backlog.md stays available for legacy compatibility.',
    },
    roadmaps: {
      title: 'Roadmaps',
      body: 'Explore docs/roadmaps/*.md as the multi-plan outcome layer above backlog and individual session plans.',
    },
  };
  const toolbarCopy = activeMode === 'workflow'
    ? sectionCopy[activeSection].body
    : 'Compatibility/operator tools for typed intake, external Obsidian notes, and legacy planning-record artifacts.';

  const seedPlanFromArtifact = async (artifact: SeedablePlanningArtifact): Promise<void> => {
    const sessionId = await planningStore.savePlanDraft({
      title: planningState.planTitleDraft || artifact.title,
      seedArtifact: artifact,
    });

    if (sessionId && artifact.id.startsWith('PB-')) {
      const promotedPlanRefs = Array.isArray(artifact.promotedPlanRefs)
        ? artifact.promotedPlanRefs.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [];
      await planningWorkspaceStore.patchBullet(artifact.id, {
        promotedPlanRefs: [...new Set([...promotedPlanRefs, sessionId])].sort(),
      });
    }

    if (sessionId) {
      setActiveMode('workflow');
      setActiveSection('plans');
    }
  };

  const refreshPlanningContext = () => {
    if (activeMode === 'compatibility') {
      void loadCompatibilityContext();
      return;
    }

    const work: Array<Promise<unknown>> = [];

    if (selectedCatalogRepo?.repoPath) {
      work.push(
        planningWorkspaceStore.loadBullets(),
        planningWorkspaceStore.loadBacklog(),
        planningWorkspaceStore.loadRoadmaps(),
      );
    }

    if (planningState.linkedPlanSession?.sessionId) {
      work.push(planningStore.loadLinkedPlan());
    }

    void Promise.allSettled(work);
  };

  return (
    <section className="planning-view" data-testid="planning-view">
      <Toolbar testId="planning-view-toolbar">
        <div className="workspace-nav-summary">
          <p className="workspace-nav-title">Planning</p>
          <p className="workspace-nav-copy">{toolbarCopy}</p>
        </div>

        <div className="planning-toolbar-actions">
          <div className="planning-actions" role="tablist" aria-label="Planning modes">
            <Button
              onClick={() => setActiveMode('workflow')}
              testId="planning-mode-workflow"
              variant={activeMode === 'workflow' ? 'primary' : 'ghost'}
            >
              Primary workflow
            </Button>
            <Button
              onClick={() => setActiveMode('compatibility')}
              testId="planning-mode-compatibility"
              variant={activeMode === 'compatibility' ? 'primary' : 'ghost'}
            >
              Compatibility / Debug
            </Button>
          </div>
          <label className="form-input" htmlFor="planning-active-repo-select">
            <span className="form-label">Planning repo</span>
            <select
              data-testid="planning-active-repo-select"
              id="planning-active-repo-select"
              onChange={(event) => {
                const repoId = event.target.value.trim();
                if (!repoId) {
                  return;
                }
                void catalogWorkspaceStore.selectRepo({ repoId });
              }}
              value={selectedCatalogRepo?.repoId || ''}
            >
              <option value="">
                {catalogState.repoInventoryLoading
                  ? '(loading known repos...)'
                  : knownCatalogRepos.length > 0
                    ? '(choose a Catalog repo)'
                    : '(no Catalog repos available)'}
              </option>
              {knownCatalogRepos.map((repo) => (
                <option key={repo.repoId} value={repo.repoId}>
                  {repo.repoLabel || repo.repoId || repo.repoPath}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={() => navigationStore.goToCatalog('assets')} testId="planning-open-catalog" variant="secondary">
            Open Catalog Assets
          </Button>
          <Button
            disabled={!selectedCatalogRepo?.repoPath}
            onClick={refreshPlanningContext}
            testId="planning-refresh-context"
            variant="ghost"
          >
            Refresh visible planning data
          </Button>
        </div>
      </Toolbar>

      {activeMode === 'workflow' ? (
        <>
          <div className="workspace-nav" role="tablist" aria-label="Planning sections">
            <Button onClick={() => setActiveSection('plans')} testId="planning-section-plans" variant={activeSection === 'plans' ? 'primary' : 'ghost'}>
              Plans
            </Button>
            <Button onClick={() => setActiveSection('bullets')} testId="planning-section-bullets" variant={activeSection === 'bullets' ? 'primary' : 'ghost'}>
              Bullets ({planningCounts.bullets})
            </Button>
            <Button onClick={() => setActiveSection('backlog')} testId="planning-section-backlog" variant={activeSection === 'backlog' ? 'primary' : 'ghost'}>
              Backlog ({planningCounts.backlog})
            </Button>
            <Button onClick={() => setActiveSection('roadmaps')} testId="planning-section-roadmaps" variant={activeSection === 'roadmaps' ? 'primary' : 'ghost'}>
              Roadmaps ({planningCounts.roadmaps})
            </Button>
          </div>

          <p className="workspace-section-label">{sectionCopy[activeSection].title}</p>
        </>
      ) : (
        <p className="workspace-section-label">Compatibility / Debug</p>
      )}

      <div className="planning-metric-grid" data-testid="planning-context-summary">
        <div className="planning-metric-card">
          <p className="planning-metric-label">Active repo</p>
          <p className="planning-metric-value planning-metric-value-small">
            {selectedCatalogRepo?.repoLabel || 'Select a Catalog repo'}
          </p>
          <p className="planning-copy">
            <code>{selectedCatalogRepo?.repoId || '(no repo selected)'}</code>
          </p>
        </div>
        <div className="planning-metric-card">
          <p className="planning-metric-label">Bullets</p>
          <p className="planning-metric-value">{planningCounts.bullets}</p>
          <p className="planning-copy">Freeform future-plan seeds in <code>docs/planning/bullets.md</code>.</p>
        </div>
        <div className="planning-metric-card">
          <p className="planning-metric-label">Backlog items</p>
          <p className="planning-metric-value">{planningCounts.backlog}</p>
          <p className="planning-copy">Accepted or queued repo work in <code>docs/backlogs/*.md</code>, with <code>docs/backlog.md</code> kept for compatibility.</p>
        </div>
        <div className="planning-metric-card">
          <p className="planning-metric-label">Roadmaps</p>
          <p className="planning-metric-value">{planningCounts.roadmaps}</p>
          <p className="planning-copy">Multi-plan outcomes in <code>docs/roadmaps</code>.</p>
        </div>
        <div className="planning-metric-card">
          <p className="planning-metric-label">Plan link</p>
          <p className="planning-metric-value planning-metric-value-small">
            {planningState.linkedPlanSession?.sessionId || 'Not created yet'}
          </p>
          <p className="planning-copy">
            {planningState.linkedPlanSession
              ? 'Planning can reopen the repo-scoped local session plan.'
              : 'Create or seed a plan from Plans, Bullets, Backlog, or Roadmaps.'}
          </p>
        </div>
      </div>

      {activeMode === 'compatibility' ? (
        <>
          <Panel
            subtitle="These surfaces remain available for operator workflows, debugging, and backward compatibility. They are intentionally outside the primary Plans/Bullets/Backlog/Roadmaps path."
            testId="planning-compatibility-header"
            title="Compatibility / Debug Tools"
          >
            <div className="planning-controls">
              <p className="planning-copy">
                Use this area for typed intake, external Obsidian notes and mirrors, plus legacy planning-record artifacts.
              </p>
              <p className="planning-copy">
                Canonical planning authority still lives in repo bullets, backlog docs, roadmaps, and the active session
                <code> plan.md</code>
                .
              </p>
            </div>
          </Panel>

          <div className="planning-grid">
            <Panel
              subtitle="Structured intake artifacts remain available as a compatibility/operator surface and load only when this mode is open."
              testId="planning-compatibility-intake-panel"
              title="Typed Intake Compatibility"
            >
              {selectedCatalogRepo ? (
                <div className="planning-controls">
                  <PlanningPathActions
                    emptyMessage="No typed intake directory resolved for the active repository yet."
                    openLabel="Open intake folder"
                    path={planningWorkspaceState.planningIntakeDirectory?.directoryPath}
                    repoRelativePath={planningWorkspaceState.planningIntakeDirectory?.repoRelativePath}
                    testIdPrefix="planning-intake-surface-directory"
                  />
                  <p className="planning-copy">
                    Stable IDs: <code>{planningWorkspaceState.planningIntakeDirectory?.stableIdPattern || 'PI-###'}</code>
                  </p>
                  <p className="planning-copy">
                    Supported categories: {planningWorkspaceState.planningIntakeDirectory?.supportedCategories.join(', ') || 'idea, research, roadmap-request'}
                  </p>
                  <p className="planning-copy">Artifacts available: {intakeArtifactCount}</p>
                  {planningWorkspaceState.intakeLoading ? <p className="planning-copy">Loading typed intake…</p> : null}
                  {planningWorkspaceState.intakeError ? (
                    <p className="planning-error" role="alert">
                      {planningWorkspaceState.intakeError}
                    </p>
                  ) : null}
                  {planningWorkspaceState.intakeArtifacts.length > 0 ? (
                    <ul className="planning-record-list" data-testid="planning-compatibility-intake-list">
                      {planningWorkspaceState.intakeArtifacts.map((artifact) => (
                        <li key={artifact.id}>
                          <p className="planning-item-title">{artifact.title}</p>
                          <p className="planning-item-copy">{artifact.summary || 'No summary yet.'}</p>
                          <div className="planning-chip-row">
                            <span className="planning-chip"><code>{artifact.id}</code></span>
                            <span className="planning-chip">category: {artifact.category}</span>
                            {artifact.planningState ? <span className="planning-chip">state: {artifact.planningState}</span> : null}
                          </div>
                          {artifact.targetRepoIds.length > 0 ? (
                            <p className="planning-item-copy">Target repos: {artifact.targetRepoIds.join(', ')}</p>
                          ) : null}
                          {artifact.repoRelativePath ? (
                            <p className="planning-item-copy">
                              Source: <code>{artifact.repoRelativePath}</code>
                            </p>
                          ) : null}
                          <div className="planning-actions">
                            <Button
                              onClick={() => {
                                void seedPlanFromArtifact(artifact);
                              }}
                              testId={`planning-intake-seed-${artifact.id}`}
                              variant="secondary"
                            >
                              Start plan
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="state-message">No typed intake artifacts found for the active repository.</p>
                  )}
                </div>
              ) : (
                <div className="planning-controls">
                  <p className="state-message">Select a repository in Catalog to resolve typed intake and Obsidian compatibility surfaces.</p>
                </div>
              )}
            </Panel>

            <Suspense fallback={<p className="state-message">Loading compatibility tools…</p>}>
              <ObsidianNotesPanel
                detailLoading={planningWorkspaceState.obsidianDetailLoading}
                error={planningWorkspaceState.obsidianError}
                loading={planningWorkspaceState.obsidianLoading}
                notes={planningWorkspaceState.obsidianNotes}
                onClearActiveSource={() => planningWorkspaceStore.setObsidianSourceSelection(null)}
                onCreateSource={(source) => planningWorkspaceStore.createObsidianSource(source)}
                onDeleteSource={(sourceId) => planningWorkspaceStore.deleteObsidianSource(sourceId)}
                onManualSync={() => {
                  void planningWorkspaceStore.syncObsidianNotes();
                }}
                onPromoteToBacklog={(note) => planningWorkspaceStore.promoteObsidianNoteToBacklog(note)}
                onPromoteToRoadmap={(note) => planningWorkspaceStore.promoteObsidianNoteToRoadmap(note)}
                onRefresh={() => {
                  void planningWorkspaceStore.loadObsidianNotes();
                }}
                onRefreshRepresentations={() => {
                  void planningWorkspaceStore.refreshObsidianRepresentationsInVault();
                }}
                onSeedPlan={(note) => {
                  void seedPlanFromArtifact({ id: note.id, title: note.title });
                }}
                onSelectNote={(noteId) => {
                  void planningWorkspaceStore.loadObsidianNote(noteId);
                }}
                onSetActiveSource={(sourceId) => planningWorkspaceStore.setObsidianSourceSelection(sourceId)}
                onUpdateSource={(sourceId, source) => planningWorkspaceStore.updateObsidianSource(sourceId, source)}
                promotionSaving={planningWorkspaceState.obsidianPromotionSaving}
                repoContextLabel={selectedCatalogRepo?.repoLabel || selectedCatalogRepo?.repoId || 'No Catalog repo selected'}
                repoContextSelected={Boolean(selectedCatalogRepo?.repoPath)}
                representations={planningWorkspaceState.obsidianRepresentations}
                representationsLoading={planningWorkspaceState.obsidianRepresentationsLoading}
                representationsRefreshing={planningWorkspaceState.obsidianRepresentationsRefreshing}
                representationsStatus={planningWorkspaceState.obsidianRepresentationsStatus}
                selectedNote={planningWorkspaceState.selectedObsidianNote}
                selectedNoteId={planningWorkspaceState.selectedObsidianNoteId}
                selectedRoadmapTitle={selectedRoadmap?.title || ''}
                sourceDeletingId={planningWorkspaceState.obsidianSourceDeletingId}
                sourceSaving={planningWorkspaceState.obsidianSourceSaving}
                sourceSelectionSaving={planningWorkspaceState.obsidianSourceSelectionSaving}
                status={planningWorkspaceState.obsidianStatus}
                syncing={planningWorkspaceState.obsidianSyncing}
              />
            </Suspense>
          </div>

          <div className="planning-grid">
            <Panel
              subtitle="Legacy planning-record state stays available for operator/debug inspection but is not part of the primary Planning workflow."
              testId="planning-compatibility-records-panel"
              title="Legacy Planning Records"
            >
              <div className="planning-controls">
                {planningState.loading || planningState.listing ? <p className="planning-copy">Loading legacy planning records…</p> : null}
                {planningState.error ? (
                  <p className="planning-error" role="alert">
                    {planningState.error}
                  </p>
                ) : null}
                {planningState.records.length > 0 ? (
                  <>
                    <label className="form-input" htmlFor="planning-compatibility-record-select">
                      <span className="form-label">Selected record</span>
                      <select
                        data-testid="planning-compatibility-record-select"
                        id="planning-compatibility-record-select"
                        onChange={(event) => planningStore.setSelectedRecordId(event.target.value)}
                        value={selectedPlanningRecord?.recordId || ''}
                      >
                        {planningState.records.map((record) => (
                          <option key={record.recordId} value={record.recordId}>
                            {record.title || record.recordId}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedPlanningRecord ? (
                      <div className="planning-metric-card" data-testid="planning-compatibility-record-summary">
                        <p className="planning-metric-label">Legacy record</p>
                        <p className="planning-metric-value planning-metric-value-small">
                          {selectedPlanningRecord.title || selectedPlanningRecord.recordId}
                        </p>
                        <p className="planning-copy">
                          <code>{selectedPlanningRecord.recordId}</code>
                          {' | '}
                          scope={selectedPlanningRecord.scope}
                          {' | '}
                          state={selectedPlanningRecord.state}
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="state-message">No legacy planning records found.</p>
                )}
              </div>
            </Panel>

            <Panel
              subtitle="Record-scoped research notes remain available here for compatibility/operator workflows."
              testId="planning-compatibility-research-panel"
              title="Research Notes"
            >
              {selectedPlanningRecord ? (
                <Suspense fallback={<p className="state-message">Loading compatibility tools…</p>}>
                  <ResearchNotesPanel
                    deleting={planningState.artifactsDeleting}
                    error={planningState.artifactsError}
                    loading={planningState.artifactsLoading}
                    notes={planningState.researchNotes}
                    onDelete={(noteId) => planningStore.removeResearchNote(noteId)}
                    onRefresh={() => {
                      void planningStore.loadArtifacts(selectedPlanningRecord.recordId);
                    }}
                    onSave={(note) => planningStore.saveResearchNote(note)}
                    recordId={selectedPlanningRecord.recordId}
                    saving={planningState.artifactsSaving}
                  />
                </Suspense>
              ) : (
                <p className="state-message">Select a legacy planning record to review research notes.</p>
              )}
            </Panel>

            <Panel
              subtitle="Legacy planning-record diagrams remain read-only compatibility artifacts. Mermaid previews render only when a diagram is available."
              testId="planning-compatibility-diagrams-panel"
              title="Diagram Preview"
            >
              {selectedPlanningRecord ? (
                <div className="planning-controls">
                  {planningState.diagrams.length > 1 ? (
                    <label className="form-input" htmlFor="planning-compatibility-diagram-select">
                      <span className="form-label">Selected diagram</span>
                      <select
                        data-testid="planning-compatibility-diagram-select"
                        id="planning-compatibility-diagram-select"
                        onChange={(event) => planningStore.setSelectedDiagramId(event.target.value)}
                        value={selectedDiagram?.id || ''}
                      >
                        {planningState.diagrams.map((diagram) => (
                          <option key={diagram.id} value={diagram.id}>
                            {diagram.title || diagram.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {planningState.artifactsLoading ? <p className="planning-copy">Loading record artifacts…</p> : null}
                  {selectedDiagram ? (
                    <>
                      <p className="planning-copy">
                        {selectedDiagram.title}
                        {' · '}
                        <code>{selectedDiagram.format}</code>
                      </p>
                      {selectedDiagram.format === 'mermaid' ? (
                        <Suspense fallback={<p className="state-message">Loading diagram preview…</p>}>
                          <MermaidViewer diagram={selectedDiagram} />
                        </Suspense>
                      ) : (
                        <pre className="code-block">{selectedDiagram.content}</pre>
                      )}
                    </>
                  ) : (
                    <p className="state-message">No diagrams attached to the selected legacy planning record.</p>
                  )}
                </div>
              ) : (
                <p className="state-message">Select a legacy planning record to inspect diagrams.</p>
              )}
            </Panel>
          </div>
        </>
      ) : null}

      {planningWorkspaceState.error ? (
        <p className="planning-error" role="alert">
          {planningWorkspaceState.error}
        </p>
      ) : null}

      {activeMode === 'workflow' && activeSection === 'plans' ? (
        <div className="planning-grid">
          <PlanningPlanAuthoringPanel
            linkedPlanSession={planningState.linkedPlanSession}
            onOpenLinkedPlanSession={(sessionId) => {
              void sessionsStore.loadSessions().then(() => {
                sessionsStore.selectSession(sessionId);
                navigationStore.goToRuntime('sessions', { sessionsMode: 'local' });
              });
            }}
            onPlanContentChange={(value) => planningStore.setPlanContentDraft(value)}
            onPlanTitleChange={(value) => planningStore.setPlanTitleDraft(value)}
            onReloadPlan={() => {
              void planningStore.loadLinkedPlan();
            }}
            onSaveBlankPlan={() => {
              void planningStore.savePlanDraft({
                title: planningState.planTitleDraft,
                content: planningState.planContentDraft,
              });
            }}
            planContentDraft={planningState.planContentDraft}
            planError={planningState.planError}
            planLoading={planningState.planLoading}
            planSaving={planningState.planSaving}
            planTitleDraft={planningState.planTitleDraft}
            selectedCatalogRepoId={selectedCatalogRepo?.repoId || ''}
            selectedCatalogRepoLabel={selectedCatalogRepo?.repoLabel || ''}
          />
        </div>
      ) : null}

      {activeMode === 'workflow' && activeSection === 'bullets' ? (
        <div className="planning-grid">
          <PlanningIdeasPanel
            onBulletCreated={() => {
              void planningWorkspaceStore.loadBullets();
            }}
            onOpenCatalogAssets={() => navigationStore.goToCatalog('assets')}
            planningState={planningState}
            selectedCatalogRepoId={selectedCatalogRepo?.repoId || ''}
            selectedCatalogRepoLabel={selectedCatalogRepo?.repoLabel || ''}
          />

          <Panel
            subtitle="Repo-scoped bullets are stored in docs/planning/bullets.md and stay below backlog acceptance."
            testId="planning-bullets-surface-panel"
            title="Repo Bullets"
          >
            {selectedCatalogRepo ? (
              <div className="planning-controls">
                <PlanningPathActions
                  emptyMessage="No bullets file resolved for the active repository yet."
                  openLabel="Open bullet file"
                  path={planningWorkspaceState.planningBulletsFile?.filePath}
                  repoRelativePath={planningWorkspaceState.planningBulletsFile?.repoRelativePath}
                  testIdPrefix="planning-bullets-surface-file"
                />
                <p className="planning-copy">
                  Stable IDs: <code>{planningWorkspaceState.planningBulletsFile?.stableIdPattern || 'PB-###'}</code>
                </p>
                <p className="planning-copy">
                  States: {planningWorkspaceState.planningBulletsFile?.supportedStates.join(', ') || 'idea, research, pre-plan'}
                </p>
                {planningWorkspaceState.bulletsLoading ? <p className="planning-copy">Loading bullets…</p> : null}
                {planningWorkspaceState.bulletsError ? (
                  <p className="planning-error" role="alert">
                    {planningWorkspaceState.bulletsError}
                  </p>
                ) : null}
                {planningWorkspaceState.bullets.length > 0 ? (
                  <ul className="planning-record-list" data-testid="planning-bullets-list">
                    {planningWorkspaceState.bullets.map((bullet) => (
                      <li key={bullet.id}>
                        <p className="planning-item-title">{bullet.title}</p>
                        <p className="planning-item-copy">{bullet.summary || 'No summary yet.'}</p>
                        <div className="planning-chip-row">
                          <span className="planning-chip"><code>{bullet.id}</code></span>
                          <span className="planning-chip">state: {bullet.state}</span>
                          <span className="planning-chip">repo: {selectedCatalogRepo.repoLabel || bullet.repoId}</span>
                        </div>
                        {bullet.notes.length > 0 ? (
                          <p className="planning-item-copy">Notes: {bullet.notes.join(' · ')}</p>
                        ) : null}
                        {bullet.promotedPlanRefs.length > 0 ? (
                          <p className="planning-item-copy">Promoted to plans: {bullet.promotedPlanRefs.join(', ')}</p>
                        ) : null}
                        {bullet.promotedBacklogRefs.length > 0 ? (
                          <p className="planning-item-copy">Promoted to backlog: {bullet.promotedBacklogRefs.join(', ')}</p>
                        ) : null}
                        {bullet.promotedRoadmapRefs.length > 0 ? (
                          <p className="planning-item-copy">Promoted to roadmap: {bullet.promotedRoadmapRefs.join(', ')}</p>
                        ) : null}
                        <div className="planning-actions">
                          <Button
                            onClick={() => {
                              void seedPlanFromArtifact(bullet);
                            }}
                            testId={`planning-bullet-seed-${bullet.id}`}
                            variant="secondary"
                          >
                            Start plan
                          </Button>
                          <Button
                            onClick={() => {
                              void planningWorkspaceStore.promoteBulletToBacklog(bullet.id).then((backlogId) => {
                                if (backlogId) {
                                  setActiveSection('backlog');
                                }
                              });
                            }}
                            testId={`planning-bullet-promote-${bullet.id}`}
                          >
                            Suggest backlog item
                          </Button>
                          <Button
                            onClick={() => {
                              void planningWorkspaceStore.promoteBulletToRoadmap(bullet.id).then((result) => {
                                if (result?.roadmapItemId) {
                                  setActiveSection('roadmaps');
                                }
                              });
                            }}
                            testId={`planning-bullet-roadmap-${bullet.id}`}
                            variant="secondary"
                          >
                            Promote to roadmap
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="state-message">No bullets saved for the active repository yet.</p>
                )}
              </div>
            ) : (
              <div className="planning-controls">
                <p className="state-message">Select a repository in Catalog to resolve bullet, backlog, and roadmap surfaces.</p>
              </div>
            )}
          </Panel>
        </div>
      ) : null}

      {activeMode === 'workflow' && activeSection === 'backlog' ? (
        <div className="planning-grid">
          <Panel
            subtitle="docs/backlogs/*.md is the primary repo backlog family. docs/backlog.md remains a legacy compatibility surface."
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
                <PlanningPathActions
                  emptyMessage="No primary backlog surface resolved for the active repository yet."
                  openLabel="Open primary backlog directory"
                  path={backlogPrimarySurfacePath}
                  repoRelativePath={backlogPrimarySurfaceRepoRelativePath}
                  testIdPrefix="planning-backlog-surface-file"
                />
                <p className="planning-copy">
                  Primary family: <code>{backlogPrimaryFamilyRepoRelativePath}</code>
                </p>
                <p className="planning-copy">
                  Legacy compatibility: <code>{backlogLegacyRepoRelativePath}</code>
                </p>
                {backlogResolvedSources.length ? (
                  <p className="planning-copy">
                    Resolved backlog docs: <code>{backlogResolvedSources.join(', ')}</code>
                  </p>
                ) : null}
                <p className="planning-copy">
                  Stable IDs: <code>{planningWorkspaceState.repositoryBacklog?.stableIdPattern || 'RB-###'}</code>
                </p>
                <p className="planning-copy">
                  {planningWorkspaceState.backlogSummary?.description || 'Repo-scoped intake and queued work for the selected repo.'}
                </p>
                {planningWorkspaceState.backlogLoading ? <p className="planning-copy">Loading backlog…</p> : null}
                {planningWorkspaceState.backlogError ? (
                  <p className="planning-error" role="alert">
                    {planningWorkspaceState.backlogError}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="planning-controls">
                <p className="state-message">Select a repository in Catalog to resolve bullet, backlog, and roadmap surfaces.</p>
              </div>
            )}
          </Panel>

          <Panel
            subtitle="Browse accepted and proposed backlog items without mixing them with bullets or one-session plans."
            testId="planning-backlog-list"
            title="Backlog Items"
          >
            {planningWorkspaceState.backlogSummary?.items?.length ? (
              <ul className="planning-record-list">
                {planningWorkspaceState.backlogSummary.items.map((item) => (
                  <li key={item.id}>
                    <p className="planning-item-title">{item.title}</p>
                    <p className="planning-item-copy">
                      <code>{item.id}</code> | status={item.status}
                    </p>
                    {item.summary ? <p className="planning-item-copy">{item.summary}</p> : null}
                    {item.roadmapIds.length > 0 ? (
                      <p className="planning-item-copy">Roadmap links: {item.roadmapIds.join(', ')}</p>
                    ) : null}
                    {item.planRefs.length > 0 ? (
                      <p className="planning-item-copy">Plan refs: {item.planRefs.join(', ')}</p>
                    ) : null}
                    <div className="planning-actions">
                      <Button
                        onClick={() => {
                          void seedPlanFromArtifact(item);
                        }}
                        testId={`planning-backlog-seed-${item.id}`}
                      >
                        Start plan
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="state-message">No backlog items found for the active repository.</p>
            )}
          </Panel>
        </div>
      ) : null}

      {activeMode === 'workflow' && activeSection === 'roadmaps' ? (
        <div className="planning-grid">
          <Panel
            subtitle="Roadmaps come from docs/roadmaps in the selected repository."
            testId="planning-roadmap-surface-panel"
            title="Roadmap Surface"
          >
            <div className="planning-controls">
              <PlanningPathActions
                emptyMessage="No roadmap directory resolved for the active repository yet."
                openLabel="Open roadmap folder"
                path={planningWorkspaceState.roadmapDirectory?.directoryPath}
                repoRelativePath={planningWorkspaceState.roadmapDirectory?.repoRelativePath}
                testIdPrefix="planning-roadmap-surface-directory"
              />
              <p className="planning-copy">
                Stable IDs: <code>{planningWorkspaceState.roadmapDirectory?.stableIdPattern || 'RM-<roadmap-slug>-###'}</code>
              </p>
              <p className="planning-copy">
                Roadmaps sit above backlog and above one-session plans; use them for multi-plan outcome sequencing.
              </p>
              {planningWorkspaceState.roadmapsLoading ? <p className="planning-copy">Loading roadmaps…</p> : null}
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
                        {roadmap.repoRelativePath || roadmap.filePath}
                      </p>
                    </li>
                  ))}
              </ul>
            </div>
          </Panel>

          <Panel
            subtitle="Roadmap items roll up accepted backlog work into phased outcomes."
            testId="planning-roadmap-detail"
            title={selectedRoadmap?.title || 'Roadmap detail'}
          >
            {selectedRoadmap ? (
              <div className="planning-controls">
                {selectedRoadmap.overview ? <p className="planning-copy">{selectedRoadmap.overview}</p> : null}
                <PlanningPathActions
                  openLabel="Open roadmap file"
                  path={selectedRoadmap.filePath}
                  repoRelativePath={selectedRoadmap.repoRelativePath}
                  testIdPrefix="planning-roadmap-detail-file"
                />
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
                      <div className="planning-actions">
                        <Button
                          onClick={() => {
                            void seedPlanFromArtifact(item);
                          }}
                          testId={`planning-roadmap-seed-${item.id}`}
                          variant="secondary"
                        >
                          Start plan
                        </Button>
                      </div>
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
        </div>
      ) : null}
    </section>
  );
}
