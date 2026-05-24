import { useEffect, useMemo, useState } from 'react';
import { Button, Panel, Toolbar } from '../../components';
import {
  ApiError,
  getGatewayState,
  getPlanningLiveGoal,
  getPlanningLivePlan,
  getPlanningLiveRoadmap,
  getPlanningTaskBoard,
  getSessionContinuationPackage,
  listPlanningLivePlans,
  listPlanningLiveRoadmaps,
  listPlanningLiveTodos,
  listSessions,
} from '../../lib/api';
import { humanizeToken, resolveSessionStatus } from '../../lib/stateDiagnostics';
import { useStoreValue } from '../../lib/store';
import type {
  GatewayStateResponse,
  PlanningLiveGoal,
  PlanningLivePlanResponse,
  PlanningLivePlanSummary,
  PlanningLiveRoadmapResponse,
  PlanningLiveRoadmapSummary,
  PlanningLiveTodo,
  PlanningLiveWorkPoint,
  SessionOrchestrationProjection,
  SessionSummary,
} from '../../lib/types';
import { navigationStore } from '../../stores/navigation';
import { notificationStore } from '../../stores/notificationStore';
import TaskBoardView, { type TaskBoardGroupBy } from '../Sessions/TaskBoardView';
import { catalogWorkspaceStore } from '../Assets/catalogWorkspaceStore';
import { formatGatewaySegmentSummary } from '../../lib/stateDiagnostics';

type WorkspaceTab = 'roadmaps' | 'transfer';
type TransferTargetHarness = 'copilot' | 'codex' | 'opencode' | 'antigravity';
type ContinuationActionMode = 'copy' | 'download';

interface CatalogRepoChoice {
  repoId: string;
  repoPath: string;
  repoLabel: string;
  sources: string[];
}

const TRANSFER_TARGETS: ReadonlyArray<{ id: TransferTargetHarness; label: string }> = [
  { id: 'opencode', label: 'OpenCode' },
  { id: 'codex', label: 'Codex' },
  { id: 'copilot', label: 'Copilot' },
  { id: 'antigravity', label: 'Antigravity' },
];

function normalizeCatalogRepoEntry(repo: unknown): CatalogRepoChoice | null {
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
      }),
    )
    ?? null
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function getProjectionTasks(projection: SessionOrchestrationProjection | null): Array<Record<string, unknown>> {
  const taskBoard = asRecord(projection?.taskBoard);
  return Array.isArray(taskBoard.items)
    ? taskBoard.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    : [];
}

function buildPlanningTaskBoardSessionSummary(
  projection: SessionOrchestrationProjection | null,
  sessions: SessionSummary[],
) {
  const linkedSessionIds = Array.from(new Set(
    getProjectionTasks(projection)
      .map((task) => asString(task.ownerSessionId))
      .filter((sessionId): sessionId is string => Boolean(sessionId)),
  ));
  const linkedSessions = sessions.filter((session) => linkedSessionIds.includes(session.id));
  const liveSessions = linkedSessions.filter((session) => resolveSessionStatus(session) === 'active');

  if (liveSessions.length > 0) {
    return {
      title: 'Linked live sessions',
      status: 'active',
      detail: `${liveSessions.length} linked session(s) currently report live runtime evidence.`,
      helper: liveSessions.map((session) => session.id).join(' | '),
    };
  }

  if (linkedSessionIds.length > 0) {
    return {
      title: 'Linked live sessions',
      status: 'unknown',
      detail: `${linkedSessionIds.length} linked session reference(s) exist, but none currently show confirmed live runtime status.`,
      helper: linkedSessionIds.join(' | '),
    };
  }

  return {
    title: 'Linked live sessions',
    status: 'idle',
    detail: 'No durable task in this repo is linked to a live session yet.',
    helper: 'Launch or resume runtime work from the sidebar when a durable task is ready.',
  };
}

function countStatuses(items: Array<{ status?: string | null }>): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = asString(item && item.status) || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function formatStatusSummary(counts: Record<string, number>, preferredOrder: string[] = []): string {
  const orderedKeys = [
    ...preferredOrder.filter((key) => Number.isFinite(counts[key]) && counts[key] > 0),
    ...Object.keys(counts).filter((key) => !preferredOrder.includes(key) && counts[key] > 0).sort(),
  ];

  if (orderedKeys.length === 0) {
    return 'No tracked items yet.';
  }

  return orderedKeys
    .map((key) => `${counts[key]} ${humanizeToken(key)}`)
    .join(' | ');
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return 'Unknown';
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  return new Date(timestamp).toLocaleString();
}

function resolveSessionRepoContext(session: SessionSummary) {
  const sessionRecord = asRecord(session);
  const orchestration = asRecord(sessionRecord.orchestration);
  const repo = asRecord(orchestration.repo);

  return {
    repoId: asString(sessionRecord.repoId) || asString(repo.repoId) || '',
    repoPath: asString(sessionRecord.repoPath) || asString(repo.repoPath) || '',
    repoLabel: asString(sessionRecord.repoLabel) || asString(repo.repoLabel) || '',
  };
}

function sessionMatchesCatalogRepo(session: SessionSummary, repo: CatalogRepoChoice | null): boolean {
  if (!repo || (!repo.repoId && !repo.repoPath)) {
    return true;
  }

  const sessionRepo = resolveSessionRepoContext(session);
  if (repo.repoId && sessionRepo.repoId && repo.repoId === sessionRepo.repoId) {
    return true;
  }

  if (repo.repoPath && sessionRepo.repoPath && repo.repoPath === sessionRepo.repoPath) {
    return true;
  }

  return false;
}

function resolveSessionTitle(session: SessionSummary): string {
  const sessionRecord = asRecord(session);
  const orchestration = asRecord(sessionRecord.orchestration);
  return asString(orchestration.objective) || asString(sessionRecord.objective) || session.id;
}

function buildContinuationActionKey(mode: ContinuationActionMode, targetHarness: TransferTargetHarness): string {
  return `${mode}:${targetHarness}`;
}

function sanitizeFilenameSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function buildContinuationFilename(sessionId: string, targetHarness: TransferTargetHarness): string {
  return `${sanitizeFilenameSegment(sessionId)}-${targetHarness}-continuation-package.json`;
}

function createDownload(blob: Blob, fileName: string): void {
  if (
    typeof window === 'undefined'
    || typeof document === 'undefined'
    || typeof window.URL?.createObjectURL !== 'function'
    || typeof window.URL?.revokeObjectURL !== 'function'
  ) {
    throw new Error('File downloads are unavailable in this environment.');
  }

  const objectUrl = window.URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    if (document.body) {
      document.body.appendChild(link);
    }
    link.click();
    link.remove();
  } finally {
    window.URL.revokeObjectURL(objectUrl);
  }
}

function buildCatalogRepoChoiceValue(repo: CatalogRepoChoice): string {
  if (repo.repoId) {
    return `id:${repo.repoId}`;
  }
  if (repo.repoPath) {
    return `path:${repo.repoPath}`;
  }
  return '';
}

function parseCatalogRepoChoiceValue(value: string): { repoId?: string; repoPath?: string } | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith('id:')) {
    return { repoId: normalized.slice(3) };
  }
  if (normalized.startsWith('path:')) {
    return { repoPath: normalized.slice(5) };
  }
  return { repoId: normalized };
}

function hasPlanningRepoScope(repo: { repoId?: string; repoPath?: string; repoLabel?: string } | null | undefined): boolean {
  return Boolean(repo?.repoId || repo?.repoPath || repo?.repoLabel);
}

function readApiErrorPayloadMessage(error: ApiError): string | null {
  const payload = asRecord(error.payload);
  const errorValue = payload.error;
  if (typeof errorValue === 'string' && errorValue.trim()) {
    return errorValue.trim();
  }

  const errorRecord = asRecord(errorValue);
  return asString(errorRecord.message) || asString(payload.detail);
}

