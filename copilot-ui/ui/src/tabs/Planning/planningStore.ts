import {
  buildPlanningRepositoryBacklogRef,
  buildPlanningRoadmapDirectoryRef,
  comparePlanningRecords,
  createPlanningRecord,
  createSdkSession,
  deletePlanningResearchNote,
  getPlanningDiagrams,
  getPlanningResearchNotes,
  getPlanningRecords,
  getPolicyPreflight,
  mergePlanningRecords,
  sendSdkMessage,
  type PlanningResearchNoteInput,
  preparePlanningMergeIntent,
  savePlanningResearchNote,
  searchPlanningRecords,
  updatePlanningRecord,
} from '../../lib/api';
import { createStore } from '../../lib/store';
import type {
  CatalogRepoInventoryEntry,
  PlanningDiagram,
  PlanningCompareReceipt,
  PlanningCompareResponse,
  PlanningMergeIntentToken,
  PlanningRecordItem,
  PlanningRepositoryBacklogRef,
  PlanningRoadmapDirectoryRef,
  PlanningResearchNote,
  PlanningSearchResultItem,
  PolicyPreflightResponse,
} from '../../lib/types';
import { sdkSessionsStore } from '../Sessions/sdkSessionsStore';

const PLANNING_GATE_PASS = 'pass';
const PLANNING_GATE_DEGRADED = 'degraded';
const PLANNING_GATE_INSUFFICIENT_DATA = 'insufficient-data';
const PLANNING_GATE_POLICY_BLOCKED = 'policy-blocked';
const PLANNING_GATE_AUTH_DENIED = 'auth-denied';
const PLANNING_MERGE_INTENT_DEFAULT_TTL_MS = 5 * 60 * 1000;

const IDEA_RECORD_STATES = new Set(['thought', 'research', 'pre-plan']);

export interface PlanningConflictValue {
  scope: 'user' | 'repo' | 'global';
  field: 'title' | 'summary' | 'state';
  value: string;
  recordId: string;
  updatedAt?: string | null;
  createdAt?: string | null;
}

export interface PlanningConflictRow {
  conflictKey: string;
  field: 'title' | 'summary' | 'state';
  valuesByScope: {
    user: PlanningConflictValue | null;
    repo: PlanningConflictValue | null;
    global: PlanningConflictValue | null;
  };
  winnerScope: 'user' | 'repo' | 'global';
  winnerRecordId: string;
  winnerValue: string;
}

export interface PlanningCatalogRepoContext {
  repoId: string;
  repoPath: string;
  repoLabel: string;
  sources: string[];
}

export interface PlanningState {
  userId: string;
  repoId: string;
  catalogRepoContext: PlanningCatalogRepoContext | null;
  repositoryBacklog: PlanningRepositoryBacklogRef | null;
  roadmapDirectory: PlanningRoadmapDirectoryRef | null;
  query: string;
  sessionId: string;
  scopeUser: boolean;
  scopeRepo: boolean;
  scopeGlobal: boolean;
  records: PlanningRecordItem[];
  deniedScopes: string[];
  searchResults: PlanningSearchResultItem[];
  createScope: 'user' | 'repo' | 'global';
  createState: string;
  createTitle: string;
  createSummary: string;
  createAcceptanceCriteria: string;
  ideaDraft: string;
  ideaTargetRepos: string;
  selectedIdeaIds: string[];
  updatingRecordId: string | null;
  compiling: boolean;
  selectedRecordId: string;
  researchNotes: PlanningResearchNote[];
  diagrams: PlanningDiagram[];
  selectedDiagramId: string;
  artifactsLoading: boolean;
  artifactsSaving: boolean;
  artifactsDeleting: boolean;
  artifactsError: string | null;
  compareResponse: PlanningCompareResponse | null;
  gateState: string;
  gateReason: string;
  conflictRows: PlanningConflictRow[];
  reviewedConflictKeys: string[];
  mergeTargetId: string;
  intentToken: PlanningMergeIntentToken | null;
  policyPreflight: PolicyPreflightResponse | null;
  mutatingBlocked: boolean;
  mutatingReason: string;
  loading: boolean;
  listing: boolean;
  searching: boolean;
  comparing: boolean;
  creating: boolean;
  preparingIntent: boolean;
  merging: boolean;
  preflightLoading: boolean;
  error: string | null;
  statusMessage: string | null;
}

