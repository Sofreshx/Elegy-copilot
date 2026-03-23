import { useEffect, useMemo, useState } from 'react';
import { Button, Panel, Toolbar } from '../../components';
import type {
  PlanningIntakeArtifact,
  PlanningIntakeCategory,
  PlanningIntakeTrackerFilterValue,
  PlanningLinkedPlanSession,
  PlanningLinkedSdkSession,
  SdkHealthResponse,
} from '../../lib/types';
import { useStoreValue } from '../../lib/store';
import { sdkHealthStore } from '../../stores/sdkHealthStore';
import { navigationStore } from '../../stores/navigation';
import { stateOverviewStore } from '../State/stateOverviewStore';
import { catalogWorkspaceStore } from '../Assets/catalogWorkspaceStore';
import { sessionsStore } from '../Sessions/sessionsStore';
import { sdkSessionsStore, type SdkSessionsState } from '../Sessions/sdkSessionsStore';
import MermaidViewer from './MermaidViewer';
import PlanningIdeasPanel from './PlanningIdeasPanel';
import PlanningPathActions from './PlanningPathActions';
import { planningStore } from './planningStore';
import { planningWorkspaceStore } from './planningWorkspaceStore';
import ObsidianNotesPanel from './ObsidianNotesPanel';
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

type NormalizedCatalogRepoEntry = NonNullable<ReturnType<typeof normalizeCatalogRepoEntry>>;

type SeedablePlanningArtifact =
  | PlanningIntakeArtifact
  | {
    id: string;
    title: string;
    promotedPlanRefs?: string[];
    [key: string]: unknown;
  };

const INTAKE_FILTER_ALL: PlanningIntakeTrackerFilterValue = '__all__';
const INTAKE_FILTER_NONE: PlanningIntakeTrackerFilterValue = '__none__';

