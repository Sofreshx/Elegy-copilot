import {
  buildPlanningIntakeDirectoryRef,
  buildPlanningRepositoryBacklogRef,
  buildPlanningRoadmapDirectoryRef,
  comparePlanningRecords,
  createPlanningIntakeArtifact,
  createPlanningRecord,
  createSdkSession,
  deletePlanningResearchNote,
  getSessionPlanText,
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
  upsertSessionPlan,
} from '../../lib/api';
import { createStore } from '../../lib/store';
import type {
  PlanningBacklogItem,
  PlanningBullet,
  CatalogRepoInventoryEntry,
  PlanningDraftItem,
  PlanningDiagram,
  PlanningCompareReceipt,
  PlanningCompareResponse,
  PlanningIntakeCategory,
  PlanningIntakeDirectoryRef,
  PlanningIntakeArtifact,
  PlanningLinkedPlanSession,
  PlanningLinkedSdkSession,
  PlanningMergeIntentToken,
  PlanningPlanOriginKind,
  PlanningRecordItem,
  PlanningRepositoryBacklogRef,
  PlanningRoadmapItem,
  PlanningRoadmapDirectoryRef,
  PlanningResearchNote,
  PlanningSearchResultItem,
  PolicyPreflightResponse,
} from '../../lib/types';
import { sessionsStore } from '../Sessions/sessionsStore';
import { sdkSessionsStore } from '../Sessions/sdkSessionsStore';

const PLANNING_GATE_PASS = 'pass';
const PLANNING_GATE_DEGRADED = 'degraded';
const PLANNING_GATE_INSUFFICIENT_DATA = 'insufficient-data';
const PLANNING_GATE_POLICY_BLOCKED = 'policy-blocked';
const PLANNING_GATE_AUTH_DENIED = 'auth-denied';
const PLANNING_MERGE_INTENT_DEFAULT_TTL_MS = 5 * 60 * 1000;
const PLANNING_ACTION_REQUEST_STATE = 'requested';
const PLANNING_LINKED_SDK_SESSION_STORAGE_KEY = 'instruction-engine.planning.linked-sdk-session.v1';
const PLANNING_LINKED_PLAN_SESSION_STORAGE_KEY = 'instruction-engine.planning.linked-plan-session.v1';
const PLANNING_LINKED_SDK_SESSION_WORKSPACE_KEY = '__workspace__';
const PLANNING_DIRECT_PLAN_ORIGIN_ID = '__direct__';

const IDEA_RECORD_STATES = new Set(['thought', 'research', 'pre-plan']);
type PlanningActionRequestKind = Extract<
  PlanningIntakeCategory,
  'audit-request' | 'roadmap-request' | 'review-prep' | 'commit-prep'
>;
type PlanningPrepRequestKind = Extract<PlanningActionRequestKind, 'review-prep' | 'commit-prep'>;

interface PlanningPlanSeedArtifact {
  id: string;
  kind: PlanningPlanOriginKind;
  category?: string;
  title: string;
  summary?: string;
  targetRepoIds?: string[];
  state?: string;
  repoId?: string;
  notes?: string[];
  acceptanceCriteria?: string[];
  backlogIds?: string[];
  planRefs?: string[];
}

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
  planningIntakeDirectory: PlanningIntakeDirectoryRef | null;
  repositoryBacklog: PlanningRepositoryBacklogRef | null;
  roadmapDirectory: PlanningRoadmapDirectoryRef | null;
  query: string;
  sessionId: string;
  scopeUser: boolean;
  scopeRepo: boolean;
  scopeGlobal: boolean;
  draftIdeas: PlanningDraftItem[];
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
  savingIdeaId: string | null;
  compiling: boolean;
  linkedPlanSession: PlanningLinkedPlanSession | null;
  linkedSdkSession: PlanningLinkedSdkSession | null;
  planTitleDraft: string;
  planContentDraft: string;
  planLoading: boolean;
  planSaving: boolean;
  planError: string | null;
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
  planningIntakeDirectory: null,
  repositoryBacklog: null,
  roadmapDirectory: null,
  query: '',
  sessionId: '',
  scopeUser: true,
  scopeRepo: true,
  scopeGlobal: true,
  draftIdeas: [],
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
  savingIdeaId: null,
  compiling: false,
  linkedPlanSession: null,
  linkedSdkSession: null,
  planTitleDraft: '',
  planContentDraft: '',
  planLoading: false,
  planSaving: false,
  planError: null,
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

function normalizeLinkedSdkSession(value: unknown): PlanningLinkedSdkSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : '';
  const source = typeof record.source === 'string' ? record.source.trim() : '';
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt.trim() : '';
  const repoId = typeof record.repoId === 'string' && record.repoId.trim() ? record.repoId.trim() : null;
  const promptPreview = typeof record.promptPreview === 'string' && record.promptPreview.trim()
    ? record.promptPreview.trim()
    : undefined;
  const selectedIdeaIds = Array.isArray(record.selectedIdeaIds)
    ? [...new Set(record.selectedIdeaIds.map((entry) => String(entry || '').trim()).filter(Boolean))]
    : [];
  const selectedIdeaTitles = Array.isArray(record.selectedIdeaTitles)
    ? [...new Set(record.selectedIdeaTitles.map((entry) => String(entry || '').trim()).filter(Boolean))]
    : [];
  const targetRepoIds = Array.isArray(record.targetRepoIds)
    ? [...new Set(record.targetRepoIds.map((entry) => String(entry || '').trim()).filter(Boolean))]
    : [];

  if (!sessionId || source !== 'compile-selected-ideas' || !createdAt) {
    return null;
  }

  return {
    sessionId,
    repoId,
    source: 'compile-selected-ideas',
    createdAt,
    selectedIdeaIds,
    selectedIdeaTitles,
    targetRepoIds,
    promptPreview,
  };
}