const INITIAL_STATE: PlanningState = {
  userId: '',
  repoId: '',
  catalogRepoContext: null,
  repositoryBacklog: null,
  roadmapDirectory: null,
  query: '',
  sessionId: '',
  scopeUser: true,
  scopeRepo: true,
  scopeGlobal: true,
  records: [],
  deniedScopes: [],
  searchResults: [],
  createScope: 'user',
  createState: 'thought',
  createTitle: '',
  createSummary: '',
  createAcceptanceCriteria: '',
  ideaDraft: '',
  ideaTargetRepos: '',
  selectedIdeaIds: [],
  updatingRecordId: null,
  compiling: false,
  selectedRecordId: '',
  researchNotes: [],
  diagrams: [],
  selectedDiagramId: '',
  artifactsLoading: false,
  artifactsSaving: false,
  artifactsDeleting: false,
  artifactsError: null,
  compareResponse: null,
  gateState: PLANNING_GATE_INSUFFICIENT_DATA,
  gateReason: 'Run compare to evaluate merge gate state.',
  conflictRows: [],
  reviewedConflictKeys: [],
  mergeTargetId: '',
  intentToken: null,
  policyPreflight: null,
  mutatingBlocked: false,
  mutatingReason: '',
  loading: false,
  listing: false,
  searching: false,
  comparing: false,
  creating: false,
  preparingIntent: false,
  merging: false,
  preflightLoading: false,
  error: null,
  statusMessage: null,
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function deterministicStringCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizeGateState(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === PLANNING_GATE_PASS) return PLANNING_GATE_PASS;
  if (normalized === PLANNING_GATE_DEGRADED) return PLANNING_GATE_DEGRADED;
  if (normalized === PLANNING_GATE_INSUFFICIENT_DATA) return PLANNING_GATE_INSUFFICIENT_DATA;
  if (normalized === PLANNING_GATE_POLICY_BLOCKED) return PLANNING_GATE_POLICY_BLOCKED;
  if (normalized === PLANNING_GATE_AUTH_DENIED) return PLANNING_GATE_AUTH_DENIED;
  return PLANNING_GATE_INSUFFICIENT_DATA;
}