function humanizePlanningIntakeCategory(category: PlanningIntakeCategory): string {
  return category
    .split('-')
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function formatPlanningStateLabel(value: string | null | undefined): string {
  const normalized = (value || '').trim();
  if (!normalized || normalized === INTAKE_FILTER_NONE) {
    return 'Unassigned';
  }

  return normalized
    .split(/[-_\s]+/)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function summarizeCounts(entries: Array<[string, number]>, fallback: string): string {
  if (entries.length === 0) {
    return fallback;
  }

  return entries.map(([label, count]) => `${label} (${count})`).join(' · ');
}

function formatLinkedSdkTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

function summarizePlanningPersistence(health: unknown): {
  label: string;
  detail: string;
  hint: string;
} {
  const persistence = asRecord(asRecord(health).planningPersistence);
  const governance = asRecord(persistence.governance);
  const migrations = asRecord(persistence.migrations);
  const dependencyGate = asRecord(asRecord(health).planningDurabilityDependencyGate);
  const status = readString(persistence, 'status') || 'unknown';
  const configured = readBoolean(persistence, 'configured');
  const usable = readBoolean(persistence, 'usable');
  const lastError = readString(persistence, 'lastError');
  const governanceCode = readString(governance, 'code');
  const migrationApplied = readString(migrations, 'appliedAt');
  const gateReady = readBoolean(dependencyGate, 'ready');

  if (status === 'ready' && configured === true && usable === true) {
    return {
      label: 'Planning database ready',
      detail: [
        'Runtime auto-init completed and Planning persistence is usable.',
        migrationApplied ? `Migrations applied: ${migrationApplied}.` : '',
        gateReady === false ? 'Durability dependency gate still reports a warning.' : '',
      ].filter(Boolean).join(' '),
      hint: 'You can create or update session plans directly from Planning.',
    };
  }

  if (status === 'migration_error' || lastError) {
    return {
      label: 'Planning database needs attention',
      detail: lastError || 'Planning persistence reported a migration error.',
      hint: 'Open Home / Runtime → Diagnostics → Planning Database for raw runtime details before relying on persistent planning state.',
    };
  }

  if (configured === false || status === 'configured_no_client') {
    return {
      label: 'Planning database not configured',
      detail: governanceCode ? `Governance: ${governanceCode}.` : 'Runtime did not report a usable planning persistence client.',
      hint: 'Plan authoring still writes session plan artifacts, but runtime database-backed planning features are not fully ready.',
    };
  }

  if (status === 'drift_detected') {
    return {
      label: 'Planning database degraded',
      detail: 'Runtime detected planning persistence drift. Review diagnostics before depending on migrations or governance state.',
      hint: 'Use Diagnostics for the authoritative failure details.',
    };
  }

  return {
    label: 'Checking planning database…',
    detail: 'Planning is waiting for the shared runtime health view to confirm persistence readiness.',
    hint: 'This panel uses the same /api/health readiness model as Runtime diagnostics.',
  };
}

function PlanningPersistencePanel(props: {
  health: unknown;
  loading: boolean;
  error: string | null;
}) {
  const summary = summarizePlanningPersistence(props.health);

  return (
    <Panel
      subtitle="Uses the same runtime /api/health readiness model as Home / Runtime diagnostics."
      testId="planning-persistence-panel"
      title="Planning Runtime Status"
    >
      <div className="planning-controls">
        <p className="planning-copy">
          <strong>Status:</strong> {summary.label}
        </p>
        <p className="planning-copy">{summary.detail}</p>
        <p className="planning-copy">{summary.hint}</p>
        {props.loading ? <p className="planning-copy">Refreshing runtime health…</p> : null}
        {props.error ? (
          <p className="planning-error" role="alert">
            {props.error}
          </p>
        ) : null}
        <div className="planning-actions">
          <Button
            onClick={() => navigationStore.goToRuntime('diagnostics', { diagnosticsSectionId: 'database' })}
            testId="planning-open-database-diagnostics"
            variant="secondary"
          >
            Open Planning Database diagnostics
          </Button>
          <Button
            onClick={() => {
              void stateOverviewStore.refresh();
            }}
            testId="planning-refresh-runtime-status"
            variant="ghost"
          >
            Refresh runtime status
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function PlanningPlanAuthoringPanel(props: {
  linkedPlanSession: PlanningLinkedPlanSession | null;
  selectedCatalogRepoId: string;
  selectedCatalogRepoLabel: string;
  intakeArtifacts: PlanningIntakeArtifact[];
  planTitleDraft: string;
  planContentDraft: string;
  planLoading: boolean;
  planSaving: boolean;
  planError: string | null;
  onPlanTitleChange: (value: string) => void;
  onPlanContentChange: (value: string) => void;
  onSaveBlankPlan: () => void;
  onSeedPlan: (artifactId: string) => void;
  onReloadPlan: () => void;
  onOpenLinkedPlanSession: (sessionId: string) => void;
}) {
  const [seedArtifactId, setSeedArtifactId] = useState('');
  const seedableArtifacts = props.intakeArtifacts;
  const selectedSeedArtifact = seedableArtifacts.find((artifact) => artifact.id === seedArtifactId) ?? null;

  return (
    <Panel
      subtitle="Create or reopen a session plan.md directly from Planning, then optionally jump to Home / Runtime → Sessions for the linked local session."
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
        {props.linkedPlanSession?.seedArtifactId ? (
          <p className="planning-copy">
            Seeded from <code>{props.linkedPlanSession.seedArtifactId}</code>
            {props.linkedPlanSession.seedArtifactTitle ? ` — ${props.linkedPlanSession.seedArtifactTitle}` : ''}.
          </p>
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
        <label className="form-input" htmlFor="planning-plan-seed">
          <span className="form-label">Seed from intake/request artifact</span>
          <select
            data-testid="planning-plan-seed"
            id="planning-plan-seed"
            onChange={(event) => setSeedArtifactId(event.target.value)}
            value={seedArtifactId}
          >
            <option value="">(optional) Start from a blank plan</option>
            {seedableArtifacts.map((artifact) => (
              <option key={artifact.id} value={artifact.id}>
                {artifact.id} · {humanizePlanningIntakeCategory(artifact.category)} · {artifact.title}
              </option>
            ))}
          </select>
        </label>
        {selectedSeedArtifact ? (
          <p className="planning-copy" data-testid="planning-plan-seed-summary">
            Seed summary: {selectedSeedArtifact.summary}
          </p>
        ) : null}
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
            onClick={() => {
              if (selectedSeedArtifact) {
                props.onSeedPlan(selectedSeedArtifact.id);
                return;
              }
              props.onSaveBlankPlan();
            }}
            testId="planning-save-plan"
          >
            {props.linkedPlanSession ? 'Save plan' : 'Create plan'}
          </Button>
          <Button
            disabled={!selectedSeedArtifact || props.planSaving}
            onClick={() => {
              if (selectedSeedArtifact) {
                props.onSeedPlan(selectedSeedArtifact.id);
              }
            }}
            testId="planning-seed-plan"
            variant="secondary"
          >
            Seed from artifact
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

function summarizeLinkedSdkStatus(
  linkedSdkSession: PlanningLinkedSdkSession | null,
  sdkHealth: SdkHealthResponse | null,
  sdkHealthLoading: boolean,
  sdkSessionsState: SdkSessionsState
): {
  label: string;
  detail: string;
} {
  if (!linkedSdkSession) {
    return {
      label: 'Optional helper lane',
      detail: 'Compile selected Planning ideas when you want SDK assistance; backlog and intake artifacts remain canonical.',
    };
  }

  if (sdkHealthLoading && !sdkHealth) {
    return {
      label: 'Checking SDK lane…',
      detail: `Planning restored link ${linkedSdkSession.sessionId} and is checking current SDK bridge availability.`,
    };
  }

  if (sdkHealth?.connected === false) {
    return {
      label: 'SDK disconnected',
      detail: sdkHealth.reason || sdkHealth.error || sdkHealth.state || 'The SDK bridge is not currently connected.',
    };
  }

  const visibleSession = sdkSessionsState.sessions.find((session) => session.sessionId === linkedSdkSession.sessionId);
  if (visibleSession) {
    return {
      label: 'Linked session visible',
      detail: `Session ${linkedSdkSession.sessionId} is available in the SDK lane${visibleSession.model ? ` (${visibleSession.model})` : ''}.`,
    };
  }

  if (sdkSessionsState.loading) {
    return {
      label: 'Refreshing session visibility…',
      detail: `Planning is refreshing SDK sessions for linked session ${linkedSdkSession.sessionId}.`,
    };
  }

  return {
    label: 'Linked metadata restored',
    detail: `Planning kept the repo-scoped SDK link for ${linkedSdkSession.sessionId}, even if the live SDK session list has not confirmed it yet.`,
  };
}

function PlanningSdkLanePanel(props: {
  linkedSdkSession: PlanningLinkedSdkSession | null;
  selectedCatalogRepoId: string;
  sdkHealthLoading: boolean;
  sdkHealth: SdkHealthResponse | null;
  sdkSessionsState: SdkSessionsState;
  onOpenLinkedSession?: (sessionId: string) => void;
}) {
  const {
    linkedSdkSession,
    selectedCatalogRepoId,
    sdkHealthLoading,
    sdkHealth,
    sdkSessionsState,
    onOpenLinkedSession,
  } = props;

  const visibleSession = linkedSdkSession
    ? sdkSessionsState.sessions.find((session) => session.sessionId === linkedSdkSession.sessionId) ?? null
    : null;
  const statusSummary = summarizeLinkedSdkStatus(linkedSdkSession, sdkHealth, sdkHealthLoading, sdkSessionsState);

  return (
    <Panel
      subtitle="Planning keeps SDK help optional and visible. This lane tracks Planning-originated compile work without making SDK the authority for intake, backlog, or roadmap artifacts."
      testId="planning-sdk-lane-panel"
      title="Planning ↔ SDK Lane"
    >
      <div className="planning-controls">
        <p className="planning-copy">
          <strong>Status:</strong> {statusSummary.label}
        </p>
        <p className="planning-copy">{statusSummary.detail}</p>

        {linkedSdkSession ? (
          <>
            <div className="planning-field-grid">
              <div className="form-input">
                <span className="form-label">Linked session</span>
                <p className="planning-copy" data-testid="planning-sdk-linked-session-id">
                  <code>{linkedSdkSession.sessionId}</code>
                </p>
              </div>
              <div className="form-input">
                <span className="form-label">Repo scope</span>
                <p className="planning-copy">
                  <code>{linkedSdkSession.repoId || selectedCatalogRepoId || '(workspace)'}</code>
                </p>
              </div>
              <div className="form-input">
                <span className="form-label">Created</span>
                <p className="planning-copy">{formatLinkedSdkTimestamp(linkedSdkSession.createdAt)}</p>
              </div>
              <div className="form-input">
                <span className="form-label">Live stream</span>
                <p className="planning-copy">
                  {visibleSession ? sdkSessionsState.streamStatus : 'not attached from Planning'}
                </p>
              </div>
            </div>

            <p className="planning-copy">
              From Planning compile: {linkedSdkSession.selectedIdeaTitles.length > 0
                ? linkedSdkSession.selectedIdeaTitles.join(' · ')
                : `${linkedSdkSession.selectedIdeaIds.length} selected draft idea(s)`}
            </p>
            <p className="planning-copy">
              Target repos:{' '}
              {linkedSdkSession.targetRepoIds.length > 0 ? (
                <code>{linkedSdkSession.targetRepoIds.join(', ')}</code>
              ) : (
                <span>determine from Planning context</span>
              )}
            </p>
            {linkedSdkSession.promptPreview ? (
              <p className="planning-copy">
                Prompt preview: <code>{linkedSdkSession.promptPreview}</code>
              </p>
            ) : null}
            {visibleSession?.cwd ? (
              <p className="planning-copy">
                SDK cwd: <code>{visibleSession.cwd}</code>
              </p>
            ) : null}
            <div className="planning-actions">
              <Button
                onClick={() => {
                  onOpenLinkedSession?.(linkedSdkSession.sessionId);
                }}
                testId="planning-sdk-open-linked-session"
                variant="secondary"
              >
                Open linked SDK session
              </Button>
              <Button
                onClick={() => {
                  void sdkHealthStore.refresh();
                  void sdkSessionsStore.loadSessions({
                    attachStream: false,
                    preserveSelection: true,
                    selectSessionId: linkedSdkSession.sessionId,
                  });
                }}
                testId="planning-sdk-refresh-link"
                variant="ghost"
              >
                Refresh SDK lane status
              </Button>
            </div>
          </>
        ) : (
          <p className="planning-copy">
            No Planning-originated SDK session is linked for the current repo context yet. Use <strong>Compile Selected</strong> when you want a plan draft in SDK, then return here to reopen it.
          </p>
        )}
      </div>
    </Panel>
  );
}

export default function PlanningView({ onSdkSessionReady }: { onSdkSessionReady?: (sessionId: string) => void }) {
  type PlanningSection = 'plans' | 'bullets' | 'backlog' | 'roadmaps';

  const planningState = useStoreValue(planningStore);
  const planningWorkspaceState = useStoreValue(planningWorkspaceStore);
  const catalogState = useStoreValue(catalogWorkspaceStore);
  const sdkHealthState = useStoreValue(sdkHealthStore);
  const sdkSessionsState = useStoreValue(sdkSessionsStore);
  const overviewState = useStoreValue(stateOverviewStore);
  const [activeSection, setActiveSection] = useState<PlanningSection>('plans');
  const [showLegacyArtifacts, setShowLegacyArtifacts] = useState(false);

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
  const selectedLegacyRecord =
    planningState.records.find((record) => record.recordId === planningState.selectedRecordId)
    ?? planningState.records[0]
    ?? null;
  const selectedLegacyDiagram =
    planningState.diagrams.find((diagram) => diagram.id === planningState.selectedDiagramId)
    ?? planningState.diagrams[0]
    ?? null;

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
        planningWorkspaceStore.loadIntakeArtifacts(),
        planningWorkspaceStore.loadBacklog(),
        planningWorkspaceStore.loadRoadmaps(),
        planningWorkspaceStore.loadObsidianNotes(),
        planningWorkspaceStore.loadObsidianRepresentations(),
      ]);
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

  useEffect(() => {
    sdkHealthStore.startPolling();
    return () => {
      sdkHealthStore.stopPolling();
    };
  }, []);

  useEffect(() => {
    stateOverviewStore.startPolling();
    return () => {
      stateOverviewStore.stopPolling();
    };
  }, []);

  useEffect(() => {
    if (!planningState.linkedSdkSession?.sessionId) {
      return;
    }

    void sdkSessionsStore.loadSessions({
      attachStream: false,
      preserveSelection: true,
      selectSessionId: planningState.linkedSdkSession.sessionId,
    });
  }, [planningState.linkedSdkSession?.sessionId]);

  useEffect(() => {
    if (!planningState.linkedPlanSession?.sessionId) {
      return;
    }

    if (planningState.planContentDraft.trim()) {
      return;
    }

    void planningStore.loadLinkedPlan();
  }, [planningState.linkedPlanSession?.sessionId]);

  const supportedCategories = useMemo(() => {
    const knownCategories = new Set<PlanningIntakeCategory>(
      planningWorkspaceState.planningIntakeDirectory?.supportedCategories
      ?? planningWorkspaceState.intakeSummary?.supportedCategories
      ?? []
    );

    planningWorkspaceState.intakeArtifacts.forEach((artifact) => {
      knownCategories.add(artifact.category);
    });

    return Array.from(knownCategories);
  }, [
    planningWorkspaceState.planningIntakeDirectory?.supportedCategories?.join('|'),
    planningWorkspaceState.intakeSummary?.supportedCategories?.join('|'),
    planningWorkspaceState.intakeArtifacts,
  ]);

  const intakeCategoryCounts = useMemo(() => {
    return supportedCategories
      .map((category) => [
        humanizePlanningIntakeCategory(category),
        planningWorkspaceState.intakeArtifacts.filter((artifact) => artifact.category === category).length,
      ] as [string, number])
      .filter(([, count]) => count > 0);
  }, [planningWorkspaceState.intakeArtifacts, supportedCategories]);

  const intakeStateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    planningWorkspaceState.intakeArtifacts.forEach((artifact) => {
      const key = artifact.planningState?.trim() || INTAKE_FILTER_NONE;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [planningWorkspaceState.intakeArtifacts]);

  const intakeTargetCounts = useMemo(() => {
    const counts = new Map<string, number>();
    planningWorkspaceState.intakeArtifacts.forEach((artifact) => {
      if (artifact.targetRepoIds.length === 0) {
        counts.set(INTAKE_FILTER_NONE, (counts.get(INTAKE_FILTER_NONE) || 0) + 1);
        return;
      }

      artifact.targetRepoIds.forEach((targetRepoId) => {
        counts.set(targetRepoId, (counts.get(targetRepoId) || 0) + 1);
      });
    });
    return Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [planningWorkspaceState.intakeArtifacts]);

  const filteredIntakeArtifacts = useMemo(() => {
    return planningWorkspaceState.intakeArtifacts.filter((artifact) => {
      if (
        planningWorkspaceState.intakeFilters.category !== INTAKE_FILTER_ALL
        && artifact.category !== planningWorkspaceState.intakeFilters.category
      ) {
        return false;
      }

      if (planningWorkspaceState.intakeFilters.planningState !== INTAKE_FILTER_ALL) {
        const artifactPlanningState = artifact.planningState?.trim() || INTAKE_FILTER_NONE;
        if (artifactPlanningState !== planningWorkspaceState.intakeFilters.planningState) {
          return false;
        }
      }

      if (planningWorkspaceState.intakeFilters.targetRepoId !== INTAKE_FILTER_ALL) {
        if (planningWorkspaceState.intakeFilters.targetRepoId === INTAKE_FILTER_NONE) {
          return artifact.targetRepoIds.length === 0;
        }

        return artifact.targetRepoIds.includes(planningWorkspaceState.intakeFilters.targetRepoId);
      }

      return true;
    });
  }, [planningWorkspaceState.intakeArtifacts, planningWorkspaceState.intakeFilters]);

  const groupedIntakeArtifacts = useMemo(() => {
    const groups = new Map<PlanningIntakeCategory, PlanningIntakeArtifact[]>();
    filteredIntakeArtifacts.forEach((artifact) => {
      const existing = groups.get(artifact.category);
      if (existing) {
        existing.push(artifact);
      } else {
        groups.set(artifact.category, [artifact]);
      }
    });
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [filteredIntakeArtifacts]);

  const hasActiveIntakeFilters =
    planningWorkspaceState.intakeFilters.category !== INTAKE_FILTER_ALL
    || planningWorkspaceState.intakeFilters.planningState !== INTAKE_FILTER_ALL
    || planningWorkspaceState.intakeFilters.targetRepoId !== INTAKE_FILTER_ALL;
  const planningCounts = useMemo(() => ({
    bullets: planningWorkspaceState.bullets.length,
    intake: planningWorkspaceState.intakeArtifacts.length,
    backlog: planningWorkspaceState.backlogSummary?.items?.length ?? 0,
    roadmaps: planningWorkspaceState.roadmaps.length,
  }), [
    planningWorkspaceState.bullets,
    planningWorkspaceState.intakeArtifacts,
    planningWorkspaceState.backlogSummary?.items,
    planningWorkspaceState.roadmaps,
  ]);

  const sectionCopy: Record<PlanningSection, { title: string; body: string }> = {
    plans: {
      title: 'Plans',
      body: 'Author or reopen one-session plan.md artifacts, while the Planning Obsidian panel surfaces both external notes and deterministic non-canonical mirrors of canonical bullets and roadmaps for the selected repo.',
    },
    bullets: {
      title: 'Bullets',
      body: 'Capture repo-scoped bullet seeds in docs/planning/bullets.md and keep typed request intake visible without mixing it into backlog or roadmap authority.',
    },
    backlog: {
      title: 'Backlog',
      body: 'Browse docs/backlog.md as the canonical queued-work surface and start plans from accepted backlog slices.',
    },
    roadmaps: {
      title: 'Roadmaps',
      body: 'Explore docs/roadmaps/*.md as the multi-plan outcome layer above backlog and individual session plans.',
    },
  };

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
      setActiveSection('plans');
    }
  };

  const refreshPlanningContext = () => {
    const work: Array<Promise<unknown>> = [stateOverviewStore.refresh()];

    if (selectedCatalogRepo?.repoPath) {
      work.push(
        planningWorkspaceStore.loadBullets(),
        planningWorkspaceStore.loadIntakeArtifacts(),
        planningWorkspaceStore.loadBacklog(),
        planningWorkspaceStore.loadRoadmaps(),
        planningWorkspaceStore.loadObsidianNotes(),
        planningWorkspaceStore.loadObsidianRepresentations(),
      );
    }

    if (planningState.linkedSdkSession?.sessionId) {
      work.push(
        sdkHealthStore.refresh(),
        sdkSessionsStore.loadSessions({
          attachStream: false,
          preserveSelection: true,
          selectSessionId: planningState.linkedSdkSession.sessionId,
        }),
      );
    }

    if (showLegacyArtifacts) {
      work.push(planningStore.loadInitial());
      if (selectedLegacyRecord?.recordId) {
        work.push(planningStore.loadArtifacts(selectedLegacyRecord.recordId));
      }
    }

    void Promise.allSettled(work);
  };

  return (
    <section className="planning-view" data-testid="planning-view">
      <Toolbar testId="planning-view-toolbar">
        <div className="workspace-nav-summary">
          <p className="workspace-nav-title">Planning</p>
          <p className="workspace-nav-copy">{sectionCopy[activeSection].body}</p>
        </div>

        <div className="planning-toolbar-actions">
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
          <p className="planning-metric-label">Typed intake</p>
          <p className="planning-metric-value">{planningCounts.intake}</p>
          <p className="planning-copy">Structured requests in <code>docs/planning/intake/*.json</code>.</p>
        </div>
        <div className="planning-metric-card">
          <p className="planning-metric-label">Backlog items</p>
          <p className="planning-metric-value">{planningCounts.backlog}</p>
          <p className="planning-copy">Accepted or queued repo work in <code>docs/backlog.md</code>.</p>
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

      {planningWorkspaceState.error ? (
        <p className="planning-error" role="alert">
          {planningWorkspaceState.error}
        </p>
      ) : null}

      {activeSection === 'plans' ? (
        <div className="planning-grid">
          <PlanningPlanAuthoringPanel
            intakeArtifacts={planningWorkspaceState.intakeArtifacts}
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
            onSeedPlan={(artifactId) => {
              const artifact = planningWorkspaceState.intakeArtifacts.find((entry) => entry.id === artifactId) ?? null;
              if (!artifact) {
                return;
              }

              void planningStore.savePlanDraft({
                title: planningState.planTitleDraft || artifact.title,
                seedArtifact: artifact,
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

          <ObsidianNotesPanel
            detailLoading={planningWorkspaceState.obsidianDetailLoading}
            error={planningWorkspaceState.obsidianError}
            loading={planningWorkspaceState.obsidianLoading}
            notes={planningWorkspaceState.obsidianNotes}
            representations={planningWorkspaceState.obsidianRepresentations}
            representationsLoading={planningWorkspaceState.obsidianRepresentationsLoading}
            representationsRefreshing={planningWorkspaceState.obsidianRepresentationsRefreshing}
            representationsStatus={planningWorkspaceState.obsidianRepresentationsStatus}
            onManualSync={() => {
              void planningWorkspaceStore.syncObsidianNotes();
            }}
            onRefreshRepresentations={() => {
              void planningWorkspaceStore.refreshObsidianRepresentationsInVault();
            }}
            onRefresh={() => {
              void Promise.allSettled([
                planningWorkspaceStore.loadObsidianNotes(),
                planningWorkspaceStore.loadObsidianRepresentations(),
              ]);
            }}
            onSeedPlan={(note) => {
              void seedPlanFromArtifact(note);
            }}
            onSelectNote={(noteId) => {
              void planningWorkspaceStore.loadObsidianNote(noteId);
            }}
            selectedNote={planningWorkspaceState.selectedObsidianNote}
            selectedNoteId={planningWorkspaceState.selectedObsidianNoteId}
            status={planningWorkspaceState.obsidianStatus}
            syncing={planningWorkspaceState.obsidianSyncing}
          />

          <PlanningPersistencePanel
            error={overviewState.error}
            health={overviewState.health}
            loading={overviewState.loading}
          />

          <PlanningSdkLanePanel
            linkedSdkSession={planningState.linkedSdkSession}
            onOpenLinkedSession={(sessionId) => {
              void sdkSessionsStore.loadSessions({ selectSessionId: sessionId }).then(() => {
                sdkSessionsStore.selectSession(sessionId);
                onSdkSessionReady?.(sessionId);
              });
            }}
            sdkHealth={sdkHealthState.health}
            sdkHealthLoading={sdkHealthState.loading}
            sdkSessionsState={sdkSessionsState}
            selectedCatalogRepoId={selectedCatalogRepo?.repoId || ''}
          />

          <Panel
            subtitle="Legacy planning-record artifacts are no longer part of the primary Planning path, but can still be opened for operator/debug compatibility."
            testId="planning-legacy-operator-panel"
            title="Operator Compatibility"
          >
            <div className="planning-controls">
              <div className="planning-actions">
                <Button
                  onClick={() => setShowLegacyArtifacts((value) => !value)}
                  testId="planning-show-legacy-artifacts"
                  variant="secondary"
                >
                  {showLegacyArtifacts ? 'Hide compatibility artifacts' : 'Show compatibility artifacts'}
                </Button>
              </div>
            </div>
          </Panel>

          {showLegacyArtifacts ? (
            <Panel
              subtitle="Historical planning records and record-scoped artifacts remain available as compatibility-only context."
              testId="planning-legacy-artifacts-panel"
              title="Legacy Planning Artifacts"
            >
              <div className="planning-controls">
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
      ) : null}

      {activeSection === 'bullets' ? (
        <div className="planning-grid">
          <PlanningIdeasPanel
            onBulletCreated={() => {
              void planningWorkspaceStore.loadBullets();
            }}
            onIntakeArtifactCreated={() => {
              void planningWorkspaceStore.loadIntakeArtifacts();
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
                <p className="state-message">Select a repository in Catalog to resolve bullet, intake, backlog, and roadmap surfaces.</p>
              </div>
            )}
          </Panel>

          <Panel
            subtitle="Typed intake artifacts remain the canonical structured request surface for audits, roadmap requests, review prep, and commit prep."
            testId="planning-intake-surface-panel"
            title="Typed Planning Intake"
          >
            {selectedCatalogRepo ? (
              <div className="planning-controls">
                <PlanningPathActions
                  emptyMessage="No intake directory resolved for the active repository yet."
                  openLabel="Open intake folder"
                  path={planningWorkspaceState.planningIntakeDirectory?.directoryPath}
                  repoRelativePath={planningWorkspaceState.planningIntakeDirectory?.repoRelativePath}
                  testIdPrefix="planning-intake-surface-directory"
                />
                <p className="planning-copy">
                  Stable IDs: <code>{planningWorkspaceState.planningIntakeDirectory?.stableIdPattern || 'PI-###'}</code>
                </p>
                <p className="planning-copy">
                  Categories:{' '}
                  {planningWorkspaceState.planningIntakeDirectory?.supportedCategories.join(', ')
                    || 'idea, research, refactor-candidate, design-complaint, audit-request, roadmap-request, review-prep, commit-prep'}
                </p>
                {planningWorkspaceState.intakeLoading ? <p className="planning-copy">Loading intake artifacts…</p> : null}
                {planningWorkspaceState.intakeError ? (
                  <p className="planning-error" role="alert">
                    {planningWorkspaceState.intakeError}
                  </p>
                ) : null}
                {planningWorkspaceState.intakeArtifacts.length > 0 ? (
                  <div className="planning-intake-stack">
                    <div className="planning-metric-grid" data-testid="planning-intake-summary-grid">
                      <div className="planning-metric-card">
                        <p className="planning-metric-label">Visible intake artifacts</p>
                        <p className="planning-metric-value">
                          {filteredIntakeArtifacts.length}
                          <span className="planning-metric-value planning-metric-value-small">
                            {' '}
                            / {planningWorkspaceState.intakeArtifacts.length}
                          </span>
                        </p>
                      </div>
                      <div className="planning-metric-card">
                        <p className="planning-metric-label">Categories</p>
                        <p className="planning-metric-value planning-metric-value-small">
                          {summarizeCounts(intakeCategoryCounts, 'No categorized intake artifacts yet.')}
                        </p>
                      </div>
                      <div className="planning-metric-card">
                        <p className="planning-metric-label">States</p>
                        <p className="planning-metric-value planning-metric-value-small">
                          {summarizeCounts(
                            intakeStateCounts.map(([state, count]) => [formatPlanningStateLabel(state), count]),
                            'No planning states assigned yet.'
                          )}
                        </p>
                      </div>
                      <div className="planning-metric-card">
                        <p className="planning-metric-label">Targets</p>
                        <p className="planning-metric-value planning-metric-value-small">
                          {summarizeCounts(
                            intakeTargetCounts.map(([targetRepoId, count]) => [
                              targetRepoId === INTAKE_FILTER_NONE ? 'Unscoped' : targetRepoId,
                              count,
                            ]),
                            'No target repositories assigned yet.'
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="planning-select-grid" data-testid="planning-intake-filter-bar">
                      <label className="form-input" htmlFor="planning-intake-category-filter">
                        <span className="form-label">Category filter</span>
                        <select
                          data-testid="planning-intake-category-filter"
                          id="planning-intake-category-filter"
                          onChange={(event) => {
                            planningWorkspaceStore.setIntakeCategoryFilter(
                              event.target.value as PlanningIntakeCategory | typeof INTAKE_FILTER_ALL
                            );
                          }}
                          value={planningWorkspaceState.intakeFilters.category}
                        >
                          <option value={INTAKE_FILTER_ALL}>All categories</option>
                          {supportedCategories.map((category) => (
                            <option key={category} value={category}>
                              {humanizePlanningIntakeCategory(category)}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="form-input" htmlFor="planning-intake-state-filter">
                        <span className="form-label">State filter</span>
                        <select
                          data-testid="planning-intake-state-filter"
                          id="planning-intake-state-filter"
                          onChange={(event) => planningWorkspaceStore.setIntakePlanningStateFilter(event.target.value)}
                          value={planningWorkspaceState.intakeFilters.planningState}
                        >
                          <option value={INTAKE_FILTER_ALL}>All states</option>
                          {intakeStateCounts.map(([state]) => (
                            <option key={state} value={state}>
                              {formatPlanningStateLabel(state)}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="form-input" htmlFor="planning-intake-target-filter">
                        <span className="form-label">Target filter</span>
                        <select
                          data-testid="planning-intake-target-filter"
                          id="planning-intake-target-filter"
                          onChange={(event) => planningWorkspaceStore.setIntakeTargetFilter(event.target.value)}
                          value={planningWorkspaceState.intakeFilters.targetRepoId}
                        >
                          <option value={INTAKE_FILTER_ALL}>All targets</option>
                          {intakeTargetCounts.map(([targetRepoId]) => (
                            <option key={targetRepoId} value={targetRepoId}>
                              {targetRepoId === INTAKE_FILTER_NONE ? 'Unscoped' : targetRepoId}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {hasActiveIntakeFilters ? (
                      <div className="planning-toolbar-actions">
                        <p className="planning-copy">
                          Showing {filteredIntakeArtifacts.length} of {planningWorkspaceState.intakeArtifacts.length} intake artifacts.
                        </p>
                        <Button
                          onClick={() => planningWorkspaceStore.clearIntakeFilters()}
                          testId="planning-intake-clear-filters"
                          variant="secondary"
                        >
                          Clear intake filters
                        </Button>
                      </div>
                    ) : null}

                    {filteredIntakeArtifacts.length > 0 ? (
                      <div className="planning-intake-group-stack" data-testid="planning-intake-grouped-list">
                        {groupedIntakeArtifacts.map(([category, artifacts]) => (
                          <section className="planning-intake-group" key={category}>
                            <div className="planning-intake-group-header">
                              <p className="planning-item-title">{humanizePlanningIntakeCategory(category)}</p>
                              <p className="planning-item-copy">
                                {artifacts.length} artifact{artifacts.length === 1 ? '' : 's'}
                              </p>
                            </div>
                            <ul className="planning-record-list">
                              {artifacts.map((artifact) => (
                                <li key={artifact.id}>
                                  <div className="planning-intake-item">
                                    <p className="planning-item-title">{artifact.title}</p>
                                    <p className="planning-item-copy">{artifact.summary}</p>
                                    <div className="planning-chip-row">
                                      <span className="planning-chip"><code>{artifact.id}</code></span>
                                      <span className="planning-chip">state: {formatPlanningStateLabel(artifact.planningState)}</span>
                                      <span className="planning-chip">
                                        targets: {artifact.targetRepoIds.length > 0 ? artifact.targetRepoIds.join(', ') : 'Unscoped'}
                                      </span>
                                    </div>
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
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </section>
                        ))}
                      </div>
                    ) : (
                      <p className="state-message">No intake artifacts match the active filters.</p>
                    )}
                  </div>
                ) : (
                  <p className="state-message">No planning intake artifacts saved for the active repository.</p>
                )}
              </div>
            ) : (
              <div className="planning-controls">
                <p className="state-message">Select a repository in Catalog to resolve bullet, intake, backlog, and roadmap surfaces.</p>
              </div>
            )}
          </Panel>
        </div>
      ) : null}

      {activeSection === 'backlog' ? (
        <div className="planning-grid">
          <Panel
            subtitle="docs/backlog.md remains the canonical repo backlog authority."
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
                  emptyMessage="No backlog file resolved for the active repository yet."
                  openLabel="Open backlog file"
                  path={planningWorkspaceState.repositoryBacklog?.filePath}
                  repoRelativePath={planningWorkspaceState.repositoryBacklog?.repoRelativePath}
                  testIdPrefix="planning-backlog-surface-file"
                />
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
                <p className="state-message">Select a repository in Catalog to resolve bullet, intake, backlog, and roadmap surfaces.</p>
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

      {activeSection === 'roadmaps' ? (
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