function resolveLinkedSdkSessionStorageScope(repoId: string | null | undefined): string {
  const normalizedRepoId = typeof repoId === 'string' ? repoId.trim() : '';
  return normalizedRepoId || PLANNING_LINKED_SDK_SESSION_WORKSPACE_KEY;
}

function readLinkedSdkSessionMap(): Record<string, PlanningLinkedSdkSession> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(PLANNING_LINKED_SDK_SESSION_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, PlanningLinkedSdkSession>>(
      (accumulator, [scope, value]) => {
        const normalized = normalizeLinkedSdkSession(value);
        if (normalized) {
          accumulator[scope] = normalized;
        }
        return accumulator;
      },
      {}
    );
  } catch {
    return {};
  }
}

function readLinkedSdkSession(repoId: string | null | undefined): PlanningLinkedSdkSession | null {
  const scope = resolveLinkedSdkSessionStorageScope(repoId);
  return readLinkedSdkSessionMap()[scope] ?? null;
}

function persistLinkedSdkSession(linkedSdkSession: PlanningLinkedSdkSession): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    const scope = resolveLinkedSdkSessionStorageScope(linkedSdkSession.repoId);
    const nextMap = {
      ...readLinkedSdkSessionMap(),
      [scope]: linkedSdkSession,
    };
    window.localStorage.setItem(PLANNING_LINKED_SDK_SESSION_STORAGE_KEY, JSON.stringify(nextMap));
  } catch {
    // Local persistence is best-effort only for SDK linkage metadata.
  }
}

function normalizeLinkedPlanSession(value: unknown): PlanningLinkedPlanSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : '';
  const source = typeof record.source === 'string' ? record.source.trim() : '';
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt.trim() : '';
  const updatedAt = typeof record.updatedAt === 'string' && record.updatedAt.trim() ? record.updatedAt.trim() : undefined;
  const repoId = typeof record.repoId === 'string' && record.repoId.trim() ? record.repoId.trim() : null;
  const originKind = typeof record.originKind === 'string' && record.originKind.trim()
    ? (record.originKind.trim() as PlanningPlanOriginKind)
    : undefined;
  const originArtifactId = typeof record.originArtifactId === 'string' && record.originArtifactId.trim()
    ? record.originArtifactId.trim()
    : undefined;
  const seedArtifactId = typeof record.seedArtifactId === 'string' && record.seedArtifactId.trim()
    ? record.seedArtifactId.trim()
    : undefined;
  const seedArtifactCategory = typeof record.seedArtifactCategory === 'string' && record.seedArtifactCategory.trim()
    ? (record.seedArtifactCategory.trim() as PlanningIntakeCategory)
    : undefined;
  const seedArtifactTitle = typeof record.seedArtifactTitle === 'string' && record.seedArtifactTitle.trim()
    ? record.seedArtifactTitle.trim()
    : undefined;

  if (
    !sessionId
    || !createdAt
    || ![
      'create-plan',
      'seed-from-intake',
      'seed-from-bullet',
      'seed-from-backlog',
      'seed-from-roadmap',
    ].includes(source)
  ) {
    return null;
  }

  const normalizedOriginKind = originKind
    || (source === 'seed-from-intake'
      ? 'intake'
      : (source === 'seed-from-bullet'
        ? 'bullet'
        : (source === 'seed-from-backlog'
          ? 'backlog'
          : (source === 'seed-from-roadmap' ? 'roadmap' : 'direct'))));
  const normalizedOriginArtifactId =
    originArtifactId
    || seedArtifactId
    || (normalizedOriginKind === 'direct' ? PLANNING_DIRECT_PLAN_ORIGIN_ID : undefined);

  return {
    sessionId,
    repoId,
    source: source as PlanningLinkedPlanSession['source'],
    originKind: normalizedOriginKind,
    originArtifactId: normalizedOriginArtifactId,
    createdAt,
    updatedAt,
    seedArtifactId,
    seedArtifactCategory,
    seedArtifactTitle,
  };
}

function readLinkedPlanSessionMap(): Record<string, PlanningLinkedPlanSession> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(PLANNING_LINKED_PLAN_SESSION_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, PlanningLinkedPlanSession>>(
      (accumulator, [scope, value]) => {
        const normalized = normalizeLinkedPlanSession(value);
        if (normalized) {
          accumulator[scope] = normalized;
        }
        return accumulator;
      },
      {}
    );
  } catch {
    return {};
  }
}

function normalizePlanOriginKind(
  value: PlanningPlanOriginKind | string | null | undefined,
  fallback: PlanningPlanOriginKind = 'direct'
): PlanningPlanOriginKind {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'intake') return 'intake';
  if (normalized === 'bullet') return 'bullet';
  if (normalized === 'backlog') return 'backlog';
  if (normalized === 'roadmap') return 'roadmap';
  if (normalized === 'direct') return 'direct';
  return fallback;
}

function resolveLinkedPlanSessionStorageScope(input: {
  repoId?: string | null;
  originKind?: PlanningPlanOriginKind | string | null;
  originArtifactId?: string | null;
}): string {
  const repoScope = resolveLinkedSdkSessionStorageScope(input.repoId);
  const originKind = normalizePlanOriginKind(input.originKind, 'direct');
  const originArtifactId = typeof input.originArtifactId === 'string' && input.originArtifactId.trim()
    ? input.originArtifactId.trim()
    : PLANNING_DIRECT_PLAN_ORIGIN_ID;
  return `${repoScope}::${originKind}::${originArtifactId}::planning`;
}

function readLinkedPlanSession(input: {
  repoId?: string | null;
  originKind?: PlanningPlanOriginKind | string | null;
  originArtifactId?: string | null;
}): PlanningLinkedPlanSession | null {
  const nextScope = resolveLinkedPlanSessionStorageScope(input);
  const legacyScope = resolveLinkedSdkSessionStorageScope(input.repoId);
  const planSessions = readLinkedPlanSessionMap();
  return planSessions[nextScope]
    ?? (
      normalizePlanOriginKind(input.originKind, 'direct') === 'direct'
      && (!input.originArtifactId || input.originArtifactId === PLANNING_DIRECT_PLAN_ORIGIN_ID)
        ? (planSessions[legacyScope] ?? null)
        : null
    );
}