function parseIsoMs(value: unknown): number {
  if (value == null) {
    return 0;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCatalogRepoContext(
  repo: Partial<CatalogRepoInventoryEntry> | null | undefined
): PlanningCatalogRepoContext | null {
  if (!repo || typeof repo !== 'object') {
    return null;
  }

  const repoId = typeof repo.repoId === 'string' ? repo.repoId.trim() : '';
  const repoPath = typeof repo.repoPath === 'string' ? repo.repoPath.trim() : '';
  const repoLabel = typeof repo.repoLabel === 'string' ? repo.repoLabel.trim() : '';
  const sources = Array.isArray(repo.sources)
    ? repo.sources
      .map((entry) => String(entry || '').trim())
      .filter((entry) => entry.length > 0)
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

function scopeRank(scope: string): number {
  const normalized = scope.trim().toLowerCase();
  if (normalized === 'user') return 3;
  if (normalized === 'repo') return 2;
  if (normalized === 'global') return 1;
  return 0;
}

function compareConflictEntries(
  a: { scope: string; updatedAt?: string | null; createdAt?: string | null; recordId: string },
  b: { scope: string; updatedAt?: string | null; createdAt?: string | null; recordId: string }
): number {
  const scopeDiff = scopeRank(b.scope) - scopeRank(a.scope);
  if (scopeDiff !== 0) {
    return scopeDiff;
  }

  const updatedDiff = parseIsoMs(b.updatedAt) - parseIsoMs(a.updatedAt);
  if (updatedDiff !== 0) {
    return updatedDiff;
  }

  const createdDiff = parseIsoMs(b.createdAt) - parseIsoMs(a.createdAt);
  if (createdDiff !== 0) {
    return createdDiff;
  }

  return deterministicStringCompare(a.recordId, b.recordId);
}

function pickTopRecordByScope(records: PlanningRecordItem[]): Map<string, PlanningRecordItem> {
  const topByScope = new Map<string, PlanningRecordItem>();

  for (const record of records) {
    const scope = String(record.scope || '').trim().toLowerCase();
    if (scopeRank(scope) === 0) {
      continue;
    }

    const existing = topByScope.get(scope);
    if (!existing) {
      topByScope.set(scope, record);
      continue;
    }

    const nextWins = compareConflictEntries(
      {
        scope,
        updatedAt: record.updatedAt,
        createdAt: record.createdAt,
        recordId: String(record.recordId || ''),
      },
      {
        scope,
        updatedAt: existing.updatedAt,
        createdAt: existing.createdAt,
        recordId: String(existing.recordId || ''),
      }
    ) < 0;

    if (nextWins) {
      topByScope.set(scope, record);
    }
  }

  return topByScope;
}

function buildPlanningConflictRows(records: PlanningRecordItem[]): PlanningConflictRow[] {
  const fields: Array<'title' | 'summary' | 'state'> = ['title', 'summary', 'state'];
  const topByScope = pickTopRecordByScope(records);
  const scopes: Array<'user' | 'repo' | 'global'> = ['user', 'repo', 'global'];
  const rows: PlanningConflictRow[] = [];

  for (const field of fields) {
    const entries: PlanningConflictValue[] = [];

    for (const scope of scopes) {
      const top = topByScope.get(scope);
      if (!top) {
        continue;
      }

      const value = String(top[field] || '').trim();
      if (!value) {
        continue;
      }

      entries.push({
        scope,
        field,
        value,
        recordId: String(top.recordId || ''),
        updatedAt: top.updatedAt,
        createdAt: top.createdAt,
      });
    }

    if (entries.length < 2) {
      continue;
    }

    const distinctValues = [...new Set(entries.map((entry) => entry.value))];
    if (distinctValues.length < 2) {
      continue;
    }

    const winner = entries.slice().sort(compareConflictEntries)[0];
    if (!winner) {
      continue;
    }

    rows.push({
      conflictKey: field,
      field,
      valuesByScope: {
        user: entries.find((entry) => entry.scope === 'user') || null,
        repo: entries.find((entry) => entry.scope === 'repo') || null,
        global: entries.find((entry) => entry.scope === 'global') || null,
      },
      winnerScope: winner.scope,
      winnerRecordId: winner.recordId,
      winnerValue: winner.value,
    });
  }

  rows.sort((a, b) => deterministicStringCompare(a.field, b.field));
  return rows;
}

function buildIdempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function selectedScopes(state: PlanningState): string[] {
  const scopes: string[] = [];
  if (state.scopeUser) scopes.push('user');
  if (state.scopeRepo) scopes.push('repo');
  if (state.scopeGlobal) scopes.push('global');
  return scopes;
}

function normalizeAcceptanceCriteriaInput(raw: string): string[] {
  return raw
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeIdeaLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((entry) => entry.replace(/^[-*•]\s*/, '').trim())
    .filter((entry) => entry.length > 0);
}

function normalizeRepoTargetsInput(raw: string): string[] {
  return [...new Set(
    raw
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  )].sort((left, right) => left.localeCompare(right));
}

export function isIdeaRecord(record: PlanningRecordItem): boolean {
  return IDEA_RECORD_STATES.has(String(record.state || '').trim().toLowerCase());
}

function readCompareReceipt(compareResponse: PlanningCompareResponse | null): PlanningCompareReceipt | null {
  if (!compareResponse || !compareResponse.compareReceipt) {
    return null;
  }

  const receiptId = String(compareResponse.compareReceipt.receiptId || '').trim();
  return receiptId ? compareResponse.compareReceipt : null;
}

export function planningGateAllowsMerge(gateState: string): boolean {
  return normalizeGateState(gateState) === PLANNING_GATE_PASS;
}

export function hasReviewedAllPlanningConflicts(conflicts: PlanningConflictRow[], reviewedKeys: string[]): boolean {
  if (conflicts.length === 0) {
    return true;
  }

  const reviewed = new Set(reviewedKeys);
  return conflicts.every((row) => reviewed.has(row.conflictKey));
}

export function createPlanningStore() {
  const store = createStore<PlanningState>(INITIAL_STATE);

  let recordsRequestVersion = 0;
  let searchRequestVersion = 0;
  let compareRequestVersion = 0;
  let preflightRequestVersion = 0;
  let artifactsRequestVersion = 0;
  let artifactsMutationVersion = 0;

  function applyCatalogRepoContext(repo: Partial<CatalogRepoInventoryEntry> | null | undefined): void {
    const catalogRepoContext = normalizeCatalogRepoContext(repo);
    const repositoryBacklog = buildPlanningRepositoryBacklogRef({
      repoId: catalogRepoContext?.repoId || undefined,
      repoPath: catalogRepoContext?.repoPath || undefined,
      repoLabel: catalogRepoContext?.repoLabel || undefined,
    });
    const roadmapDirectory = buildPlanningRoadmapDirectoryRef({
      repoId: catalogRepoContext?.repoId || undefined,
      repoPath: catalogRepoContext?.repoPath || undefined,
      repoLabel: catalogRepoContext?.repoLabel || undefined,
    });

    store.setState((state) => ({
      ...state,
      catalogRepoContext,
      repositoryBacklog,
      roadmapDirectory,
      repoId: catalogRepoContext?.repoId || '',
      createScope: catalogRepoContext?.repoId ? 'repo' : (state.createScope === 'repo' ? 'user' : state.createScope),
      error: null,
    }));
  }

  function setStatus(statusMessage: string): void {
    store.setState((state) => ({
      ...state,
      statusMessage,
    }));
  }

  async function refreshPolicyPreflight(forceRefresh = false): Promise<void> {
    const nextVersion = ++preflightRequestVersion;

    store.setState((state) => ({
      ...state,
      preflightLoading: true,
      error: null,
    }));

    try {
      const response = await getPolicyPreflight(undefined, forceRefresh);

      store.setState((state) => {
        if (nextVersion !== preflightRequestVersion) {
          return state;
        }

        const mutatingBlocked = !response.ok;
        const mutatingReason = response.message || response.reason || '';

        return {
          ...state,
          preflightLoading: false,
          policyPreflight: response,
          mutatingBlocked,
          mutatingReason,
          gateState: mutatingBlocked ? PLANNING_GATE_POLICY_BLOCKED : state.gateState,
          gateReason: mutatingBlocked ? mutatingReason || 'Policy preflight blocked.' : state.gateReason,
          statusMessage: mutatingBlocked
            ? `Policy gate active: ${mutatingReason || 'mutating actions are blocked.'}`
            : state.statusMessage,
        };
      });
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to load policy preflight.');

      store.setState((state) => {
        if (nextVersion !== preflightRequestVersion) {
          return state;
        }

        return {
          ...state,
          preflightLoading: false,
          error: message,
          policyPreflight: {
            ok: false,
            status: 'failed',
            reason: 'preflight_request_failed',
            message,
          },
          mutatingBlocked: true,
          mutatingReason: message,
          gateState: PLANNING_GATE_POLICY_BLOCKED,
          gateReason: message,
        };
      });
    }
  }

  async function listRecords(): Promise<void> {
    const nextVersion = ++recordsRequestVersion;
    const stateSnapshot = store.getState();

    store.setState((state) => ({
      ...state,
      listing: true,
      error: null,
    }));

    try {
      const response = await getPlanningRecords({
        userId: stateSnapshot.userId,
        repoId: stateSnapshot.repoId,
        scopes: selectedScopes(stateSnapshot),
      });

      let nextSelectedRecordId = '';

      store.setState((state) => {
        if (nextVersion !== recordsRequestVersion) {
          return state;
        }

        const hasSelectedRecord =
          state.selectedRecordId.trim().length > 0
          && response.records.some((record) => record.recordId === state.selectedRecordId);

        nextSelectedRecordId = hasSelectedRecord
          ? state.selectedRecordId
          : (response.records[0]?.recordId ?? '');

        const nextSelectedIdeas = state.selectedIdeaIds.filter((recordId) =>
          response.records.some((record) => record.recordId === recordId)
        );

        return {
          ...state,
          records: response.records,
          deniedScopes: response.deniedScopes,
          selectedIdeaIds: nextSelectedIdeas,
          selectedRecordId: nextSelectedRecordId,
          listing: false,
          error: null,
          statusMessage: 'Planning records loaded.',
        };
      });

      if (nextSelectedRecordId) {
        await loadArtifacts(nextSelectedRecordId);
      } else {
        store.setState((state) => ({
          ...state,
          researchNotes: [],
          diagrams: [],
          selectedDiagramId: '',
        }));
      }
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to load planning records.');

      store.setState((state) => {
        if (nextVersion !== recordsRequestVersion) {
          return state;
        }

        return {
          ...state,
          listing: false,
          error: message,
          statusMessage: `Planning records failed: ${message}`,
        };
      });
    }
  }

  async function searchRecords(): Promise<void> {
    const nextVersion = ++searchRequestVersion;
    const stateSnapshot = store.getState();

    store.setState((state) => ({
      ...state,
      searching: true,
      error: null,
    }));

    try {
      const response = await searchPlanningRecords({
        userId: stateSnapshot.userId,
        repoId: stateSnapshot.repoId,
        scopes: selectedScopes(stateSnapshot),
        query: stateSnapshot.query,
        limit: 20,
      });

      store.setState((state) => {
        if (nextVersion !== searchRequestVersion) {
          return state;
        }

        return {
          ...state,
          searchResults: response.results,
          searching: false,
          error: null,
          statusMessage: 'Planning search completed.',
        };
      });
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to search planning records.');

      store.setState((state) => {
        if (nextVersion !== searchRequestVersion) {
          return state;
        }

        return {
          ...state,
          searching: false,
          error: message,
          statusMessage: `Planning search failed: ${message}`,
        };
      });
    }
  }

  async function loadArtifacts(recordIdOverride?: string): Promise<void> {
    const nextVersion = ++artifactsRequestVersion;
    const snapshot = store.getState();
    const recordId = (recordIdOverride ?? snapshot.selectedRecordId).trim();

    if (!recordId) {
      store.setState((state) => ({
        ...state,
        researchNotes: [],
        diagrams: [],
        selectedDiagramId: '',
        artifactsLoading: false,
        artifactsError: null,
      }));
      return;
    }

    store.setState((state) => ({
      ...state,
      artifactsLoading: true,
      artifactsError: null,
    }));

    try {
      const [notesResponse, diagramsResponse] = await Promise.all([
        getPlanningResearchNotes(recordId),
        getPlanningDiagrams(recordId),
      ]);

      store.setState((state) => {
        if (nextVersion !== artifactsRequestVersion) {
          return state;
        }

        const hasSelectedDiagram =
          state.selectedDiagramId.trim().length > 0
          && diagramsResponse.diagrams.some((diagram) => diagram.id === state.selectedDiagramId);

        return {
          ...state,
          selectedRecordId: recordId,
          researchNotes: notesResponse.researchNotes,
          diagrams: diagramsResponse.diagrams,
          selectedDiagramId: hasSelectedDiagram
            ? state.selectedDiagramId
            : (diagramsResponse.diagrams[0]?.id ?? ''),
          artifactsLoading: false,
          artifactsError: null,
        };
      });
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to load planning artifacts.');

      store.setState((state) => {
        if (nextVersion !== artifactsRequestVersion) {
          return state;
        }

        return {
          ...state,
          artifactsLoading: false,
          artifactsError: message,
        };
      });
    }
  }

  async function saveResearchNote(note: PlanningResearchNoteInput): Promise<void> {
    const snapshot = store.getState();
    const recordId = snapshot.selectedRecordId.trim();
    if (!recordId) {
      setStatus('Select a planning record before saving research notes.');
      return;
    }

    const nextVersion = ++artifactsMutationVersion;

    store.setState((state) => ({
      ...state,
      artifactsSaving: true,
      artifactsError: null,
    }));

    try {
      await savePlanningResearchNote(recordId, note);
      await loadArtifacts(recordId);

      store.setState((state) => {
        if (nextVersion !== artifactsMutationVersion) {
          return state;
        }

        return {
          ...state,
          artifactsSaving: false,
          artifactsError: null,
          statusMessage: 'Research note saved.',
        };
      });
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to save research note.');

      store.setState((state) => {
        if (nextVersion !== artifactsMutationVersion) {
          return state;
        }

        return {
          ...state,
          artifactsSaving: false,
          artifactsError: message,
          statusMessage: `Research note save failed: ${message}`,
        };
      });
    }
  }

  async function removeResearchNote(noteId: string): Promise<void> {
    const snapshot = store.getState();
    const recordId = snapshot.selectedRecordId.trim();
    const normalizedNoteId = noteId.trim();
    if (!recordId || !normalizedNoteId) {
      return;
    }

    const nextVersion = ++artifactsMutationVersion;

    store.setState((state) => ({
      ...state,
      artifactsDeleting: true,
      artifactsError: null,
    }));

    try {
      await deletePlanningResearchNote(recordId, normalizedNoteId);
      await loadArtifacts(recordId);

      store.setState((state) => {
        if (nextVersion !== artifactsMutationVersion) {
          return state;
        }

        return {
          ...state,
          artifactsDeleting: false,
          artifactsError: null,
          statusMessage: 'Research note deleted.',
        };
      });
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to delete research note.');

      store.setState((state) => {
        if (nextVersion !== artifactsMutationVersion) {
          return state;
        }

        return {
          ...state,
          artifactsDeleting: false,
          artifactsError: message,
          statusMessage: `Research note delete failed: ${message}`,
        };
      });
    }
  }

  async function compareRecords(): Promise<void> {
    const stateSnapshot = store.getState();
    if (stateSnapshot.mutatingBlocked) {
      setStatus(`Compare blocked: ${stateSnapshot.mutatingReason || 'policy gate active'}.`);
      return;
    }

    const scopes = selectedScopes(stateSnapshot);
    if (scopes.length === 0) {
      setStatus('Compare requires at least one scope.');
      return;
    }

    const nextVersion = ++compareRequestVersion;

    store.setState((state) => ({
      ...state,
      comparing: true,
      error: null,
      intentToken: null,
      reviewedConflictKeys: [],
      conflictRows: [],
    }));

    try {
      const response = await comparePlanningRecords({
        userId: stateSnapshot.userId,
        repoId: stateSnapshot.repoId,
        scopes,
        query: stateSnapshot.query,
        sessionId: stateSnapshot.sessionId || undefined,
        idempotencyKey: buildIdempotencyKey('planning-compare'),
      });

      const gateState = normalizeGateState(
        String(response.gateState || response.compareReceipt?.gateState || PLANNING_GATE_INSUFFICIENT_DATA)
      );
      const gateReason =
        String(response.reason || response.compareReceipt?.reason || '').trim() ||
        'Compare completed without an explicit gate reason.';
      const conflictRows = buildPlanningConflictRows(response.planningRecords);
      const mergeTargetFallback = response.planningRecords[0]?.recordId || '';

      store.setState((state) => {
        if (nextVersion !== compareRequestVersion) {
          return state;
        }

        return {
          ...state,
          compareResponse: response,
          gateState,
          gateReason,
          conflictRows,
          reviewedConflictKeys: [],
          mergeTargetId: state.mergeTargetId || mergeTargetFallback,
          comparing: false,
          error: null,
          statusMessage: `Planning compare completed (${gateState}).`,
        };
      });
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to compare planning records.');

      store.setState((state) => {
        if (nextVersion !== compareRequestVersion) {
          return state;
        }

        return {
          ...state,
          compareResponse: null,
          conflictRows: [],
          reviewedConflictKeys: [],
          intentToken: null,
          comparing: false,
          error: message,
          statusMessage: `Planning compare failed: ${message}`,
        };
      });
    }
  }

  async function createRecord(): Promise<void> {
    const stateSnapshot = store.getState();
    const acceptanceCriteria = normalizeAcceptanceCriteriaInput(stateSnapshot.createAcceptanceCriteria);

    if (stateSnapshot.mutatingBlocked) {
      setStatus(`Create blocked: ${stateSnapshot.mutatingReason || 'policy gate active'}.`);
      return;
    }

    const title = stateSnapshot.createTitle.trim();
    if (!title) {
      setStatus('Create record requires a title.');
      return;
    }

    store.setState((state) => ({
      ...state,
      creating: true,
      error: null,
      statusMessage: 'Creating planning record...',
    }));

    try {
      await createPlanningRecord({
        userId: stateSnapshot.userId,
        repoId: stateSnapshot.repoId,
        scope: stateSnapshot.createScope,
        title,
        summary: stateSnapshot.createSummary,
        acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : undefined,
        acceptanceCriteriaText: stateSnapshot.createAcceptanceCriteria.trim() || undefined,
        state: stateSnapshot.createState,
        idempotencyKey: buildIdempotencyKey('planning-create'),
      });

      store.setState((state) => ({
        ...state,
        creating: false,
        createTitle: '',
        createSummary: '',
        createAcceptanceCriteria: '',
        statusMessage: 'Planning record created.',
      }));

      await listRecords();
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to create planning record.');

      store.setState((state) => ({
        ...state,
        creating: false,
        error: message,
        statusMessage: `Planning create failed: ${message}`,
      }));
    }
  }

  async function createIdeaBatch(): Promise<void> {
    const stateSnapshot = store.getState();
    const ideas = normalizeIdeaLines(stateSnapshot.ideaDraft);
    const targetRepoIds = normalizeRepoTargetsInput(stateSnapshot.ideaTargetRepos);

    if (stateSnapshot.mutatingBlocked) {
      setStatus(`Idea capture blocked: ${stateSnapshot.mutatingReason || 'policy gate active'}.`);
      return;
    }

    if (ideas.length === 0) {
      setStatus('Type one or more bullet ideas before adding them.');
      return;
    }

    store.setState((state) => ({
      ...state,
      creating: true,
      error: null,
      statusMessage: `Creating ${ideas.length} idea record${ideas.length === 1 ? '' : 's'}...`,
    }));

    try {
      for (const idea of ideas) {
        await createPlanningRecord({
          userId: stateSnapshot.userId,
          repoId: stateSnapshot.repoId,
          scope: stateSnapshot.createScope,
          title: idea,
          summary: idea,
          state: 'thought',
          targetRepoIds: targetRepoIds.length > 0 ? targetRepoIds : undefined,
          idempotencyKey: buildIdempotencyKey('planning-idea'),
        });
      }

      store.setState((state) => ({
        ...state,
        creating: false,
        ideaDraft: '',
        statusMessage: `Captured ${ideas.length} idea record${ideas.length === 1 ? '' : 's'}.`,
      }));

      await listRecords();
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to create idea records.');

      store.setState((state) => ({
        ...state,
        creating: false,
        error: message,
        statusMessage: `Idea capture failed: ${message}`,
      }));
    }
  }

  async function updateIdea(
    recordId: string,
    input: {
      title?: string;
      summary?: string;
      targetRepoIds?: string[];
      acceptanceCriteriaText?: string;
      state?: string;
    }
  ): Promise<void> {
    const stateSnapshot = store.getState();
    const normalizedRecordId = recordId.trim();
    if (!normalizedRecordId) {
      return;
    }

    if (stateSnapshot.mutatingBlocked) {
      setStatus(`Idea update blocked: ${stateSnapshot.mutatingReason || 'policy gate active'}.`);
      return;
    }

    store.setState((state) => ({
      ...state,
      updatingRecordId: normalizedRecordId,
      error: null,
      statusMessage: 'Saving idea changes...',
    }));

    try {
      await updatePlanningRecord(normalizedRecordId, {
        userId: stateSnapshot.userId,
        repoId: stateSnapshot.repoId,
        title: input.title,
        summary: input.summary,
        targetRepoIds: input.targetRepoIds,
        acceptanceCriteriaText: input.acceptanceCriteriaText,
        acceptanceCriteria: normalizeAcceptanceCriteriaInput(input.acceptanceCriteriaText || ''),
        state: input.state,
      });

      store.setState((state) => ({
        ...state,
        updatingRecordId: null,
        statusMessage: 'Idea updated.',
      }));

      await listRecords();
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to update idea.');

      store.setState((state) => ({
        ...state,
        updatingRecordId: null,
        error: message,
        statusMessage: `Idea update failed: ${message}`,
      }));
    }
  }

  async function compileSelectedIdeas(): Promise<string | null> {
    const stateSnapshot = store.getState();
    const selectedIdeas = stateSnapshot.records.filter(
      (record) => stateSnapshot.selectedIdeaIds.includes(record.recordId) && isIdeaRecord(record)
    );

    if (selectedIdeas.length === 0) {
      setStatus('Select one or more ideas before compiling a plan.');
      return null;
    }

    store.setState((state) => ({
      ...state,
      compiling: true,
      error: null,
      statusMessage: 'Creating SDK planning session...',
    }));

    try {
      const response = await createSdkSession({});
      const sessionId = String(response.sessionId || '').trim();
      if (!sessionId) {
        throw new Error('sdk_session_missing');
      }

      const allTargetRepoIds = [...new Set(selectedIdeas.flatMap((record) =>
        Array.isArray(record.targetRepoIds) ? record.targetRepoIds.map((entry) => String(entry).trim()).filter(Boolean) : []
      ))].sort((left, right) => left.localeCompare(right));

      const effectiveTargets = allTargetRepoIds.length > 0
        ? allTargetRepoIds
        : (stateSnapshot.repoId.trim() ? [stateSnapshot.repoId.trim()] : []);

      const prompt = [
        'Create a repo-targeted implementation plan from the following planning ideas.',
        effectiveTargets.length > 0 ? `Target repositories: ${effectiveTargets.join(', ')}` : 'Target repositories: determine from the supplied idea context.',
        'Requirements:',
        '- Produce a concrete implementation plan with phases, risks, validation, and rollout guidance.',
        '- Do not execute changes.',
        '- Keep the output ready for follow-up implementation work.',
        'Ideas:',
        ...selectedIdeas.map((record, index) => {
          const acceptance = Array.isArray(record.acceptanceCriteria) && record.acceptanceCriteria.length > 0
            ? ` Acceptance criteria: ${record.acceptanceCriteria.join('; ')}`
            : '';
          const targets = Array.isArray(record.targetRepoIds) && record.targetRepoIds.length > 0
            ? ` Targets: ${record.targetRepoIds.join(', ')}.`
            : '';
          return `${index + 1}. ${String(record.title || '').trim() || '(untitled idea)'}${String(record.summary || '').trim() ? ` Summary: ${String(record.summary).trim()}.` : ''}${targets}${acceptance}`;
        }),
      ].join('\n');

      await sendSdkMessage({
        sessionId,
        prompt,
      });

      await sdkSessionsStore.loadSessions();
      sdkSessionsStore.selectSession(sessionId);

      store.setState((state) => ({
        ...state,
        compiling: false,
        statusMessage: `Plan compilation started in SDK session ${sessionId}.`,
      }));

      return sessionId;
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to compile ideas into an SDK planning session.');

      store.setState((state) => ({
        ...state,
        compiling: false,
        error: message,
        statusMessage: `Idea compile failed: ${message}`,
      }));

      return null;
    }
  }

  async function prepareMergeIntent(): Promise<void> {
    const stateSnapshot = store.getState();

    if (stateSnapshot.mutatingBlocked) {
      setStatus(`Prepare intent blocked: ${stateSnapshot.mutatingReason || 'policy gate active'}.`);
      return;
    }

    const compareReceipt = readCompareReceipt(stateSnapshot.compareResponse);
    if (!compareReceipt || !compareReceipt.receiptId) {
      setStatus('Prepare intent requires a compare receipt. Run compare again.');
      return;
    }

    const targetId = stateSnapshot.mergeTargetId.trim();
    if (!targetId) {
      setStatus('Prepare intent requires a merge target.');
      return;
    }

    const sourceIds = (stateSnapshot.compareResponse?.planningRecords || [])
      .map((entry) => String(entry.recordId || '').trim())
      .filter((entry) => entry.length > 0);

    if (sourceIds.length === 0) {
      setStatus('Prepare intent requires compare planning records.');
      return;
    }

    store.setState((state) => ({
      ...state,
      preparingIntent: true,
      error: null,
      statusMessage: 'Preparing merge intent...',
    }));

    try {
      const response = await preparePlanningMergeIntent({
        userId: stateSnapshot.userId,
        repoId: stateSnapshot.repoId,
        compareReceiptId: compareReceipt.receiptId,
        targetId,
        sourceIds,
        ttlMs: PLANNING_MERGE_INTENT_DEFAULT_TTL_MS,
      });

      if (!response.intentToken) {
        throw new Error('merge_intent_token_missing');
      }

      store.setState((state) => ({
        ...state,
        preparingIntent: false,
        intentToken: response.intentToken ?? null,
        error: null,
        statusMessage: 'Planning merge intent prepared.',
      }));
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to prepare merge intent.');

      store.setState((state) => ({
        ...state,
        preparingIntent: false,
        error: message,
        statusMessage: `Planning intent failed: ${message}`,
      }));
    }
  }

  async function confirmMerge(): Promise<void> {
    const stateSnapshot = store.getState();

    if (stateSnapshot.mutatingBlocked) {
      setStatus(`Merge blocked: ${stateSnapshot.mutatingReason || 'policy gate active'}.`);
      return;
    }

    if (!planningGateAllowsMerge(stateSnapshot.gateState)) {
      setStatus(`Merge blocked by gate state: ${stateSnapshot.gateState}.`);
      return;
    }

    if (!hasReviewedAllPlanningConflicts(stateSnapshot.conflictRows, stateSnapshot.reviewedConflictKeys)) {
      setStatus('Merge blocked: review all precedence conflicts first.');
      return;
    }

    const compareReceipt = readCompareReceipt(stateSnapshot.compareResponse);
    const token = stateSnapshot.intentToken;

    if (!compareReceipt || !compareReceipt.receiptId || !token) {
      setStatus('Merge blocked: missing compare receipt or intent token.');
      return;
    }

    const sourceIds = (stateSnapshot.compareResponse?.planningRecords || [])
      .map((entry) => String(entry.recordId || '').trim())
      .filter((entry) => entry.length > 0);

    const payload = {
      userId: stateSnapshot.userId,
      repoId: stateSnapshot.repoId,
      idempotencyKey: `merge-${token.tokenId}`,
      compareReceiptId: compareReceipt.receiptId,
      tokenId: token.tokenId,
      targetId: stateSnapshot.mergeTargetId.trim() || String(token.targetId || '').trim(),
      compareHash: String(compareReceipt.compareHash || token.compareHash || '').trim(),
      sourceIdsHash: String(compareReceipt.sourceIdsHash || token.sourceIdsHash || '').trim(),
      sourceIds,
      versionVector: compareReceipt.versionVector || null,
      conflictSummary: stateSnapshot.conflictRows.length
        ? stateSnapshot.conflictRows.map((row) => `${row.field}=${row.winnerScope}`).join(', ')
        : 'no precedence conflicts',
    };

    if (!payload.targetId || !payload.compareHash || !payload.sourceIdsHash) {
      setStatus('Merge blocked: compare snapshot metadata is incomplete. Run compare again.');
      return;
    }

    store.setState((state) => ({
      ...state,
      merging: true,
      error: null,
      statusMessage: 'Confirming planning merge...',
    }));

    try {
      const response = await mergePlanningRecords(payload);
      const mergeEvent = response.mergeEvent && typeof response.mergeEvent === 'object'
        ? (response.mergeEvent as Record<string, unknown>)
        : null;
      const consumedAt =
        typeof mergeEvent?.consumedAt === 'string' && mergeEvent.consumedAt.trim()
          ? mergeEvent.consumedAt
          : new Date().toISOString();

      store.setState((state) => ({
        ...state,
        merging: false,
        intentToken: state.intentToken
          ? {
            ...state.intentToken,
            consumedAt,
          }
          : state.intentToken,
        error: null,
        statusMessage: 'Planning merge confirmed and recorded.',
      }));

      await listRecords();
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to confirm planning merge.');

      store.setState((state) => ({
        ...state,
        merging: false,
        error: message,
        statusMessage: `Planning merge failed: ${message}`,
      }));
    }
  }

  async function loadInitial(): Promise<void> {
    store.setState((state) => ({
      ...state,
      loading: true,
      error: null,
      statusMessage: 'Loading planning state...',
    }));

    await Promise.allSettled([refreshPolicyPreflight(false), listRecords()]);

    store.setState((state) => ({
      ...state,
      loading: false,
      statusMessage: state.error ? state.statusMessage : 'Planning state loaded.',
    }));
  }

  function setUserId(value: string): void {
    store.setState((state) => ({
      ...state,
      userId: value,
    }));
  }

  function setRepoId(value: string): void {
    store.setState((state) => ({
      ...state,
      repoId: value,
    }));
  }

  function setQuery(value: string): void {
    store.setState((state) => ({
      ...state,
      query: value,
    }));
  }

  function setSessionId(value: string): void {
    store.setState((state) => ({
      ...state,
      sessionId: value,
    }));
  }

  function setScope(scope: 'user' | 'repo' | 'global', checked: boolean): void {
    store.setState((state) => {
      if (scope === 'user') {
        return { ...state, scopeUser: checked };
      }

      if (scope === 'repo') {
        return { ...state, scopeRepo: checked };
      }

      return { ...state, scopeGlobal: checked };
    });
  }

  function setCreateScope(value: 'user' | 'repo' | 'global'): void {
    store.setState((state) => ({
      ...state,
      createScope: value,
    }));
  }

  function setCreateState(value: string): void {
    store.setState((state) => ({
      ...state,
      createState: value,
    }));
  }

  function setCreateTitle(value: string): void {
    store.setState((state) => ({
      ...state,
      createTitle: value,
    }));
  }

  function setCreateSummary(value: string): void {
    store.setState((state) => ({
      ...state,
      createSummary: value,
    }));
  }

  function setCreateAcceptanceCriteria(value: string): void {
    store.setState((state) => ({
      ...state,
      createAcceptanceCriteria: value,
    }));
  }

  function setIdeaDraft(value: string): void {
    store.setState((state) => ({
      ...state,
      ideaDraft: value,
    }));
  }

  function setIdeaTargetRepos(value: string): void {
    store.setState((state) => ({
      ...state,
      ideaTargetRepos: value,
    }));
  }

  function toggleIdeaSelected(recordId: string, checked: boolean): void {
    const normalizedRecordId = recordId.trim();
    if (!normalizedRecordId) {
      return;
    }

    store.setState((state) => {
      const nextIds = new Set(state.selectedIdeaIds);
      if (checked) {
        nextIds.add(normalizedRecordId);
      } else {
        nextIds.delete(normalizedRecordId);
      }

      return {
        ...state,
        selectedIdeaIds: [...nextIds],
      };
    });
  }

  function setSelectedRecordId(value: string): void {
    const selectedRecordId = value.trim();

    store.setState((state) => ({
      ...state,
      selectedRecordId,
      selectedDiagramId: '',
      researchNotes: [],
      diagrams: [],
      artifactsError: null,
    }));

    void loadArtifacts(selectedRecordId);
  }

  function setSelectedDiagramId(value: string): void {
    const selectedDiagramId = value.trim();
    store.setState((state) => {
      const isKnownDiagram = state.diagrams.some((diagram) => diagram.id === selectedDiagramId);
      return {
        ...state,
        selectedDiagramId: isKnownDiagram ? selectedDiagramId : '',
      };
    });
  }

  function setMergeTargetId(value: string): void {
    store.setState((state) => ({
      ...state,
      mergeTargetId: value,
    }));
  }

  function toggleConflictReviewed(conflictKey: string, checked: boolean): void {
    const normalizedKey = conflictKey.trim();
    if (!normalizedKey) {
      return;
    }

    store.setState((state) => {
      const nextSet = new Set(state.reviewedConflictKeys);
      if (checked) {
        nextSet.add(normalizedKey);
      } else {
        nextSet.delete(normalizedKey);
      }

      return {
        ...state,
        reviewedConflictKeys: [...nextSet],
      };
    });
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    applyCatalogRepoContext,
    loadInitial,
    refreshPolicyPreflight,
    listRecords,
    searchRecords,
    loadArtifacts,
    saveResearchNote,
    removeResearchNote,
    compareRecords,
    createRecord,
    createIdeaBatch,
    updateIdea,
    compileSelectedIdeas,
    prepareMergeIntent,
    confirmMerge,
    setUserId,
    setRepoId,
    setQuery,
    setSessionId,
    setScope,
    setCreateScope,
    setCreateState,
    setCreateTitle,
    setCreateSummary,
    setCreateAcceptanceCriteria,
    setIdeaDraft,
    setIdeaTargetRepos,
    toggleIdeaSelected,
    setSelectedRecordId,
    setSelectedDiagramId,
    setMergeTargetId,
    toggleConflictReviewed,
  };
}

export const planningStore = createPlanningStore();