function readApiErrorPayloadCode(error: ApiError): string | null {
  const payload = asRecord(error.payload);
  const errorRecord = asRecord(payload.error);
  return asString(errorRecord.reason)
    || asString(errorRecord.code)
    || asString(payload.reason)
    || asString(payload.code);
}

function buildPlanningViewErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const message = readApiErrorPayloadMessage(error) || toErrorMessage(error, fallback);
    const code = readApiErrorPayloadCode(error);
    if (!code || message.toLowerCase().includes(code.toLowerCase())) {
      return message;
    }
    return `${message} (${code})`;
  }

  return toErrorMessage(error, fallback);
}

function resolvePlanningAuthorityTone(
  planningAuthority: GatewayStateResponse['planningAuthority'],
  loading: boolean,
  fetchError: string | null,
): 'ready' | 'warning' | 'error' {
  if (loading) {
    return 'warning';
  }
  if (fetchError) {
    return 'error';
  }

  const record = asRecord(planningAuthority);
  if (record.ready === true) {
    return 'ready';
  }

  const errorRecord = asRecord(record.error);
  const code = asString(errorRecord.reason) || asString(errorRecord.code);
  if (code === 'bridge_disabled' || code === 'bridge_not_configured' || code === 'planning_live_authority_unknown') {
    return 'warning';
  }
  return code ? 'error' : 'warning';
}