function persistLinkedPlanSession(linkedPlanSession: PlanningLinkedPlanSession): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    const scope = resolveLinkedPlanSessionStorageScope({
      repoId: linkedPlanSession.repoId,
      originKind: linkedPlanSession.originKind,
      originArtifactId: linkedPlanSession.originArtifactId,
    });
    const nextMap = {
      ...readLinkedPlanSessionMap(),
      [scope]: linkedPlanSession,
    };
    window.localStorage.setItem(PLANNING_LINKED_PLAN_SESSION_STORAGE_KEY, JSON.stringify(nextMap));
  } catch {
    // Local persistence is best-effort only for plan linkage metadata.
  }
}

function buildBlankPlanContent(input: {
  title: string;
  repoLabel?: string;
  repoId?: string;
  repoPath?: string;
}): string {
  const title = input.title.trim() || 'New plan';
  const lines = [
    `# ${title}`,
    '',
    '## Problem',
    '',
    `Describe the outcome for ${input.repoLabel || input.repoId || 'the selected repository'}.`,
    '',
    '## Scope',
    '',
    '- In scope:',
    '- Out of scope:',
    '',
    '## Proposed Approach',
    '',
    `- Repository: ${input.repoId || '(determine from Catalog context)'}`,
    `- Path: ${input.repoPath || '(determine from Catalog context)'}`,
    '- Key decisions:',
    '',
    '## Todos',
    '',
    '- [ ] Define the first implementation slice',
    '- [ ] Validate the changed surfaces',
    '',
    '## Risks',
    '',
    '- Identify delivery, product, and migration risks here.',
    '',
    '## Validation',
    '',
    '- Narrow tests/build commands to run',
    '',
  ];

  return `${lines.join('\n')}\n`;
}

function buildSeededPlanContent(input: {
  title: string;
  repoLabel?: string;
  repoId?: string;
  repoPath?: string;
  artifact: PlanningPlanSeedArtifact;
}): string {
  const artifact = input.artifact;
  const seedTitle = input.title.trim() || artifact.title.trim() || 'Seeded plan';
  const targetRepos = artifact.targetRepoIds.length > 0 ? artifact.targetRepoIds.join(', ') : 'determine from Catalog context';
  const acceptanceCriteria = Array.isArray(artifact.acceptanceCriteria) && artifact.acceptanceCriteria.length > 0
    ? artifact.acceptanceCriteria.map((entry) => `- ${entry}`)
    : ['- Capture concrete acceptance criteria during plan authoring'];
  const originLabel =
    artifact.kind === 'bullet'
      ? 'Bullet'
      : artifact.kind === 'backlog'
        ? 'Backlog item'
        : artifact.kind === 'roadmap'
          ? 'Roadmap item'
          : artifact.kind === 'intake'
            ? 'Intake artifact'
            : 'Planning artifact';
  const originDetails = [
    `- Origin kind: ${artifact.kind}`,
    `- Origin id: ${artifact.id}`,
    artifact.state ? `- Origin state: ${artifact.state}` : '',
    Array.isArray(artifact.backlogIds) && artifact.backlogIds.length > 0
      ? `- Linked backlog IDs: ${artifact.backlogIds.join(', ')}`
      : '',
    Array.isArray(artifact.planRefs) && artifact.planRefs.length > 0
      ? `- Existing plan refs: ${artifact.planRefs.join(', ')}`
      : '',
  ].filter(Boolean);

  return [
    `# ${seedTitle}`,
    '',
    '## Seed Context',
    '',
    `- ${originLabel}: ${artifact.id}`,
    `- Source title: ${artifact.title}`,
    `- Target repositories: ${targetRepos}`,
    ...originDetails,
    '',
    '## Problem',
    '',
    artifact.summary || `Plan the follow-up for ${artifact.title}.`,
    '',
    '## Proposed Approach',
    '',
    `- Active repository: ${input.repoLabel || input.repoId || 'selected Catalog repo'}`,
    `- Active path: ${input.repoPath || '(determine from Catalog context)'}`,
    '- Translate the seeded intake/request into explicit implementation steps.',
    '- Keep backlog and roadmap promotion explicit after plan review.',
    '',
    '## Acceptance Criteria',
    '',
    ...acceptanceCriteria,
    '',
    '## Todos',
    '',
    '- [ ] Confirm scope boundaries from the seeded request',
    '- [ ] Break implementation into validated steps',
    '- [ ] Record rollout and verification guidance',
    '',
    '## Notes',
    '',
    `Seeded from ${artifact.id}${artifact.category ? ` (${artifact.category})` : ''}.`,
    '',
  ].join('\n');
}

function normalizePlanSeedSource(artifact: PlanningPlanSeedArtifact | null | undefined): PlanningLinkedPlanSession['source'] {
  if (!artifact) {
    return 'create-plan';
  }
  if (artifact.kind === 'intake') return 'seed-from-intake';
  if (artifact.kind === 'bullet') return 'seed-from-bullet';
  if (artifact.kind === 'backlog') return 'seed-from-backlog';
  if (artifact.kind === 'roadmap') return 'seed-from-roadmap';
  return 'create-plan';
}

function normalizePlanSeedArtifact(
  artifact: PlanningPlanSeedArtifact | PlanningIntakeArtifact | PlanningBullet | PlanningBacklogItem | PlanningRoadmapItem | null | undefined
): PlanningPlanSeedArtifact | null {
  if (!artifact || typeof artifact !== 'object') {
    return null;
  }

  const id = String(artifact.id || '').trim();
  const title = String(artifact.title || '').trim();
  if (!id || !title) {
    return null;
  }

  const record = artifact as Record<string, unknown>;
  const inputKind = String(record.kind || '').trim().toLowerCase();
  const kind: PlanningPlanOriginKind =
    inputKind === 'planning.bullet.artifact'
      ? 'bullet'
      : inputKind === 'planning.intake.artifact'
        ? 'intake'
        : id.startsWith('PB-')
          ? 'bullet'
          : id.startsWith('RB-')
            ? 'backlog'
            : id.startsWith('RM-')
              ? 'roadmap'
              : 'direct';

  return {
    id,
    kind,
    category: String(record.category || '').trim() || undefined,
    title,
    summary: String(record.summary || '').trim() || undefined,
    targetRepoIds: Array.isArray(record.targetRepoIds)
      ? record.targetRepoIds.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [],
    state: String(record.state || record.planningState || record.status || record.phase || '').trim() || undefined,
    repoId: String(record.repoId || '').trim() || undefined,
    notes: Array.isArray(record.notes) ? record.notes.map((entry) => String(entry || '').trim()).filter(Boolean) : [],
    acceptanceCriteria: Array.isArray(record.acceptanceCriteria)
      ? record.acceptanceCriteria.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [],
    backlogIds: Array.isArray(record.backlogIds)
      ? record.backlogIds.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [],
    planRefs: Array.isArray(record.planRefs)
      ? record.planRefs.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [],
  };
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

function nowIsoString(): string {
  return new Date().toISOString();
}

function resolveDraftAcceptanceCriteria(
  draft: Pick<PlanningDraftItem, 'acceptanceCriteriaText' | 'acceptanceCriteria'>
): string[] {
  if (typeof draft.acceptanceCriteriaText === 'string' && draft.acceptanceCriteriaText.trim()) {
    return normalizeAcceptanceCriteriaInput(draft.acceptanceCriteriaText);
  }

  return Array.isArray(draft.acceptanceCriteria) ? draft.acceptanceCriteria.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
}

function normalizeIdeaPlanningState(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'research') return 'research';
  if (normalized === 'pre-plan') return 'pre-plan';
  return 'thought';
}

function resolveDraftSaveRepoId(
  draft: Pick<PlanningDraftItem, 'saveRepoId' | 'targetRepoIds'>,
  fallbackRepoId = ''
): string {
  const explicitSaveRepoId = typeof draft.saveRepoId === 'string' ? draft.saveRepoId.trim() : '';
  if (explicitSaveRepoId) {
    return explicitSaveRepoId;
  }

  const targetRepoIds = Array.isArray(draft.targetRepoIds)
    ? draft.targetRepoIds.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  if (targetRepoIds.length === 1) {
    return targetRepoIds[0];
  }

  return fallbackRepoId.trim();
}