export default function PlanningAuthorityView() {
  const catalogState = useStoreValue(catalogWorkspaceStore);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('roadmaps');
  const [gatewayState, setGatewayState] = useState<GatewayStateResponse | null>(null);
  const [planningAuthorityLoading, setPlanningAuthorityLoading] = useState(false);
  const [planningAuthorityError, setPlanningAuthorityError] = useState<string | null>(null);
  const [roadmaps, setRoadmaps] = useState<PlanningLiveRoadmapSummary[]>([]);
  const [repoTodos, setRepoTodos] = useState<PlanningLiveTodo[]>([]);
  const [roadmapsLoading, setRoadmapsLoading] = useState(false);
  const [roadmapsError, setRoadmapsError] = useState<string | null>(null);
  const [roadmapDetail, setRoadmapDetail] = useState<PlanningLiveRoadmapResponse | null>(null);
  const [roadmapPlans, setRoadmapPlans] = useState<PlanningLivePlanSummary[]>([]);
  const [roadmapTodos, setRoadmapTodos] = useState<PlanningLiveTodo[]>([]);
  const [goalDetail, setGoalDetail] = useState<PlanningLiveGoal | null>(null);
  const [roadmapDetailLoading, setRoadmapDetailLoading] = useState(false);
  const [roadmapDetailError, setRoadmapDetailError] = useState<string | null>(null);
  const [selectedRoadmapId, setSelectedRoadmapId] = useState<string | null>(null);
  const [selectedWorkPointId, setSelectedWorkPointId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedPlanDetail, setSelectedPlanDetail] = useState<PlanningLivePlanResponse | null>(null);
  const [selectedPlanLoading, setSelectedPlanLoading] = useState(false);
  const [selectedPlanError, setSelectedPlanError] = useState<string | null>(null);
  const [taskBoardProjection, setTaskBoardProjection] = useState<SessionOrchestrationProjection | null>(null);
  const [taskBoardLoading, setTaskBoardLoading] = useState(false);
  const [taskBoardError, setTaskBoardError] = useState<string | null>(null);
  const [taskBoardFilterStatus, setTaskBoardFilterStatus] = useState('all');
  const [taskBoardGroupBy, setTaskBoardGroupBy] = useState<TaskBoardGroupBy>('status');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [observedSessions, setObservedSessions] = useState<SessionSummary[]>([]);
  const [transferSessionsLoading, setTransferSessionsLoading] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [selectedTransferSessionId, setSelectedTransferSessionId] = useState<string | null>(null);
  const [transferTargetHarness, setTransferTargetHarness] = useState<TransferTargetHarness>('opencode');
  const [continuationActionKey, setContinuationActionKey] = useState<string | null>(null);
  const [planningRefreshToken, setPlanningRefreshToken] = useState(0);

  const selectedCatalogRepo = useMemo(() => resolveCatalogRepoContext(catalogState), [catalogState]);
  const knownCatalogRepos = useMemo(() => {
    const repos = Array.isArray(catalogState.repoInventory?.repos) ? catalogState.repoInventory.repos : [];
    return repos
      .map((repo) => normalizeCatalogRepoEntry(repo))
      .filter((repo): repo is CatalogRepoChoice => repo !== null && Boolean(repo.repoId || repo.repoPath));
  }, [catalogState.repoInventory?.repos]);
  const repoQuery = useMemo(() => ({
    repoId: selectedCatalogRepo?.repoId || undefined,
    repoPath: selectedCatalogRepo?.repoPath || undefined,
    repoLabel: selectedCatalogRepo?.repoLabel || undefined,
  }), [selectedCatalogRepo?.repoId, selectedCatalogRepo?.repoLabel, selectedCatalogRepo?.repoPath]);
  const selectedCatalogRepoValue = selectedCatalogRepo ? buildCatalogRepoChoiceValue(selectedCatalogRepo) : '';
  const repoScopeAvailable = hasPlanningRepoScope(repoQuery);
  const repoScopeKey = [repoQuery.repoId || '', repoQuery.repoPath || '', repoQuery.repoLabel || ''].join('|');

  useEffect(() => {
    if (catalogState.repoInventory || catalogState.repoInventoryLoading || catalogState.loading) {
      return;
    }

    void catalogWorkspaceStore.loadWorkspace();
  }, [catalogState.repoInventory, catalogState.repoInventoryLoading, catalogState.loading]);

  useEffect(() => {
    let cancelled = false;

    setPlanningAuthorityLoading(true);
    setPlanningAuthorityError(null);

    void getGatewayState()
      .then((response) => {
        if (cancelled) {
          return;
        }

        setGatewayState(response);
        setPlanningAuthorityError(null);
        setPlanningAuthorityLoading(false);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setGatewayState(null);
        setPlanningAuthorityError(buildPlanningViewErrorMessage(error, 'Unable to load planning authority state.'));
        setPlanningAuthorityLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [planningRefreshToken]);

  useEffect(() => {
    let cancelled = false;
    setTransferSessionsLoading(true);
    setTransferError(null);

    void listSessions(undefined, { source: 'all', dedupe: 'on' })
      .then((response) => {
        if (cancelled) {
          return;
        }

        setObservedSessions(Array.isArray(response.sessions) ? response.sessions : []);
        setTransferSessionsLoading(false);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setObservedSessions([]);
        setTransferSessionsLoading(false);
        setTransferError(toErrorMessage(error, 'Unable to load recent sessions for transfer.'));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSelectedRoadmapId(null);
    setSelectedPlanId(null);
    setSelectedWorkPointId(null);
    setRoadmapDetail(null);
    setGoalDetail(null);
    setRoadmapPlans([]);
    setRoadmapTodos([]);
    setSelectedPlanDetail(null);
    setSelectedPlanError(null);
  }, [repoScopeKey]);

  useEffect(() => {
    let cancelled = false;

    if (!repoScopeAvailable) {
      setRoadmaps([]);
      setRepoTodos([]);
      setRoadmapsError(null);
      setRoadmapsLoading(false);
      setTaskBoardProjection(null);
      setTaskBoardError(null);
      setTaskBoardLoading(false);
      setSelectedTaskId(null);
      return () => {
        cancelled = true;
      };
    }

    setRoadmapsLoading(true);
    setRoadmapsError(null);
    setTaskBoardLoading(true);
    setTaskBoardError(null);
    setSelectedTaskId(null);

    void Promise.allSettled([
      listPlanningLiveRoadmaps(repoQuery),
      listPlanningLiveTodos(repoQuery),
      repoQuery.repoId
        ? getPlanningTaskBoard({
            repoId: repoQuery.repoId,
            repoPath: repoQuery.repoPath,
            repoLabel: repoQuery.repoLabel,
          })
        : Promise.resolve(null),
    ])
      .then(([roadmapsResult, todosResult, taskBoardResult]) => {
        if (cancelled) {
          return;
        }

        if (roadmapsResult.status === 'fulfilled') {
          setRoadmaps(Array.isArray(roadmapsResult.value.roadmaps) ? roadmapsResult.value.roadmaps : []);
          setRoadmapsError(null);
        } else {
          setRoadmaps([]);
          setRoadmapsError(buildPlanningViewErrorMessage(roadmapsResult.reason, 'Unable to load live roadmaps.'));
        }

        setRepoTodos(
          todosResult.status === 'fulfilled' && Array.isArray(todosResult.value.todos)
            ? todosResult.value.todos
            : [],
        );

        if (!repoQuery.repoId) {
          setTaskBoardProjection(null);
          setTaskBoardError(null);
        } else if (taskBoardResult.status === 'fulfilled' && taskBoardResult.value) {
          setTaskBoardProjection(taskBoardResult.value.projection ?? null);
          setTaskBoardError(null);
        } else {
          setTaskBoardProjection(null);
          setTaskBoardError(
            taskBoardResult.status === 'fulfilled'
              ? null
              : buildPlanningViewErrorMessage(taskBoardResult.reason, 'Unable to load the durable task board.'),
          );
        }

        setRoadmapsLoading(false);
        setTaskBoardLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [planningRefreshToken, repoQuery.repoId, repoQuery.repoLabel, repoQuery.repoPath, repoScopeAvailable]);

  useEffect(() => {
    if (!selectedRoadmapId) {
      return;
    }
    if (roadmaps.some((roadmap) => roadmap.id === selectedRoadmapId)) {
      return;
    }

    setSelectedRoadmapId(null);
    setSelectedPlanId(null);
    setSelectedWorkPointId(null);
  }, [roadmaps, selectedRoadmapId]);

  useEffect(() => {
    let cancelled = false;

    if (!repoScopeAvailable || !selectedRoadmapId) {
      setRoadmapDetail(null);
      setGoalDetail(null);
      setRoadmapPlans([]);
      setRoadmapTodos([]);
      setRoadmapDetailError(null);
      setRoadmapDetailLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setRoadmapDetailLoading(true);
    setRoadmapDetailError(null);

    void getPlanningLiveRoadmap(selectedRoadmapId, repoQuery)
      .then(async (roadmapResponse) => {
        const goalId = roadmapResponse.roadmap?.goalId || '';
        const [goalResult, plansResult, todosResult] = await Promise.allSettled([
          goalId ? getPlanningLiveGoal(goalId, repoQuery) : Promise.resolve(null),
          listPlanningLivePlans({ ...repoQuery, roadmapId: selectedRoadmapId }),
          listPlanningLiveTodos({ ...repoQuery, roadmapId: selectedRoadmapId }),
        ]);

        if (cancelled) {
          return;
        }

        setRoadmapDetail(roadmapResponse);
        setGoalDetail(
          goalResult.status === 'fulfilled' && goalResult.value
            ? goalResult.value.goal
            : null,
        );
        setRoadmapPlans(
          plansResult.status === 'fulfilled' && Array.isArray(plansResult.value.plans)
            ? plansResult.value.plans
            : [],
        );
        setRoadmapTodos(
          todosResult.status === 'fulfilled' && Array.isArray(todosResult.value.todos)
            ? todosResult.value.todos
            : [],
        );
        setRoadmapDetailError(null);
        setRoadmapDetailLoading(false);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setRoadmapDetail(null);
        setGoalDetail(null);
        setRoadmapPlans([]);
        setRoadmapTodos([]);
        setRoadmapDetailError(buildPlanningViewErrorMessage(error, 'Unable to load live roadmap detail.'));
        setRoadmapDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [planningRefreshToken, repoScopeAvailable, repoQuery.repoId, repoQuery.repoLabel, repoQuery.repoPath, selectedRoadmapId]);

  useEffect(() => {
    let cancelled = false;

    if (!repoScopeAvailable || !selectedPlanId) {
      setSelectedPlanDetail(null);
      setSelectedPlanError(null);
      setSelectedPlanLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setSelectedPlanLoading(true);
    setSelectedPlanError(null);

    void getPlanningLivePlan(selectedPlanId, repoQuery)
      .then((response) => {
        if (cancelled) {
          return;
        }

        setSelectedPlanDetail(response);
        setSelectedPlanError(null);
        setSelectedPlanLoading(false);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setSelectedPlanDetail(null);
        setSelectedPlanError(buildPlanningViewErrorMessage(error, 'Unable to load live plan detail.'));
        setSelectedPlanLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [planningRefreshToken, repoScopeAvailable, repoQuery.repoId, repoQuery.repoLabel, repoQuery.repoPath, selectedPlanId]);

  const transferSessions = useMemo(
    () => observedSessions.filter((session) => sessionMatchesCatalogRepo(session, selectedCatalogRepo)),
    [observedSessions, selectedCatalogRepo],
  );

  useEffect(() => {
    if (transferSessions.length === 0) {
      setSelectedTransferSessionId(null);
      return;
    }

    if (!selectedTransferSessionId || !transferSessions.some((session) => session.id === selectedTransferSessionId)) {
      setSelectedTransferSessionId(transferSessions[0]?.id ?? null);
    }
  }, [selectedTransferSessionId, transferSessions]);

  const selectedTransferSession = useMemo(
    () => transferSessions.find((session) => session.id === selectedTransferSessionId) ?? null,
    [selectedTransferSessionId, transferSessions],
  );
  const taskBoardSessionSummary = useMemo(
    () => buildPlanningTaskBoardSessionSummary(taskBoardProjection, observedSessions),
    [observedSessions, taskBoardProjection],
  );
  const selectedRoadmap = roadmapDetail?.roadmap ?? roadmaps.find((roadmap) => roadmap.id === selectedRoadmapId) ?? null;
  const selectedWorkPoint = useMemo<PlanningLiveWorkPoint | null>(
    () => roadmapDetail?.workPoints.find((workPoint) => workPoint.id === selectedWorkPointId) ?? null,
    [roadmapDetail?.workPoints, selectedWorkPointId],
  );
  const selectedWorkPointTodos = useMemo(
    () => selectedWorkPoint ? roadmapTodos.filter((todo) => todo.workPointId === selectedWorkPoint.id) : [],
    [roadmapTodos, selectedWorkPoint],
  );
  const selectedWorkPointPlans = useMemo(
    () => selectedWorkPoint
      ? roadmapPlans.filter((plan) => plan.targetedWorkPointIds.includes(selectedWorkPoint.id))
      : [],
    [roadmapPlans, selectedWorkPoint],
  );
  const repoTaskCount = useMemo(() => getProjectionTasks(taskBoardProjection).length, [taskBoardProjection]);
  const roadmapStatusCounts = useMemo(() => countStatuses(roadmaps), [roadmaps]);
  const repoTodoCounts = useMemo(() => countStatuses(repoTodos), [repoTodos]);
  const continuationBusy = Boolean(continuationActionKey);
  const selectedPlan = selectedPlanDetail?.plan ?? roadmapPlans.find((plan) => plan.id === selectedPlanId) ?? null;
  const planningAuthority = gatewayState?.planningAuthority ?? null;
  const planningAuthorityTone = resolvePlanningAuthorityTone(planningAuthority, planningAuthorityLoading, planningAuthorityError);
  const planningAuthoritySummary = formatGatewaySegmentSummary(
    planningAuthority && typeof planningAuthority === 'object' ? planningAuthority as Record<string, unknown> : null,
    planningAuthorityLoading ? 'checking' : 'unknown',
  );
  const planningAuthorityErrorRecord = asRecord(planningAuthority?.error);
  const planningAuthorityCode = asString(planningAuthorityErrorRecord.reason) || asString(planningAuthorityErrorRecord.code);
  const planningAuthorityMessage = planningAuthorityLoading
    ? 'Loading live planning authority state...'
    : planningAuthorityError
      ? planningAuthorityError
      : asString(planningAuthorityErrorRecord.message)
        || (planningAuthority?.ready === true
          ? 'elegy-planning authority is ready for live roadmap reads.'
          : 'Live planning authority is not ready for repo-scoped roadmap reads.');
  const activeRepoLabel = selectedCatalogRepo?.repoLabel || selectedCatalogRepo?.repoId || selectedCatalogRepo?.repoPath || 'No tracked repo selected';
  const activeRepoValue = selectedCatalogRepo?.repoId || selectedCatalogRepo?.repoPath || '(global transfer scope)';
  const repoScopedTransfer = Boolean(selectedCatalogRepo && hasPlanningRepoScope(selectedCatalogRepo));
  const canLoadTaskBoard = Boolean(repoQuery.repoId);
  const taskBoardEmptyCopy = !repoScopeAvailable
    ? 'Select a tracked repo to load its durable repo-state task board.'
    : canLoadTaskBoard
      ? 'No durable repo-state tasks were found for this repo yet.'
      : 'This tracked repo is missing a durable repo id, so the repo-state task board cannot be projected yet.';
  const detailSelectionLabel = selectedPlanId
    ? 'Plan detail'
    : selectedWorkPointId
      ? 'Work point detail'
      : selectedRoadmapId
        ? 'Roadmap detail'
        : 'Explorer';

  const openRoadmap = (roadmapId: string) => {
    setSelectedRoadmapId(roadmapId);
    setSelectedPlanId(null);
    setSelectedWorkPointId(null);
  };

  const clearExplorerSelection = () => {
    setSelectedRoadmapId(null);
    setSelectedPlanId(null);
    setSelectedWorkPointId(null);
  };

  const openPlan = (planId: string) => {
    setSelectedPlanId(planId);
    setSelectedWorkPointId(null);
  };

  const openWorkPoint = (workPointId: string) => {
    setSelectedWorkPointId(workPointId);
    setSelectedPlanId(null);
  };

  const refreshPlanningWorkspace = () => {
    setPlanningRefreshToken((current) => current + 1);
  };

  const detailWorkspaceTestId = selectedPlanId
    ? 'planning-plan-detail-workspace'
    : selectedWorkPointId
      ? 'planning-work-point-detail-workspace'
      : selectedRoadmapId
        ? 'planning-roadmap-detail-workspace'
        : null;

  async function copyContinuationPrompt(targetHarness: TransferTargetHarness): Promise<void> {
    if (!selectedTransferSession) {
      notificationStore.error('Continuation copy failed', {
        message: 'Select a session before copying a continuation prompt.',
      });
      return;
    }

    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      notificationStore.error('Continuation copy failed', {
        message: 'Clipboard access is unavailable in this environment.',
      });
      return;
    }

    const actionKey = buildContinuationActionKey('copy', targetHarness);
    setContinuationActionKey(actionKey);

    try {
      const continuationPackage = await getSessionContinuationPackage(selectedTransferSession.id, {
        source: typeof selectedTransferSession.source === 'string' ? selectedTransferSession.source : undefined,
        sandbox: typeof selectedTransferSession.sandbox === 'string' ? selectedTransferSession.sandbox : undefined,
        targetHarness,
      });
      await navigator.clipboard.writeText(continuationPackage.prompt.text);
      notificationStore.success('Continuation prompt copied', {
        message: `${TRANSFER_TARGETS.find((target) => target.id === targetHarness)?.label || targetHarness} continuation prompt copied to the clipboard.`,
      });
    } catch (error) {
      notificationStore.error('Continuation copy failed', {
        message: toErrorMessage(error, 'Unable to copy the continuation prompt.'),
      });
    } finally {
      setContinuationActionKey((current) => (current === actionKey ? null : current));
    }
  }

  async function downloadContinuationPackage(targetHarness: TransferTargetHarness): Promise<void> {
    if (!selectedTransferSession) {
      notificationStore.error('Continuation export failed', {
        message: 'Select a session before exporting a continuation package.',
      });
      return;
    }

    if (typeof Blob === 'undefined') {
      notificationStore.error('Continuation export failed', {
        message: 'File downloads are unavailable in this environment.',
      });
      return;
    }

    const actionKey = buildContinuationActionKey('download', targetHarness);
    setContinuationActionKey(actionKey);

    try {
      const continuationPackage = await getSessionContinuationPackage(selectedTransferSession.id, {
        source: typeof selectedTransferSession.source === 'string' ? selectedTransferSession.source : undefined,
        sandbox: typeof selectedTransferSession.sandbox === 'string' ? selectedTransferSession.sandbox : undefined,
        targetHarness,
      });
      createDownload(
        new Blob([JSON.stringify(continuationPackage, null, 2)], { type: 'application/json' }),
        buildContinuationFilename(selectedTransferSession.id, targetHarness),
      );
      notificationStore.success('Continuation package exported', {
        message: `Downloaded ${buildContinuationFilename(selectedTransferSession.id, targetHarness)}.`,
      });
    } catch (error) {
      notificationStore.error('Continuation export failed', {
        message: toErrorMessage(error, 'Unable to export the continuation package.'),
      });
    } finally {
      setContinuationActionKey((current) => (current === actionKey ? null : current));
    }
  }

  return (
    <section className="planning-view" data-testid="planning-view">
      <Toolbar testId="planning-view-toolbar">
        <div className="workspace-nav-summary">
          <p className="workspace-nav-title">Workspace</p>
          <p className="workspace-nav-copy">
            Live repo roadmaps now read directly from `elegy-planning`, with durable repo-state tasks and harness handoff kept close at hand.
          </p>
        </div>

        <div className="planning-toolbar-actions">
          <label className="form-input" htmlFor="planning-active-repo-select">
            <span className="form-label">Tracked repo</span>
            <select
              data-testid="planning-active-repo-select"
              id="planning-active-repo-select"
              onChange={(event) => {
                const selection = parseCatalogRepoChoiceValue(event.target.value);
                if (!selection) {
                  return;
                }
                void catalogWorkspaceStore.selectRepo(selection);
              }}
              value={selectedCatalogRepoValue}
            >
              <option value="">
                {catalogState.repoInventoryLoading
                  ? '(loading tracked repos...)'
                  : knownCatalogRepos.length > 0
                    ? '(choose a tracked repo)'
                    : '(no tracked repos available)'}
              </option>
              {knownCatalogRepos.map((repo) => (
                <option key={repo.repoId || repo.repoPath} value={buildCatalogRepoChoiceValue(repo)}>
                  {repo.repoLabel || repo.repoId || repo.repoPath}
                </option>
              ))}
            </select>
          </label>

          <div className="planning-actions">
            <Button
              onClick={() => setWorkspaceTab('roadmaps')}
              testId="planning-roadmaps-tab"
              variant={workspaceTab === 'roadmaps' ? 'primary' : 'secondary'}
            >
              Live Roadmaps
            </Button>
            <Button
              onClick={() => setWorkspaceTab('transfer')}
              testId="planning-transfer-tab"
              variant={workspaceTab === 'transfer' ? 'primary' : 'secondary'}
            >
              Transfer
            </Button>
            <Button onClick={() => navigationStore.setCatalogSectionId('repository')} testId="planning-open-catalog" variant="ghost">
              Open Repository Catalog
            </Button>
          </div>
        </div>
      </Toolbar>

      <div className="planning-metric-grid" data-testid="planning-context-summary">
        <div className="planning-metric-card">
          <p className="planning-metric-label">Active repo</p>
          <p className="planning-metric-value planning-metric-value-small">
            {activeRepoLabel}
          </p>
          <p className="planning-copy">
            <code>{activeRepoValue}</code>
          </p>
        </div>
        <div className="planning-metric-card">
          <p className="planning-metric-label">Live roadmaps</p>
          <p className="planning-metric-value">{roadmapsLoading ? '...' : roadmaps.length}</p>
          <p className="planning-copy">
            {roadmapsLoading
              ? 'Loading live roadmap status...'
              : formatStatusSummary(roadmapStatusCounts, ['active', 'finished', 'draft', 'proposed'])}
          </p>
        </div>
        <div className="planning-metric-card">
          <p className="planning-metric-label">Tracked todos</p>
          <p className="planning-metric-value">{roadmapsLoading ? '...' : repoTodos.length}</p>
          <p className="planning-copy">
            {roadmapsLoading
              ? 'Loading repo todo status...'
              : formatStatusSummary(repoTodoCounts, ['in-progress', 'pending', 'blocked', 'completed'])}
          </p>
        </div>
        <div className="planning-metric-card">
          <p className="planning-metric-label">Transfer sessions</p>
          <p className="planning-metric-value">{transferSessionsLoading ? '...' : transferSessions.length}</p>
          <p className="planning-copy">
            {repoScopedTransfer
              ? 'Recent sessions filtered to the selected tracked repo.'
              : 'Recent sessions across all tracked workspaces.'}
          </p>
        </div>
      </div>

      <Panel
        subtitle="Live planning reads depend on the packaged elegy-planning authority being explicitly configured at runtime."
        testId="planning-authority-panel"
        title="Planning Authority"
        actions={(
          <div className="planning-actions">
            <Button onClick={refreshPlanningWorkspace} testId="planning-refresh-authority" variant="secondary">
              Refresh
            </Button>
            <Button onClick={() => navigationStore.setMaintenanceSection('diagnostics')} testId="planning-open-diagnostics" variant="ghost">
              Open Diagnostics
            </Button>
          </div>
        )}
      >
        <div className={`planning-authority-status planning-authority-status-${planningAuthorityTone}`}>
          <div className="planning-authority-summary">
            <p className="planning-metric-label">Live authority</p>
            <p className="planning-item-title">
              {planningAuthoritySummary.statusLabel} | {planningAuthoritySummary.readinessLabel}
            </p>
            {planningAuthoritySummary.detail ? (
              <p className="planning-item-copy">{planningAuthoritySummary.detail}</p>
            ) : null}
          </div>
          {planningAuthorityCode ? <span className="planning-chip">{planningAuthorityCode}</span> : null}
        </div>

        {planningAuthorityTone === 'error' ? (
          <p className="planning-error" role="alert">{planningAuthorityMessage}</p>
        ) : planningAuthorityTone === 'warning' ? (
          <p className="planning-warning">{planningAuthorityMessage}</p>
        ) : (
          <p className="planning-copy">{planningAuthorityMessage}</p>
        )}

        <div className="planning-authority-detail-grid">
          <div className="planning-callout">
            <p className="planning-metric-label">CLI path</p>
            <p className="planning-path-block">
              <code>{asString(planningAuthority?.cliPath) || '(not configured)'}</code>
            </p>
          </div>
          <div className="planning-callout">
            <p className="planning-metric-label">DB path</p>
            <p className="planning-path-block">
              <code>{asString(planningAuthority?.dbPath) || '(not configured)'}</code>
            </p>
          </div>
        </div>
      </Panel>

      {workspaceTab === 'transfer' ? (
        <div className="planning-grid" data-testid="planning-transfer-workspace">
          <Panel
            subtitle="Move portable session context between harnesses without reopening discovery from scratch."
            testId="planning-transfer-panel"
            title="Harness Transfer"
          >
            <div className="planning-controls">
              <div className="planning-actions">
                {TRANSFER_TARGETS.map((target) => (
                  <Button
                    key={target.id}
                    onClick={() => setTransferTargetHarness(target.id)}
                    testId={`planning-transfer-target-${target.id}`}
                    variant={transferTargetHarness === target.id ? 'primary' : 'secondary'}
                  >
                    {target.label}
                  </Button>
                ))}
              </div>
              <p className="planning-copy">
                Exported continuation packages use the same portable contract already available from session detail views.
              </p>
            </div>

            {transferError ? <p className="planning-error" role="alert">{transferError}</p> : null}

            {transferSessionsLoading ? (
              <p className="state-message">Loading recent sessions...</p>
            ) : transferSessions.length === 0 ? (
              <p className="state-message">
                {repoScopedTransfer
                  ? 'No recent sessions match the selected tracked repo yet.'
                  : 'No recent sessions are available for transfer yet.'}
              </p>
            ) : (
              <div className="planning-entity-list" data-testid="planning-transfer-session-list">
                {transferSessions.map((session) => {
                  const sessionRepo = resolveSessionRepoContext(session);
                  const isSelected = session.id === selectedTransferSessionId;
                  return (
                    <button
                      key={session.id}
                      className={`planning-entity-card${isSelected ? ' planning-entity-card-active' : ''}`}
                      data-testid={`planning-transfer-session-${session.id}`}
                      onClick={() => setSelectedTransferSessionId(session.id)}
                      type="button"
                    >
                      <div className="planning-entity-heading">
                        <p className="planning-item-title">{resolveSessionTitle(session)}</p>
                        <span className="planning-chip">{humanizeToken(resolveSessionStatus(session))}</span>
                      </div>
                      <p className="planning-item-copy">{session.id}</p>
                      <p className="planning-item-copy">
                        {[
                          sessionRepo.repoLabel || sessionRepo.repoId || sessionRepo.repoPath || 'No repo label',
                          typeof session.source === 'string' ? humanizeToken(session.source) : '',
                        ].filter(Boolean).join(' | ')}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel
            subtitle="Copy the target harness prompt or download the full continuation package."
            testId="planning-transfer-actions-panel"
            title="Selected Session"
          >
            {selectedTransferSession ? (
              <>
                <dl className="planning-definition-grid">
                  <div>
                    <dt>Session</dt>
                    <dd>{selectedTransferSession.id}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{humanizeToken(resolveSessionStatus(selectedTransferSession))}</dd>
                  </div>
                  <div>
                    <dt>Repo</dt>
                    <dd>
                      {resolveSessionRepoContext(selectedTransferSession).repoLabel
                        || resolveSessionRepoContext(selectedTransferSession).repoId
                        || resolveSessionRepoContext(selectedTransferSession).repoPath
                        || 'Unscoped'}
                    </dd>
                  </div>
                  <div>
                    <dt>Target</dt>
                    <dd>{TRANSFER_TARGETS.find((target) => target.id === transferTargetHarness)?.label || transferTargetHarness}</dd>
                  </div>
                </dl>

                <div className="planning-actions">
                  <Button
                    disabled={continuationBusy}
                    onClick={() => void copyContinuationPrompt(transferTargetHarness)}
                    testId="planning-transfer-copy-prompt"
                    variant="primary"
                  >
                    {continuationActionKey === buildContinuationActionKey('copy', transferTargetHarness)
                      ? 'Copying Prompt...'
                      : 'Copy Prompt'}
                  </Button>
                  <Button
                    disabled={continuationBusy}
                    onClick={() => void downloadContinuationPackage(transferTargetHarness)}
                    testId="planning-transfer-download-package"
                    variant="secondary"
                  >
                    {continuationActionKey === buildContinuationActionKey('download', transferTargetHarness)
                      ? 'Exporting Package...'
                      : 'Download Package'}
                  </Button>
                  <Button
                    onClick={() => setWorkspaceTab('roadmaps')}
                    testId="planning-transfer-back-to-roadmaps"
                    variant="ghost"
                  >
                    Back to Roadmaps
                  </Button>
                </div>

                <p className="planning-copy">
                  Continuation packages are portable JSON handoff bundles. Import or paste the copied prompt into the selected target harness manually.
                </p>
              </>
            ) : (
              <p className="state-message">Select a recent session to prepare a harness handoff.</p>
            )}
          </Panel>
        </div>
      ) : (
        <>
          <div className="planning-explorer-layout" data-testid="planning-roadmap-root-workspace">
            <div className="planning-explorer-sidebar">
              <Panel
                subtitle="Browse live roadmaps for the selected tracked repo, then keep this explorer open while inspecting roadmap, plan, or work-point detail."
                testId="planning-live-roadmaps-panel"
                title="Live Roadmaps"
                actions={(
                  <div className="planning-actions">
                    <Button onClick={refreshPlanningWorkspace} testId="planning-refresh-roadmaps" variant="secondary">
                      Refresh
                    </Button>
                    <Button onClick={() => setWorkspaceTab('transfer')} testId="planning-open-transfer-tab" variant="secondary">
                      Transfer Session Context
                    </Button>
                    {(selectedRoadmapId || selectedPlanId || selectedWorkPointId) ? (
                      <Button onClick={clearExplorerSelection} testId="planning-clear-selection" variant="ghost">
                        Clear Selection
                      </Button>
                    ) : null}
                  </div>
                )}
              >
                {!repoScopeAvailable ? (
                  <p className="state-message">Select a tracked repo to load its live roadmaps from `elegy-planning`.</p>
                ) : roadmapsLoading ? (
                  <p className="state-message">Loading live roadmaps...</p>
                ) : roadmapsError ? (
                  <p className="planning-error" role="alert">{roadmapsError}</p>
                ) : roadmaps.length === 0 ? (
                  <p className="state-message">No live roadmaps are tagged for this tracked repo yet.</p>
                ) : (
                  <div className="planning-entity-list">
                    {roadmaps.map((roadmap) => {
                      const isSelected = roadmap.id === selectedRoadmapId;
                      return (
                        <button
                          key={roadmap.id}
                          className={`planning-entity-card${isSelected ? ' planning-entity-card-active' : ''}`}
                          data-testid={`planning-roadmap-open-${roadmap.id}`}
                          onClick={() => openRoadmap(roadmap.id)}
                          type="button"
                        >
                          <div className="planning-entity-heading">
                            <p className="planning-item-title">{roadmap.title || roadmap.id}</p>
                            <span className="planning-chip">{humanizeToken(roadmap.status)}</span>
                          </div>
                          <p className="planning-item-copy">{roadmap.summary || 'No roadmap summary yet.'}</p>
                          <p className="planning-item-copy">
                            {[roadmap.goalId || 'No goal', formatTimestamp(roadmap.updatedAt)].filter(Boolean).join(' | ')}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Panel>
            </div>

            <div className="planning-explorer-main" data-testid={detailWorkspaceTestId || 'planning-explorer-detail-workspace'}>
              {!repoScopeAvailable ? (
                <Panel
                  subtitle="Planning exploration starts once a tracked repo provides at least a repo id or repo path."
                  testId="planning-explorer-detail-panel"
                  title="Explorer Detail"
                >
                  <p className="state-message">Pick a tracked repo from the toolbar to inspect live roadmap authority, roadmap detail, and durable task-board context.</p>
                </Panel>
              ) : selectedPlanId ? (
                <div className="planning-section-stack">
                  <Panel
                    subtitle="Plan detail stays anchored to the selected roadmap and can drill back into targeted work points."
                    testId="planning-plan-detail-panel"
                    title={selectedPlan?.title || selectedPlan?.id || 'Live Plan'}
                    actions={(
                      <div className="planning-actions">
                        <Button onClick={() => setSelectedPlanId(null)} testId="planning-plan-back" variant="secondary">
                          Back to Roadmap
                        </Button>
                        <Button onClick={() => setWorkspaceTab('transfer')} testId="planning-plan-open-transfer" variant="ghost">
                          Transfer Session Context
                        </Button>
                      </div>
                    )}
                  >
                    {selectedPlanLoading ? (
                      <p className="state-message">Loading live plan detail...</p>
                    ) : selectedPlanError ? (
                      <p className="planning-error" role="alert">{selectedPlanError}</p>
                    ) : selectedPlanDetail?.plan ? (
                      <>
                        <dl className="planning-definition-grid">
                          <div>
                            <dt>Status</dt>
                            <dd>{humanizeToken(selectedPlanDetail.plan.status)}</dd>
                          </div>
                          <div>
                            <dt>Scope</dt>
                            <dd>{humanizeToken(selectedPlanDetail.plan.scope)}</dd>
                          </div>
                          <div>
                            <dt>Roadmap</dt>
                            <dd>{selectedPlanDetail.plan.roadmapId || 'Unscoped'}</dd>
                          </div>
                          <div>
                            <dt>Validation</dt>
                            <dd>{humanizeToken(selectedPlanDetail.validation?.status, 'Unknown')}</dd>
                          </div>
                          <div>
                            <dt>Updated</dt>
                            <dd>{formatTimestamp(selectedPlanDetail.plan.updatedAt)}</dd>
                          </div>
                          <div>
                            <dt>Todos</dt>
                            <dd>{selectedPlanDetail.todos.length}</dd>
                          </div>
                        </dl>

                        {selectedPlanDetail.plan.summary ? <p className="planning-copy">{selectedPlanDetail.plan.summary}</p> : null}

                        {selectedPlanDetail.plan.tags.length > 0 ? (
                          <div className="planning-chip-row">
                            {selectedPlanDetail.plan.tags.map((tag) => (
                              <span key={tag} className="planning-chip">{tag}</span>
                            ))}
                          </div>
                        ) : null}

                        {selectedPlanDetail.plan.targetedWorkPointIds.length > 0 ? (
                          <div className="planning-controls">
                            <p className="planning-metric-label">Targeted work points</p>
                            <div className="planning-actions">
                              {selectedPlanDetail.plan.targetedWorkPointIds.map((workPointId) => (
                                <Button
                                  key={workPointId}
                                  onClick={() => {
                                    setSelectedPlanId(null);
                                    setSelectedWorkPointId(workPointId);
                                  }}
                                  testId={`planning-plan-open-work-point-${workPointId}`}
                                  variant="secondary"
                                >
                                  {workPointId}
                                </Button>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {selectedPlanDetail.plan.validationSteps.length > 0 ? (
                          <div>
                            <p className="planning-metric-label">Validation steps</p>
                            <ul className="planning-guidance-list">
                              {selectedPlanDetail.plan.validationSteps.map((step) => (
                                <li key={step}>{step}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p className="state-message">Select a plan from the roadmap detail view.</p>
                    )}
                  </Panel>

                  <Panel subtitle="Execution-oriented todos attached directly to the selected live plan." testId="planning-plan-todos-panel" title="Plan Todos">
                    {selectedPlanDetail && selectedPlanDetail.todos.length > 0 ? (
                      <div className="planning-entity-list">
                        {selectedPlanDetail.todos.map((todo) => (
                          <div key={todo.id} className="planning-static-card">
                            <div className="planning-entity-heading">
                              <p className="planning-item-title">{todo.title || todo.id}</p>
                              <span className="planning-chip">{humanizeToken(todo.status)}</span>
                            </div>
                            <p className="planning-item-copy">{todo.summary || 'No todo summary yet.'}</p>
                            <p className="planning-item-copy">
                              {[todo.priority ? humanizeToken(todo.priority) : '', todo.workPointId || 'No work point'].filter(Boolean).join(' | ')}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="state-message">No live todos are attached to this plan yet.</p>
                    )}
                  </Panel>

                  <Panel subtitle="Review points and validation findings attached to the selected plan." testId="planning-plan-review-points-panel" title="Review And Validation">
                    {selectedPlanDetail?.reviewPoints.length ? (
                      <ul className="planning-guidance-list">
                        {selectedPlanDetail.reviewPoints.map((reviewPoint) => (
                          <li key={reviewPoint.id}>{reviewPoint.id}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="state-message">No live review points are attached to this plan yet.</p>
                    )}

                    {selectedPlanDetail?.validation?.findings.length ? (
                      <ul className="planning-guidance-list">
                        {selectedPlanDetail.validation.findings.map((finding, index) => (
                          <li key={finding.findingId || `${finding.code || 'finding'}-${index}`}>
                            {[finding.code, finding.message].filter(Boolean).join(' | ') || 'Validation finding'}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </Panel>
                </div>
              ) : selectedWorkPointId ? (
                <div className="planning-section-stack">
                  <Panel
                    subtitle="Work-point detail narrows the roadmap into one execution slice without losing its parent roadmap context."
                    testId="planning-work-point-detail-panel"
                    title={selectedWorkPoint?.title || selectedWorkPoint?.id || 'Work Point'}
                    actions={(
                      <div className="planning-actions">
                        <Button onClick={() => setSelectedWorkPointId(null)} testId="planning-work-point-back" variant="secondary">
                          Back to Roadmap
                        </Button>
                        <Button onClick={() => setWorkspaceTab('transfer')} testId="planning-work-point-open-transfer" variant="ghost">
                          Transfer Session Context
                        </Button>
                      </div>
                    )}
                  >
                    {selectedWorkPoint ? (
                      <>
                        <dl className="planning-definition-grid">
                          <div>
                            <dt>Status</dt>
                            <dd>{humanizeToken(selectedWorkPoint.status)}</dd>
                          </div>
                          <div>
                            <dt>Ordering</dt>
                            <dd>{selectedWorkPoint.ordering ?? 'Unordered'}</dd>
                          </div>
                          <div>
                            <dt>Roadmap</dt>
                            <dd>{selectedWorkPoint.roadmapId || selectedRoadmap?.id || 'Unknown'}</dd>
                          </div>
                          <div>
                            <dt>Todos</dt>
                            <dd>{selectedWorkPointTodos.length}</dd>
                          </div>
                        </dl>

                        <p className="planning-copy">{selectedWorkPoint.summary || 'No work-point summary yet.'}</p>

                        {selectedWorkPoint.validationExpectations.length > 0 ? (
                          <div>
                            <p className="planning-metric-label">Validation expectations</p>
                            <ul className="planning-guidance-list">
                              {selectedWorkPoint.validationExpectations.map((expectation) => (
                                <li key={expectation}>{expectation}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {selectedWorkPoint.tags.length > 0 ? (
                          <div className="planning-chip-row">
                            {selectedWorkPoint.tags.map((tag) => (
                              <span key={tag} className="planning-chip">{tag}</span>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p className="state-message">Select a work point from the roadmap detail view.</p>
                    )}
                  </Panel>

                  <Panel subtitle="Todos derived for this specific roadmap slice." testId="planning-work-point-todos-panel" title="Slice Todos">
                    {selectedWorkPointTodos.length > 0 ? (
                      <div className="planning-entity-list">
                        {selectedWorkPointTodos.map((todo) => (
                          <div key={todo.id} className="planning-static-card">
                            <div className="planning-entity-heading">
                              <p className="planning-item-title">{todo.title || todo.id}</p>
                              <span className="planning-chip">{humanizeToken(todo.status)}</span>
                            </div>
                            <p className="planning-item-copy">{todo.summary || 'No todo summary yet.'}</p>
                            <p className="planning-item-copy">{todo.planId || 'Standalone todo'}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="state-message">No live todos are attached to this work point yet.</p>
                    )}
                  </Panel>

                  <Panel subtitle="Plans that explicitly target this roadmap slice." testId="planning-work-point-plans-panel" title="Related Plans">
                    {selectedWorkPointPlans.length > 0 ? (
                      <div className="planning-entity-list">
                        {selectedWorkPointPlans.map((plan) => (
                          <button
                            key={plan.id}
                            className="planning-entity-card"
                            data-testid={`planning-work-point-open-plan-${plan.id}`}
                            onClick={() => openPlan(plan.id)}
                            type="button"
                          >
                            <div className="planning-entity-heading">
                              <p className="planning-item-title">{plan.title || plan.id}</p>
                              <span className="planning-chip">{humanizeToken(plan.status)}</span>
                            </div>
                            <p className="planning-item-copy">{plan.summary || 'No plan summary yet.'}</p>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="state-message">No live plans target this work point yet.</p>
                    )}
                  </Panel>
                </div>
              ) : selectedRoadmapId ? (
                <div className="planning-section-stack">
                  <Panel
                    subtitle="Roadmap detail expands the selected live roadmap into goal context, work points, plans, and execution-facing todos."
                    testId="planning-roadmap-detail-panel"
                    title={selectedRoadmap?.title || selectedRoadmap?.id || 'Live Roadmap'}
                    actions={(
                      <div className="planning-actions">
                        <Button onClick={clearExplorerSelection} testId="planning-roadmap-back" variant="secondary">
                          Back to Roadmaps
                        </Button>
                        <Button onClick={() => setWorkspaceTab('transfer')} testId="planning-roadmap-open-transfer" variant="ghost">
                          Transfer Session Context
                        </Button>
                      </div>
                    )}
                  >
                    {roadmapDetailLoading ? (
                      <p className="state-message">Loading live roadmap detail...</p>
                    ) : roadmapDetailError ? (
                      <p className="planning-error" role="alert">{roadmapDetailError}</p>
                    ) : selectedRoadmap ? (
                      <>
                        <dl className="planning-definition-grid">
                          <div>
                            <dt>Status</dt>
                            <dd>{humanizeToken(selectedRoadmap.status)}</dd>
                          </div>
                          <div>
                            <dt>Goal</dt>
                            <dd>{goalDetail?.title || selectedRoadmap.goalId || 'Unlinked'}</dd>
                          </div>
                          <div>
                            <dt>Work points</dt>
                            <dd>{roadmapDetail?.workPoints.length ?? 0}</dd>
                          </div>
                          <div>
                            <dt>Plans</dt>
                            <dd>{roadmapPlans.length}</dd>
                          </div>
                          <div>
                            <dt>Todos</dt>
                            <dd>{roadmapTodos.length}</dd>
                          </div>
                          <div>
                            <dt>Validation</dt>
                            <dd>{humanizeToken(roadmapDetail?.validation?.status, 'Unknown')}</dd>
                          </div>
                          <div>
                            <dt>Updated</dt>
                            <dd>{formatTimestamp(selectedRoadmap.updatedAt)}</dd>
                          </div>
                        </dl>

                        {selectedRoadmap.summary ? <p className="planning-copy">{selectedRoadmap.summary}</p> : null}

                        {selectedRoadmap.tags.length > 0 ? (
                          <div className="planning-chip-row">
                            {selectedRoadmap.tags.map((tag) => (
                              <span key={tag} className="planning-chip">{tag}</span>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p className="state-message">Select a live roadmap to inspect its detail.</p>
                    )}
                  </Panel>

                  {goalDetail ? (
                    <Panel subtitle="Every live roadmap remains anchored to a durable parent goal." testId="planning-roadmap-goal-panel" title="Parent Goal">
                      <p className="planning-item-title">{goalDetail.title || goalDetail.id}</p>
                      <p className="planning-copy">{goalDetail.description || 'No goal description yet.'}</p>
                      {goalDetail.acceptanceCriteria.length > 0 ? (
                        <div>
                          <p className="planning-metric-label">Acceptance criteria</p>
                          <ul className="planning-guidance-list">
                            {goalDetail.acceptanceCriteria.map((criterion) => (
                              <li key={criterion}>{criterion}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </Panel>
                  ) : null}

                  <Panel subtitle="Open a work point to focus the roadmap down to one durable execution slice." testId="planning-roadmap-work-points-panel" title="Work Points">
                    {roadmapDetail && roadmapDetail.workPoints.length > 0 ? (
                      <div className="planning-entity-list">
                        {roadmapDetail.workPoints.map((workPoint) => (
                          <button
                            key={workPoint.id}
                            className="planning-entity-card"
                            data-testid={`planning-roadmap-open-work-point-${workPoint.id}`}
                            onClick={() => openWorkPoint(workPoint.id)}
                            type="button"
                          >
                            <div className="planning-entity-heading">
                              <p className="planning-item-title">{workPoint.title || workPoint.id}</p>
                              <span className="planning-chip">{humanizeToken(workPoint.status)}</span>
                            </div>
                            <p className="planning-item-copy">{workPoint.summary || 'No work-point summary yet.'}</p>
                            <p className="planning-item-copy">
                              {[`Order ${workPoint.ordering ?? 'n/a'}`, `${workPoint.validationExpectations.length} validation step(s)`].join(' | ')}
                            </p>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="state-message">No live work points are attached to this roadmap yet.</p>
                    )}
                  </Panel>

                  <Panel subtitle="Open a plan to inspect its dedicated todos, validation guidance, and review points." testId="planning-roadmap-plans-panel" title="Plans">
                    {roadmapPlans.length > 0 ? (
                      <div className="planning-entity-list">
                        {roadmapPlans.map((plan) => (
                          <button
                            key={plan.id}
                            className="planning-entity-card"
                            data-testid={`planning-roadmap-open-plan-${plan.id}`}
                            onClick={() => openPlan(plan.id)}
                            type="button"
                          >
                            <div className="planning-entity-heading">
                              <p className="planning-item-title">{plan.title || plan.id}</p>
                              <span className="planning-chip">{humanizeToken(plan.status)}</span>
                            </div>
                            <p className="planning-item-copy">{plan.summary || 'No plan summary yet.'}</p>
                            <p className="planning-item-copy">
                              {[humanizeToken(plan.scope), `${plan.targetedWorkPointIds.length} targeted slice(s)`].join(' | ')}
                            </p>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="state-message">No live plans target this roadmap yet.</p>
                    )}
                  </Panel>

                  <Panel subtitle="Roadmap-linked todos keep execution pressure visible without becoming the canonical roadmap authority." testId="planning-roadmap-todos-panel" title="Roadmap Todos">
                    {roadmapTodos.length > 0 ? (
                      <div className="planning-entity-list">
                        {roadmapTodos.map((todo) => (
                          <div key={todo.id} className="planning-static-card">
                            <div className="planning-entity-heading">
                              <p className="planning-item-title">{todo.title || todo.id}</p>
                              <span className="planning-chip">{humanizeToken(todo.status)}</span>
                            </div>
                            <p className="planning-item-copy">{todo.summary || 'No todo summary yet.'}</p>
                            <p className="planning-item-copy">
                              {[todo.planId || 'Standalone todo', todo.workPointId || 'No slice', todo.priority ? humanizeToken(todo.priority) : ''].filter(Boolean).join(' | ')}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="state-message">No live todos are attached to this roadmap yet.</p>
                    )}
                  </Panel>
                </div>
              ) : (
                <div className="planning-section-stack">
                  <Panel
                    subtitle="Select a roadmap from the explorer to inspect its goal, work points, plans, and execution-facing todos without leaving the repo workspace."
                    testId="planning-explorer-detail-panel"
                    title={detailSelectionLabel}
                    actions={(
                      <div className="planning-actions">
                        <Button onClick={() => setWorkspaceTab('transfer')} testId="planning-explorer-open-transfer" variant="ghost">
                          Transfer Session Context
                        </Button>
                      </div>
                    )}
                  >
                    <dl className="planning-definition-grid">
                      <div>
                        <dt>Repo</dt>
                        <dd>{activeRepoLabel}</dd>
                      </div>
                      <div>
                        <dt>Scope key</dt>
                        <dd>{activeRepoValue}</dd>
                      </div>
                      <div>
                        <dt>Live roadmaps</dt>
                        <dd>{roadmaps.length}</dd>
                      </div>
                      <div>
                        <dt>Tracked todos</dt>
                        <dd>{repoTodos.length}</dd>
                      </div>
                      <div>
                        <dt>Authority</dt>
                        <dd>{planningAuthoritySummary.statusLabel}</dd>
                      </div>
                      <div>
                        <dt>Task board</dt>
                        <dd>{canLoadTaskBoard ? `${repoTaskCount} durable task(s)` : 'Repo id required'}</dd>
                      </div>
                    </dl>

                    <p className="planning-copy">
                      {roadmaps.length > 0
                        ? 'Choose a roadmap from the left explorer to inspect its durable goal context, work points, plans, and roadmap-linked todos.'
                        : 'This repo scope has no visible live roadmaps yet. The authority panel above shows whether the runtime is wired correctly.'}
                    </p>

                    {!canLoadTaskBoard ? (
                      <p className="planning-warning">
                        This tracked repo can still load live planning data by repo path or label, but the durable repo-state task board cannot load until the repo has a durable repo id.
                      </p>
                    ) : null}
                  </Panel>

                  <Panel subtitle="Repo-scoped todo pressure remains visible before drilling into a single roadmap." testId="planning-repo-todos-panel" title="Repo Todos">
                    {repoTodos.length > 0 ? (
                      <div className="planning-entity-list">
                        {repoTodos.map((todo) => (
                          <div key={todo.id} className="planning-static-card">
                            <div className="planning-entity-heading">
                              <p className="planning-item-title">{todo.title || todo.id}</p>
                              <span className="planning-chip">{humanizeToken(todo.status)}</span>
                            </div>
                            <p className="planning-item-copy">{todo.summary || 'No todo summary yet.'}</p>
                            <p className="planning-item-copy">
                              {[todo.planId || 'Standalone todo', todo.workPointId || 'No work point', todo.priority ? humanizeToken(todo.priority) : ''].filter(Boolean).join(' | ')}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="state-message">No repo-scoped live todos are visible yet.</p>
                    )}
                  </Panel>
                </div>
              )}
            </div>
          </div>

          <Panel
            subtitle="Durable repo-state tasks remain the execution board, while the live roadmap authority stays explorable above in the same workspace."
            testId="planning-task-board-panel"
            title="Durable Task Board"
          >
            <TaskBoardView
              emptyCopy={taskBoardEmptyCopy}
              error={taskBoardError}
              filterStatus={taskBoardFilterStatus}
              groupBy={taskBoardGroupBy}
              loading={canLoadTaskBoard ? taskBoardLoading : false}
              onFilterStatusChange={(status) => {
                setTaskBoardFilterStatus(status);
                setSelectedTaskId(null);
              }}
              onGroupByChange={(value) => setTaskBoardGroupBy(value)}
              onSelectTask={(taskId) => setSelectedTaskId(taskId)}
              projection={taskBoardProjection}
              selectedTaskId={selectedTaskId}
              sessionSummary={taskBoardSessionSummary}
              subtitle="Repo-state tasks remain canonical durable execution authority, while live roadmaps stay inside elegy-planning."
              testId="planning-task-board-view"
              title="Repo Task Board"
            />

            <p className="planning-copy">
              {!repoScopeAvailable
                ? 'Pick a tracked repo to project its durable task board into this workspace.'
                : canLoadTaskBoard
                  ? `${repoTaskCount} durable task(s) currently project into the visible board for ${selectedCatalogRepo?.repoLabel || repoQuery.repoId}.`
                  : 'This tracked repo can be explored through live planning authority, but durable repo-state task projection still requires a repo id.'}
            </p>
          </Panel>
        </>
      )}
    </section>
  );
}