function createDraftIdeaItem(
  title: string,
  targetRepoIds: string[],
  defaultSaveRepoId = ''
): PlanningDraftItem {
  const timestamp = nowIsoString();
  const normalizedTitle = title.trim();
  const normalizedSaveRepoId = (targetRepoIds.length === 1 ? targetRepoIds[0] : defaultSaveRepoId).trim();

  return {
    draftId: buildIdempotencyKey('planning-draft'),
    title: normalizedTitle,
    summary: normalizedTitle,
    acceptanceCriteria: [],
    acceptanceCriteriaText: '',
    targetRepoIds,
    saveRepoId: normalizedSaveRepoId || null,
    state: 'thought',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function humanizeActionRequestKind(kind: PlanningActionRequestKind): string {
  switch (kind) {
    case 'audit-request':
      return 'Audit request';
    case 'roadmap-request':
      return 'Roadmap proposal request';
    case 'review-prep':
      return 'Review prep';
    case 'commit-prep':
    default:
      return 'Commit prep';
  }
}

function buildActionRequestArtifact(
  kind: PlanningActionRequestKind,
  input: {
    title: string;
    notes?: string;
    targetRepoIds?: string[];
  }
): {
  category: PlanningActionRequestKind;
  title: string;
  summary: string;
  acceptanceCriteria: string[];
  targetRepoIds: string[];
  planningState: string;
} {
  const normalizedTitle = input.title.trim();
  const normalizedNotes = String(input.notes || '').trim();
  const targetRepoIds = Array.isArray(input.targetRepoIds)
    ? input.targetRepoIds.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];

  if (kind === 'review-prep') {
    return {
      category: kind,
      title: normalizedTitle,
      summary: [
        `Prepare an AI review package for "${normalizedTitle}" in the selected repository scope.`,
        normalizedNotes ? `Requested focus: ${normalizedNotes}` : '',
        'AI may prepare changed-file summaries, reviewer notes, risks, validation context, and open questions.',
        'AI must not perform the final git commit or any other autonomous repository action in this slice.',
      ].filter(Boolean).join(' '),
      acceptanceCriteria: [
        'Produce a repo-scoped review package that a human can inspect before any follow-up action.',
        'Include review-ready context such as changed-file summaries, risks, validation notes, or explicit open questions.',
        'Keep the result traceable in Planning intake and do not perform the final git commit.',
      ],
      targetRepoIds,
      planningState: PLANNING_ACTION_REQUEST_STATE,
    };
  }

  if (kind === 'commit-prep') {
    return {
      category: kind,
      title: normalizedTitle,
      summary: [
        `Prepare an AI commit-ready package for "${normalizedTitle}" in the selected repository scope.`,
        normalizedNotes ? `Requested focus: ${normalizedNotes}` : '',
        'AI may prepare commit-ready summaries, validation notes, and proposed commit messages for human review.',
        'AI must not execute the final git commit in this PREPARE-COMMIT-ONLY slice.',
      ].filter(Boolean).join(' '),
      acceptanceCriteria: [
        'Produce a repo-scoped commit-ready summary with explicit human-reviewable outputs.',
        'Include at least one proposed commit message plus the validation context needed before a human commits.',
        'Do not execute the final git commit or any autonomous repository mutation.',
      ],
      targetRepoIds,
      planningState: PLANNING_ACTION_REQUEST_STATE,
    };
  }

  if (kind === 'audit-request') {
    return {
      category: kind,
      title: normalizedTitle,
      summary: [
        `Request a repo-scoped audit for "${normalizedTitle}" in the selected repository scope.`,
        normalizedNotes ? `Audit focus: ${normalizedNotes}` : '',
        'Capture findings, risks, and recommended follow-up as a tracked Planning intake request.',
        'This workflow does not silently mutate roadmap, backlog, or repository documents.',
      ].filter(Boolean).join(' '),
      acceptanceCriteria: [
        'Produce a repo-scoped audit request that clearly states the intended scope and focus areas.',
        'Keep findings and follow-up recommendations traceable in Planning intake for later triage.',
        'Do not silently mutate roadmap, backlog, or other canonical repository documents in this slice.',
      ],
      targetRepoIds,
      planningState: PLANNING_ACTION_REQUEST_STATE,
    };
  }

  return {
    category: kind,
    title: normalizedTitle,
    summary: [
      `Request a repo-scoped roadmap proposal for "${normalizedTitle}" in the selected repository scope.`,
      normalizedNotes ? `Roadmap scope: ${normalizedNotes}` : '',
      'Create a tracked proposal/request artifact first so humans can review intent, sequencing, and scope before any roadmap doc changes.',
      'This workflow must not silently mutate docs/roadmaps or other canonical planning documents.',
    ].filter(Boolean).join(' '),
    acceptanceCriteria: [
      'Produce a repo-scoped roadmap proposal request with the intended scope, sequencing, and decision points.',
      'Create proposal/request artifacts first so roadmap changes remain explicit and reviewable in Planning.',
      'Do not silently mutate docs/roadmaps or other canonical planning documents in this slice.',
    ],
    targetRepoIds,
    planningState: PLANNING_ACTION_REQUEST_STATE,
  };
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
    const planningIntakeDirectory = buildPlanningIntakeDirectoryRef({
      repoId: catalogRepoContext?.repoId || undefined,
      repoPath: catalogRepoContext?.repoPath || undefined,
      repoLabel: catalogRepoContext?.repoLabel || undefined,
    });
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
      const persistedLinkedPlanSession = readLinkedPlanSession({
        repoId: catalogRepoContext?.repoId || '',
        originKind: 'direct',
        originArtifactId: PLANNING_DIRECT_PLAN_ORIGIN_ID,
      });
    const persistedLinkedSdkSession = readLinkedSdkSession(catalogRepoContext?.repoId || '');

    store.setState((state) => ({
      ...state,
      catalogRepoContext,
      planningIntakeDirectory,
      repositoryBacklog,
      roadmapDirectory,
      linkedPlanSession: persistedLinkedPlanSession ?? (
        state.linkedPlanSession
        && resolveLinkedSdkSessionStorageScope(state.linkedPlanSession.repoId) === resolveLinkedSdkSessionStorageScope(catalogRepoContext?.repoId || '')
          ? state.linkedPlanSession
          : null
      ),
      linkedSdkSession: persistedLinkedSdkSession ?? (
        state.linkedSdkSession
        && resolveLinkedSdkSessionStorageScope(state.linkedSdkSession.repoId) === resolveLinkedSdkSessionStorageScope(catalogRepoContext?.repoId || '')
          ? state.linkedSdkSession
          : null
      ),
      draftIdeas: state.draftIdeas.map((draft) => {
        if ((Array.isArray(draft.targetRepoIds) && draft.targetRepoIds.length > 0) || String(draft.saveRepoId || '').trim()) {
          return draft;
        }

        return {
          ...draft,
          saveRepoId: catalogRepoContext?.repoId || null,
          updatedAt: draft.updatedAt || nowIsoString(),
        };
      }),
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
    const defaultSaveRepoId = stateSnapshot.catalogRepoContext?.repoId || '';

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
      statusMessage: `Creating ${ideas.length} local planning draft${ideas.length === 1 ? '' : 's'}...`,
    }));

    try {
      const createdDrafts = ideas.map((idea) => createDraftIdeaItem(idea, targetRepoIds, defaultSaveRepoId));

      store.setState((state) => ({
        ...state,
        creating: false,
        draftIdeas: [...createdDrafts, ...state.draftIdeas],
        ideaDraft: '',
        statusMessage: `Captured ${ideas.length} idea record${ideas.length === 1 ? '' : 's'}.`,
      }));
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
      saveRepoId?: string | null;
      state?: string;
    }
  ): Promise<void> {
    const normalizedRecordId = recordId.trim();
    if (!normalizedRecordId) {
      return;
    }

    const stateSnapshot = store.getState();
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
      const updatedAt = nowIsoString();
      store.setState((state) => {
        const nextDrafts = state.draftIdeas.map((draft) => {
          if (draft.draftId !== normalizedRecordId) {
            return draft;
          }

          const acceptanceCriteriaText =
            input.acceptanceCriteriaText != null ? input.acceptanceCriteriaText : String(draft.acceptanceCriteriaText || '');

          return {
            ...draft,
            title: input.title != null ? input.title : draft.title,
            summary: input.summary != null ? input.summary : draft.summary,
            targetRepoIds: input.targetRepoIds != null ? input.targetRepoIds : draft.targetRepoIds,
            acceptanceCriteriaText,
            acceptanceCriteria: normalizeAcceptanceCriteriaInput(acceptanceCriteriaText),
            saveRepoId: input.saveRepoId != null ? input.saveRepoId : draft.saveRepoId,
            state: input.state != null ? input.state : draft.state,
            updatedAt,
          };
        });

        return {
          ...state,
          draftIdeas: nextDrafts,
          updatingRecordId: null,
          statusMessage: 'Draft updated locally.',
        };
      });
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
    const selectedIdeas = stateSnapshot.draftIdeas.filter(
      (record) => stateSnapshot.selectedIdeaIds.includes(record.draftId)
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
        [
          ...(Array.isArray(record.targetRepoIds) ? record.targetRepoIds.map((entry) => String(entry).trim()).filter(Boolean) : []),
          String(record.saveRepoId || '').trim(),
        ].filter(Boolean)
      ))].sort((left, right) => left.localeCompare(right));

      const effectiveTargets = allTargetRepoIds.length > 0
        ? allTargetRepoIds
        : (stateSnapshot.catalogRepoContext?.repoId?.trim() ? [stateSnapshot.catalogRepoContext.repoId.trim()] : []);

      const prompt = [
        'Create a repo-targeted implementation plan from the following planning ideas.',
        effectiveTargets.length > 0 ? `Target repositories: ${effectiveTargets.join(', ')}` : 'Target repositories: determine from the supplied idea context.',
        'Requirements:',
        '- Produce a concrete implementation plan with phases, risks, validation, and rollout guidance.',
        '- Do not execute changes.',
        '- Keep the output ready for follow-up implementation work.',
        'Ideas:',
        ...selectedIdeas.map((record, index) => {
          const acceptanceCriteria = resolveDraftAcceptanceCriteria(record);
          const acceptance = acceptanceCriteria.length > 0
            ? ` Acceptance criteria: ${acceptanceCriteria.join('; ')}`
            : '';
          const targets = Array.isArray(record.targetRepoIds) && record.targetRepoIds.length > 0
            ? ` Targets: ${record.targetRepoIds.join(', ')}.`
            : '';
          const saveTarget = String(record.saveRepoId || '').trim();
          const saveTargetText = saveTarget ? ` Save target: ${saveTarget}.` : '';
          return `${index + 1}. ${String(record.title || '').trim() || '(untitled idea)'}${String(record.summary || '').trim() ? ` Summary: ${String(record.summary).trim()}.` : ''}${targets}${saveTargetText}${acceptance}`;
        }),
      ].join('\n');

      await sendSdkMessage({
        sessionId,
        prompt,
      });

      await sdkSessionsStore.loadSessions();
      sdkSessionsStore.selectSession(sessionId);

      const linkedSdkSession: PlanningLinkedSdkSession = {
        sessionId,
        repoId: stateSnapshot.catalogRepoContext?.repoId?.trim() || null,
        source: 'compile-selected-ideas',
        createdAt: nowIsoString(),
        selectedIdeaIds: selectedIdeas.map((record) => record.draftId),
        selectedIdeaTitles: selectedIdeas
          .map((record) => String(record.title || '').trim())
          .filter((title) => title.length > 0),
        targetRepoIds: effectiveTargets,
        promptPreview: prompt.slice(0, 280),
      };
      persistLinkedSdkSession(linkedSdkSession);

      store.setState((state) => ({
        ...state,
        compiling: false,
        linkedSdkSession,
        statusMessage: `Plan compilation started in SDK session ${sessionId}. Linked from Planning for this workspace.`,
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

  function removeIdea(recordId: string): void {
    const normalizedRecordId = recordId.trim();
    if (!normalizedRecordId) {
      return;
    }

    store.setState((state) => ({
      ...state,
      draftIdeas: state.draftIdeas.filter((draft) => draft.draftId !== normalizedRecordId),
      selectedIdeaIds: state.selectedIdeaIds.filter((draftId) => draftId !== normalizedRecordId),
      updatingRecordId: state.updatingRecordId === normalizedRecordId ? null : state.updatingRecordId,
      savingIdeaId: state.savingIdeaId === normalizedRecordId ? null : state.savingIdeaId,
      statusMessage: 'Draft removed from the local planning inbox.',
    }));
  }

  function splitIdea(recordId: string): void {
    const normalizedRecordId = recordId.trim();
    if (!normalizedRecordId) {
      return;
    }

    store.setState((state) => {
      const draftIndex = state.draftIdeas.findIndex((draft) => draft.draftId === normalizedRecordId);
      if (draftIndex < 0) {
        return state;
      }

      const draft = state.draftIdeas[draftIndex];
      const targetRepoIds = Array.isArray(draft.targetRepoIds)
        ? draft.targetRepoIds.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [];
      if (targetRepoIds.length < 2) {
        return {
          ...state,
          statusMessage: 'Only multi-repo drafts need to be split before saving.',
        };
      }

      const replacementDrafts = targetRepoIds.map((targetRepoId) => ({
        ...draft,
        draftId: buildIdempotencyKey('planning-draft'),
        targetRepoIds: [targetRepoId],
        saveRepoId: targetRepoId,
        createdAt: nowIsoString(),
        updatedAt: nowIsoString(),
      }));
      const nextDraftIdeas = [
        ...state.draftIdeas.slice(0, draftIndex),
        ...replacementDrafts,
        ...state.draftIdeas.slice(draftIndex + 1),
      ];

      const selectedIdeaIds = new Set(state.selectedIdeaIds);
      const wasSelected = selectedIdeaIds.delete(normalizedRecordId);
      if (wasSelected) {
        replacementDrafts.forEach((draftEntry) => selectedIdeaIds.add(draftEntry.draftId));
      }

      return {
        ...state,
        draftIdeas: nextDraftIdeas,
        selectedIdeaIds: [...selectedIdeaIds],
        statusMessage: `Split draft into ${replacementDrafts.length} repo-specific draft${replacementDrafts.length === 1 ? '' : 's'}.`,
      };
    });
  }

  async function saveIdeaDraft(recordId: string, requestedRepoId?: string): Promise<void> {
    const normalizedRecordId = recordId.trim();
    if (!normalizedRecordId) {
      return;
    }

    const stateSnapshot = store.getState();
    if (stateSnapshot.mutatingBlocked) {
      setStatus(`Planning intake save blocked: ${stateSnapshot.mutatingReason || 'policy gate active'}.`);
      return;
    }

    const draft = stateSnapshot.draftIdeas.find((entry) => entry.draftId === normalizedRecordId);
    if (!draft) {
      setStatus('Draft not found. Refresh the planning inbox and try again.');
      return;
    }

    const title = String(draft.title || '').trim();
    if (!title) {
      setStatus('Saving to planning intake requires a draft title.');
      return;
    }

    const targetRepoIds = Array.isArray(draft.targetRepoIds)
      ? draft.targetRepoIds.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];

    const repoId = resolveDraftSaveRepoId(
      {
        ...draft,
        saveRepoId: typeof requestedRepoId === 'string' && requestedRepoId.trim() ? requestedRepoId.trim() : draft.saveRepoId,
      },
      stateSnapshot.catalogRepoContext?.repoId || '',
    );
    if (!repoId) {
      setStatus('Choose a Catalog repo before saving this draft to planning intake.');
      return;
    }

    store.setState((state) => ({
      ...state,
      savingIdeaId: normalizedRecordId,
      error: null,
      statusMessage: `Saving draft to planning intake for ${repoId}...`,
    }));

    try {
      const response = await createPlanningIntakeArtifact({
        repoId,
        artifact: {
          category: 'idea',
          title,
          summary: String(draft.summary || '').trim(),
          acceptanceCriteria: resolveDraftAcceptanceCriteria(draft),
          targetRepoIds,
          planningState: normalizeIdeaPlanningState(draft.state),
        },
      });
      const createdArtifactId = String(response.artifact?.id || '').trim();

      store.setState((state) => ({
        ...state,
        savingIdeaId: null,
        draftIdeas: state.draftIdeas.filter((entry) => entry.draftId !== normalizedRecordId),
        selectedIdeaIds: state.selectedIdeaIds.filter((draftId) => draftId !== normalizedRecordId),
        statusMessage: createdArtifactId
          ? `Saved draft to Planning Intake as ${createdArtifactId} for ${repoId}.`
          : `Saved draft to Planning Intake for ${repoId}.`,
      }));
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to save draft to planning intake.');

      store.setState((state) => ({
        ...state,
        savingIdeaId: null,
        error: message,
        statusMessage: `Planning intake save failed: ${message}`,
      }));
    }
  }

  async function loadLinkedPlan(): Promise<void> {
    const stateSnapshot = store.getState();
    const linkedPlanSession = stateSnapshot.linkedPlanSession;
    if (!linkedPlanSession?.sessionId) {
      store.setState((state) => ({
        ...state,
        planTitleDraft: '',
        planContentDraft: '',
        planLoading: false,
        planError: null,
      }));
      return;
    }

    store.setState((state) => ({
      ...state,
      planLoading: true,
      planError: null,
    }));

    try {
      const content = await getSessionPlanText(linkedPlanSession.sessionId);
      const firstHeading = content
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.startsWith('# '));

      store.setState((state) => ({
        ...state,
        planTitleDraft: firstHeading ? firstHeading.replace(/^#\s+/, '').trim() : state.planTitleDraft,
        planContentDraft: content,
        planLoading: false,
        planError: null,
        statusMessage: `Loaded linked plan ${linkedPlanSession.sessionId}.`,
      }));
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to load the linked plan.');
      store.setState((state) => ({
        ...state,
        planLoading: false,
        planError: message,
        error: message,
        statusMessage: `Plan load failed: ${message}`,
      }));
    }
  }

  async function savePlanDraft(input: {
    title?: string;
    content?: string;
    seedArtifact?: PlanningPlanSeedArtifact | PlanningIntakeArtifact | PlanningBullet | PlanningBacklogItem | PlanningRoadmapItem | null;
    createNewSession?: boolean;
  } = {}): Promise<string | null> {
    const stateSnapshot = store.getState();
    if (stateSnapshot.mutatingBlocked) {
      setStatus(`Plan authoring blocked: ${stateSnapshot.mutatingReason || 'policy gate active'}.`);
      return null;
    }

    const normalizedTitle = String(input.title ?? stateSnapshot.planTitleDraft ?? '').trim();
    const seedArtifact = normalizePlanSeedArtifact(input.seedArtifact);
    const originKind = seedArtifact?.kind ?? 'direct';
    const originArtifactId = seedArtifact?.id ?? PLANNING_DIRECT_PLAN_ORIGIN_ID;
    const existingLinkedPlanSession = input.createNewSession
      ? null
      : readLinkedPlanSession({
          repoId: stateSnapshot.catalogRepoContext?.repoId || '',
          originKind,
          originArtifactId,
        });
    const content = typeof input.content === 'string' && input.content.trim()
      ? input.content
      : (
        seedArtifact
          ? buildSeededPlanContent({
            title: normalizedTitle || seedArtifact.title,
            repoId: stateSnapshot.catalogRepoContext?.repoId,
            repoLabel: stateSnapshot.catalogRepoContext?.repoLabel,
            repoPath: stateSnapshot.catalogRepoContext?.repoPath,
            artifact: seedArtifact,
          })
          : buildBlankPlanContent({
            title: normalizedTitle || 'New plan',
            repoId: stateSnapshot.catalogRepoContext?.repoId,
            repoLabel: stateSnapshot.catalogRepoContext?.repoLabel,
            repoPath: stateSnapshot.catalogRepoContext?.repoPath,
          })
      );

    if (!content.trim()) {
      setStatus('Plan authoring requires content.');
      return null;
    }

    store.setState((state) => ({
      ...state,
      planSaving: true,
      planError: null,
        error: null,
        statusMessage: existingLinkedPlanSession && !input.createNewSession
          ? `Saving plan ${existingLinkedPlanSession.sessionId}...`
          : 'Creating plan session...',
      }));

    try {
      const response = await upsertSessionPlan({
        sessionId: input.createNewSession ? undefined : existingLinkedPlanSession?.sessionId,
        title: normalizedTitle || undefined,
        content,
        repoId: stateSnapshot.catalogRepoContext?.repoId || undefined,
        repoPath: stateSnapshot.catalogRepoContext?.repoPath || undefined,
        seedArtifact: seedArtifact
          ? {
            id: seedArtifact.id,
            kind: seedArtifact.kind,
            category: seedArtifact.category || seedArtifact.kind,
            title: seedArtifact.title,
            summary: seedArtifact.summary,
            targetRepoIds: seedArtifact.targetRepoIds,
            state: seedArtifact.state,
            repoId: seedArtifact.repoId,
            originKind: seedArtifact.kind,
            promotedPlanRefs: seedArtifact.planRefs,
            promotedBacklogRefs: seedArtifact.backlogIds,
          }
          : undefined,
      });
      const sessionId = String(response.sessionId || '').trim();
      if (!sessionId) {
        throw new Error('plan_session_missing');
      }

      const linkedPlanSession: PlanningLinkedPlanSession = {
        sessionId,
        repoId: stateSnapshot.catalogRepoContext?.repoId?.trim() || null,
        planPath: String(response.planPath || existingLinkedPlanSession?.planPath || '').trim() || undefined,
        source: normalizePlanSeedSource(seedArtifact),
        originKind,
        originArtifactId,
        createdAt: existingLinkedPlanSession?.sessionId === sessionId
          ? (existingLinkedPlanSession.createdAt || response.updatedAt)
          : response.updatedAt,
        updatedAt: response.updatedAt,
        seedArtifactId: seedArtifact?.id || undefined,
        seedArtifactCategory: seedArtifact?.kind === 'intake'
          ? (seedArtifact.category as PlanningIntakeCategory | undefined)
          : undefined,
        seedArtifactTitle: seedArtifact?.title,
      };
      persistLinkedPlanSession(linkedPlanSession);

      await sessionsStore.loadSessions();
      sessionsStore.selectSession(sessionId);

      store.setState((state) => ({
        ...state,
        linkedPlanSession,
        planTitleDraft: normalizedTitle || state.planTitleDraft,
        planContentDraft: response.content || content,
        planSaving: false,
        planError: null,
        statusMessage: response.created
          ? `Created linked plan session ${sessionId}.`
          : `Saved linked plan session ${sessionId}.`,
      }));

      return sessionId;
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to save the linked plan.');
      store.setState((state) => ({
        ...state,
        planSaving: false,
        planError: message,
        error: message,
        statusMessage: `Plan save failed: ${message}`,
      }));
      return null;
    }
  }

  async function createActionRequest(
    kind: PlanningActionRequestKind,
    input: {
      title: string;
      notes?: string;
      targetRepoIds?: string[];
      saveRepoId?: string | null;
    }
  ): Promise<string | null> {
    const stateSnapshot = store.getState();
    if (stateSnapshot.mutatingBlocked) {
      setStatus(`${humanizeActionRequestKind(kind)} blocked: ${stateSnapshot.mutatingReason || 'policy gate active'}.`);
      return null;
    }

    const title = String(input.title || '').trim();
    if (!title) {
      setStatus(`${humanizeActionRequestKind(kind)} requires a title.`);
      return null;
    }

    const targetRepoIds = Array.isArray(input.targetRepoIds)
      ? input.targetRepoIds.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const repoId = resolveDraftSaveRepoId(
      {
        saveRepoId: input.saveRepoId,
        targetRepoIds,
      },
      stateSnapshot.catalogRepoContext?.repoId || '',
    );

    if (!repoId) {
      setStatus(`Choose a Catalog repo before creating ${humanizeActionRequestKind(kind).toLowerCase()}.`);
      return null;
    }

    store.setState((state) => ({
      ...state,
      creating: true,
      error: null,
      statusMessage: `Creating ${humanizeActionRequestKind(kind).toLowerCase()} for ${repoId}...`,
    }));

    try {
      const response = await createPlanningIntakeArtifact({
        repoId,
        artifact: buildActionRequestArtifact(kind, {
          title,
          notes: input.notes,
          targetRepoIds,
        }),
      });
      const createdArtifactId = String(response.artifact?.id || '').trim();

      store.setState((state) => ({
        ...state,
        creating: false,
        statusMessage: createdArtifactId
          ? `${humanizeActionRequestKind(kind)} saved to Planning Intake as ${createdArtifactId} for ${repoId}.`
          : `${humanizeActionRequestKind(kind)} saved to Planning Intake for ${repoId}.`,
      }));

      return createdArtifactId || null;
    } catch (error) {
      const message = toErrorMessage(error, `Unable to create ${humanizeActionRequestKind(kind).toLowerCase()}.`);

      store.setState((state) => ({
        ...state,
        creating: false,
        error: message,
        statusMessage: `${humanizeActionRequestKind(kind)} failed: ${message}`,
      }));

      return null;
    }
  }

  async function createPrepRequest(
    kind: PlanningPrepRequestKind,
    input: {
      title: string;
      notes?: string;
      targetRepoIds?: string[];
      saveRepoId?: string | null;
    }
  ): Promise<string | null> {
    return createActionRequest(kind, input);
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

  function setPlanTitleDraft(value: string): void {
    store.setState((state) => ({
      ...state,
      planTitleDraft: value,
    }));
  }

  function setPlanContentDraft(value: string): void {
    store.setState((state) => ({
      ...state,
      planContentDraft: value,
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
    loadLinkedPlan,
    savePlanDraft,
    removeIdea,
    splitIdea,
    saveIdeaDraft,
    createActionRequest,
    createPrepRequest,
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
    setPlanTitleDraft,
    setPlanContentDraft,
    toggleIdeaSelected,
    setSelectedRecordId,
    setSelectedDiagramId,
    setMergeTargetId,
    toggleConflictReviewed,
  };
}

export const planningStore = createPlanningStore();
