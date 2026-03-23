import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  getCatalogAssetAnalytics,
  getSessionAgentUsage,
  getSessionHandoff,
  getSessionProposition,
  getSessionStructuredState,
  getSessionVerificationGuide,
  listSessionPlans,
} from '../../lib/api';
import type { SessionSummary } from '../../lib/types';
import type {
  CatalogAuditAssetSummary,
  CatalogAuditSessionSummary,
  SessionAgentUsageResponse,
  SessionArtifactSection,
  SessionClosureSummary,
  SessionExecutionState,
  SessionExecutionStateBlocker,
  SessionExecutionStateNode,
  SessionExecutionStateRef,
  SessionHandoffResponse,
  SessionIntentFrame,
  SessionPlanArtifact,
  SessionPropositionEntry,
  SessionPropositionResponse,
  SessionStructuredMeta,
  SessionStructuredExecutionOverlay,
  SessionStructuredNextUnit,
} from '../../lib/types';
import {
  formatTimestampLabel,
  humanizeToken,
  resolveSessionActiveLabel,
  resolveSessionReason,
  resolveSessionSourceLabel,
  resolveSessionStartedAt,
  resolveSessionStatus,
  resolveSessionUpdatedAt,
} from '../../lib/stateDiagnostics';

interface SessionDetailProps {
  session?: SessionSummary | null;
}

interface SessionAgentUsageEntry {
  agent: string;
  count: number;
}

interface SessionSkillUsageEntryView {
  assetId: string;
  assetKey: string;
  searchedCount: number;
  selectedCount: number;
  invocationCount: number;
  explicitInvocationCount: number;
  proxyInvocationCount: number;
  evidence: 'none' | 'proxy-only' | 'authoritative' | 'mixed';
  lastInvokedAt: string | null;
  toolNames: string[];
}

interface SessionArtifactsState {
  sessionId: string | null;
  sessionSource: string | null;
  sessionSandbox: string | null;
  loading: boolean;
  error: string | null;
  plans: SessionPlanArtifact[];
  nextUnit: SessionStructuredNextUnit | null;
  warnings: string[];
  proposition: string | null;
  latestPropositionEntry: SessionPropositionEntry | null;
  handoff: string | null;
  handoffParsed: SessionHandoffResponse['parsed'] | null;
  intentFrame: SessionIntentFrame | null;
  closureSummary: SessionClosureSummary | null;
  executionState: SessionExecutionState | null;
  executionOverlay: SessionStructuredExecutionOverlay | null;
  executionOverlayWarnings: string[];
  resumeMeta: SessionStructuredMeta['resume'] | null;
  reviewLedgerApproved: boolean | null;
  verificationGuide: string | null;
  agentUsage: SessionAgentUsageEntry[];
  skillUsage: SessionAgentUsageResponse['skillUsage'] | null;
  sessionObservability: CatalogAuditSessionSummary | null;
  sessionSkills: CatalogAuditAssetSummary[];
  sessionObservabilityError: string | null;
}

const SESSION_AGENT_USAGE_EVENT_LIMIT = 500;
const ACTIVE_SESSION_POLL_INTERVAL_MS = 5_000;
const TERMINAL_EXECUTION_STATE_TOKENS = new Set([
  'aborted',
  'canceled',
  'cancelled',
  'closed',
  'complete',
  'completed',
  'done',
  'error',
  'failed',
  'finished',
  'stopped',
  'terminated',
]);

interface OptionalArtifactResult<T> {
  data: T | null;
  error: unknown | null;
}

const EMPTY_ARTIFACTS_STATE: SessionArtifactsState = {
  sessionId: null,
  sessionSource: null,
  sessionSandbox: null,
  loading: false,
  error: null,
  plans: [],
  nextUnit: null,
  warnings: [],
  proposition: null,
  latestPropositionEntry: null,
  handoff: null,
  handoffParsed: null,
  intentFrame: null,
  closureSummary: null,
  executionState: null,
  executionOverlay: null,
  executionOverlayWarnings: [],
  resumeMeta: null,
  reviewLedgerApproved: null,
  verificationGuide: null,
  agentUsage: [],
  skillUsage: null,
  sessionObservability: null,
  sessionSkills: [],
  sessionObservabilityError: null,
};

const KNOWN_METADATA_KEYS = new Set([
  'id',
  'source',
  'active',
  'startedAtMs',
  'updatedAtMs',
  'startTime',
  'lastEventTime',
  'startedAt',
  'updatedAt',
  'lastUpdatedAt',
  'status',
  'resolvedStatus',
  'reconciliationReason',
  'resolvedSourceSet',
  'sources',
  'authority',
  'reconciliation',
]);

function getExtraMetadata(input: SessionSummary): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  Object.entries(input).forEach(([key, value]) => {
    if (KNOWN_METADATA_KEYS.has(key)) {
      return;
    }
    metadata[key] = value;
  });

  return metadata;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Unable to read session folder artifacts.';
}

function formatIsoTimestampLabel(value: string | null | undefined): string {
  if (!value) {
    return 'Unknown';
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString();
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

function renderArtifactSection(section: SessionArtifactSection) {
  const items = Array.isArray(section.items)
    ? section.items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  return (
    <div key={`${section.key || section.title}-${section.content}`} className="metadata-block">
      <h5>{section.title}</h5>
      {items.length > 0 ? (
        <ul className="session-detail-warnings">
          {items.map((item) => (
            <li key={`${section.title}-${item}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <pre>{section.content || '-'}</pre>
      )}
    </div>
  );
}

function getLatestPropositionEntry(response: SessionPropositionResponse | null): SessionPropositionEntry | null {
  if (!response || !Array.isArray(response.entries) || response.entries.length === 0) {
    return null;
  }

  return response.entries[response.entries.length - 1] || null;
}

function normalizeStringList(input: unknown): string[] {
  return Array.isArray(input)
    ? input.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function renderDerivedList(title: string, items: string[], emptyCopy: string) {
  return (
    <div className="metadata-block">
      <h5>{title}</h5>
      {items.length > 0 ? (
        <ul className="session-detail-warnings">
          {items.map((item) => (
            <li key={`${title}-${item}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="session-detail-hint">{emptyCopy}</p>
      )}
    </div>
  );
}

function renderDerivedWarnings(warnings: string[]) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <ul className="session-detail-warnings">
      {warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  );
}

function getExecutionOverlayStatusLabel(overlay: SessionStructuredExecutionOverlay | null | undefined): string {
  if (overlay?.present) {
    return overlay.applied ? 'Applied' : 'Present (ignored)';
  }

  return 'Not present';
}

function formatExecutionRef(ref: SessionExecutionStateRef | SessionStructuredNextUnit | null | undefined): string {
  if (!ref || typeof ref !== 'object') {
    return 'None';
  }

  const workUnitIds = Array.isArray((ref as SessionStructuredNextUnit).workUnitIds)
    ? ((ref as SessionStructuredNextUnit).workUnitIds || []).filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  const primaryId = typeof (ref as SessionStructuredNextUnit).workUnitId === 'string'
    ? (ref as SessionStructuredNextUnit).workUnitId
    : (typeof ref.id === 'string' ? ref.id : '');
  const label = typeof ref.label === 'string' && ref.label.trim().length > 0
    ? ref.label.trim()
    : '';
  const status = typeof ref.status === 'string' && ref.status.trim().length > 0
    ? ref.status.trim()
    : '';
  const nextUnitRef = ref as SessionStructuredNextUnit;
  const rationale = typeof nextUnitRef.rationale === 'string'
    ? nextUnitRef.rationale.trim()
    : '';
  const summary = typeof ref.summary === 'string' && ref.summary.trim().length > 0
    ? ref.summary.trim()
    : rationale;

  const base = workUnitIds.length > 0
    ? workUnitIds.join(', ')
    : (label || primaryId || 'None');

  const suffix = [status, summary].filter(Boolean).join(' — ');
  return suffix ? `${base} — ${suffix}` : base;
}

function formatExecutionBlocker(blocker: SessionExecutionStateBlocker): string {
  const parts = [
    typeof blocker.severity === 'string' && blocker.severity.trim().length > 0
      ? humanizeToken(blocker.severity)
      : '',
    blocker.label,
    typeof blocker.details === 'string' && blocker.details.trim().length > 0
      ? blocker.details
      : '',
  ].filter(Boolean);

  if (parts.length === 0) {
    return 'Unnamed blocker';
  }

  if (parts.length === 1) {
    return parts[0];
  }

  return `${parts[0]}: ${parts.slice(1).join(' — ')}`;
}

function renderExecutionTreeNode(node: SessionExecutionStateNode) {
  const stateTokens = [
    node.status ? humanizeToken(node.status) : '',
    node.current ? 'current' : '',
    !node.current && node.active ? 'active' : '',
    node.next ? 'next' : '',
    node.blocked ? 'blocked' : '',
  ].filter(Boolean);

  return (
    <li key={node.id}>
      <strong>{node.label || node.id}</strong>
      {node.kind ? ` (${humanizeToken(node.kind)})` : ''}
      {stateTokens.length > 0 ? ` — ${stateTokens.join(' · ')}` : ''}
      {node.summary ? ` — ${node.summary}` : ''}
      {Array.isArray(node.children) && node.children.length > 0 ? (
        <ul className="session-detail-warnings">
          {node.children.map((child) => renderExecutionTreeNode(child))}
        </ul>
      ) : null}
    </li>
  );
}

function normalizeAgentUsageEntries(input: Record<string, number> | undefined): SessionAgentUsageEntry[] {
  return Object.entries(input ?? {})
    .map(([agent, count]) => ({
      agent: String(agent || '').trim(),
      count: Number(count) || 0,
    }))
    .filter((entry) => entry.agent.length > 0 && entry.count > 0)
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.agent.localeCompare(right.agent);
    });
}

function normalizeExecutionStateToken(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeSessionSourceToken(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isTerminalExecutionState(executionState: SessionExecutionState | null | undefined): boolean {
  if (!executionState || typeof executionState !== 'object') {
    return false;
  }

  const status = normalizeExecutionStateToken(executionState.status);
  const lifecycle = normalizeExecutionStateToken(executionState.lifecycle);

  return TERMINAL_EXECUTION_STATE_TOKENS.has(status) || TERMINAL_EXECUTION_STATE_TOKENS.has(lifecycle);
}

function shouldPollStructuredArtifacts(
  sessionIsActive: boolean,
  executionOverlay: SessionStructuredExecutionOverlay | null | undefined,
  executionState: SessionExecutionState | null | undefined
): boolean {
  if (isTerminalExecutionState(executionState)) {
    return false;
  }

  return (
    sessionIsActive
    || Boolean(executionState)
    || Boolean(executionOverlay?.present && executionOverlay?.applied)
  );
}

function readCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function resolveEvidence(
  explicitInvocationCount: number,
  proxyInvocationCount: number,
  fallback?: string | null
): SessionSkillUsageEntryView['evidence'] {
  const normalizedFallback = String(fallback || '').trim().toLowerCase();
  if (
    normalizedFallback === 'none'
    || normalizedFallback === 'proxy-only'
    || normalizedFallback === 'authoritative'
    || normalizedFallback === 'mixed'
  ) {
    return normalizedFallback;
  }
  if (explicitInvocationCount > 0 && proxyInvocationCount > 0) {
    return 'mixed';
  }
  if (explicitInvocationCount > 0) {
    return 'authoritative';
  }
  if (proxyInvocationCount > 0) {
    return 'proxy-only';
  }
  return 'none';
}

function isSkillAssetSummary(input: CatalogAuditAssetSummary | null | undefined): input is CatalogAuditAssetSummary {
  const assetId = String(input?.assetId || '').trim().toLowerCase();
  const kind = String(input?.kind || '').trim().toLowerCase();
  return Boolean(assetId) && (kind === 'skill' || assetId.startsWith('skill-'));
}

function normalizeSessionSkillUsageEntries(
  skillUsage: SessionAgentUsageResponse['skillUsage'] | null | undefined,
  sessionSkills: CatalogAuditAssetSummary[]
): SessionSkillUsageEntryView[] {
  const entries = new Map<string, SessionSkillUsageEntryView>();

  for (const skill of sessionSkills.filter(isSkillAssetSummary)) {
    const assetId = String(skill.assetId || '').trim();
    if (!assetId) {
      continue;
    }
    const explicitInvocationCount = readCount(skill.usage?.explicitInvocationCount);
    const proxyInvocationCount = readCount(skill.usage?.proxyInvocationCount ?? skill.usage?.proxyInferredCount);
    entries.set(assetId, {
      assetId,
      assetKey: String(skill.assetKey || assetId.replace(/^skill-/i, '') || assetId),
      searchedCount: readCount(skill.search?.sampled?.searchedCount ?? skill.search?.sampled?.resultCount),
      selectedCount: readCount(skill.search?.sampled?.selectedCount),
      invocationCount: readCount(skill.usage?.invocationCount),
      explicitInvocationCount,
      proxyInvocationCount,
      evidence: resolveEvidence(explicitInvocationCount, proxyInvocationCount, typeof skill.usage?.evidence === 'string' ? skill.usage.evidence : null),
      lastInvokedAt: null,
      toolNames: [],
    });
  }

  for (const skill of Array.isArray(skillUsage?.skills) ? skillUsage.skills : []) {
    const assetId = String(skill?.assetId || '').trim();
    if (!assetId) {
      continue;
    }
    const current = entries.get(assetId);
    const explicitInvocationCount = Math.max(readCount(skill.invocationCount), current?.explicitInvocationCount ?? 0);
    const proxyInvocationCount = current?.proxyInvocationCount ?? 0;
    entries.set(assetId, {
      assetId,
      assetKey: String(skill.assetKey || current?.assetKey || assetId.replace(/^skill-/i, '') || assetId),
      searchedCount: current?.searchedCount ?? 0,
      selectedCount: current?.selectedCount ?? 0,
      invocationCount: Math.max(current?.invocationCount ?? 0, explicitInvocationCount + proxyInvocationCount),
      explicitInvocationCount,
      proxyInvocationCount,
      evidence: resolveEvidence(explicitInvocationCount, proxyInvocationCount, current?.evidence),
      lastInvokedAt: typeof skill.lastInvokedAt === 'string' ? skill.lastInvokedAt : current?.lastInvokedAt ?? null,
      toolNames: Array.isArray(skill.toolNames)
        ? skill.toolNames.filter((toolName): toolName is string => typeof toolName === 'string' && toolName.trim().length > 0)
        : current?.toolNames ?? [],
    });
  }

  return Array.from(entries.values())
    .filter((entry) => entry.searchedCount > 0 || entry.selectedCount > 0 || entry.invocationCount > 0)
    .sort((left, right) => {
      if (right.invocationCount !== left.invocationCount) {
        return right.invocationCount - left.invocationCount;
      }
      if (right.selectedCount !== left.selectedCount) {
        return right.selectedCount - left.selectedCount;
      }
      if (right.searchedCount !== left.searchedCount) {
        return right.searchedCount - left.searchedCount;
      }
      return left.assetId.localeCompare(right.assetId);
    });
}

function describeEvidence(entry: SessionSkillUsageEntryView): string {
  if (entry.evidence === 'mixed') {
    return `${entry.explicitInvocationCount} explicit + ${entry.proxyInvocationCount} proxy-only fallback invocation(s).`;
  }
  if (entry.evidence === 'authoritative') {
    return `${entry.explicitInvocationCount} authoritative asset.invoked observation(s).`;
  }
  if (entry.evidence === 'proxy-only') {
    return `${entry.proxyInvocationCount} proxy-only invocation(s); no explicit asset.invoked evidence was recorded for this session.`;
  }
  return 'No invocation evidence recorded.';
}

export default function SessionDetail({ session = null }: SessionDetailProps) {
  const [artifacts, setArtifacts] = useState<SessionArtifactsState>(EMPTY_ARTIFACTS_STATE);
  const latestExecutionOverlayRef = useRef<SessionStructuredExecutionOverlay | null>(null);
  const latestExecutionStateRef = useRef<SessionExecutionState | null>(null);
  const extraMetadata = session ? getExtraMetadata(session) : {};
  const extraMetadataJson = Object.keys(extraMetadata).length > 0 ? JSON.stringify(extraMetadata, null, 2) : null;
  const sessionReason = session ? resolveSessionReason(session) : null;
  const sessionSource = typeof session?.source === 'string' ? session.source : undefined;
  const sessionSourceToken = normalizeSessionSourceToken(sessionSource);
  const sessionSandbox =
    sessionSourceToken === 'sandbox' && typeof session?.sandbox === 'string' && session.sandbox.trim()
      ? session.sandbox.trim()
      : undefined;
  const artifactQueryOptions = {
    source: sessionSource,
    sandbox: sessionSandbox,
  };
  const supportsCatalogSessionObservability = !sessionSourceToken || sessionSourceToken === 'cli';
  const sessionIsActive = session ? resolveSessionActiveLabel(session) === 'true' : false;
  const selectedSessionSource = sessionSource ?? null;
  const selectedSessionSandbox = sessionSandbox ?? null;
  const artifactsBelongToSelectedSession = session?.id != null
    && artifacts.sessionId === session.id
    && artifacts.sessionSource === selectedSessionSource
    && artifacts.sessionSandbox === selectedSessionSandbox;
  const visibleArtifacts = artifactsBelongToSelectedSession ? artifacts : EMPTY_ARTIFACTS_STATE;
  const artifactsLoading = Boolean(session) && (artifacts.loading || !artifactsBelongToSelectedSession);
  const totalAgentInvocations = visibleArtifacts.agentUsage.reduce((sum, entry) => sum + entry.count, 0);
  const sessionSkillUsage = normalizeSessionSkillUsageEntries(visibleArtifacts.skillUsage, visibleArtifacts.sessionSkills);
  const intentFrameInScope = normalizeStringList(visibleArtifacts.intentFrame?.inScope);
  const intentFrameOutOfScope = normalizeStringList(visibleArtifacts.intentFrame?.outOfScope);
  const intentFrameSuccessSignals = normalizeStringList(visibleArtifacts.intentFrame?.successSignals);
  const intentFrameConstraints = normalizeStringList(visibleArtifacts.intentFrame?.constraints);
  const intentFrameRisks = normalizeStringList(visibleArtifacts.intentFrame?.risks);
  const intentFrameWatchOuts = normalizeStringList(visibleArtifacts.intentFrame?.watchOuts);
  const intentFrameCarryover = normalizeStringList(visibleArtifacts.intentFrame?.carryoverSignals);
  const intentFrameKeyDecisions = normalizeStringList(visibleArtifacts.intentFrame?.keyDecisions);
  const intentFrameContextSignals = normalizeStringList(visibleArtifacts.intentFrame?.contextSignals);
  const intentFrameNextUnits = normalizeStringList(visibleArtifacts.intentFrame?.nextSuggestedUnits);
  const intentFrameWarnings = normalizeStringList(visibleArtifacts.intentFrame?.warnings);
  const closureDelivered = normalizeStringList(visibleArtifacts.closureSummary?.delivered);
  const closureRequested = normalizeStringList(visibleArtifacts.closureSummary?.requested);
  const closureChangedFiles = normalizeStringList(visibleArtifacts.closureSummary?.changedFiles);
  const closureWhereToVerify = normalizeStringList(visibleArtifacts.closureSummary?.whereToVerify);
  const closureValidationEvidence = normalizeStringList(visibleArtifacts.closureSummary?.validationEvidence);
  const closureActiveContinuation = normalizeStringList(visibleArtifacts.closureSummary?.followUps?.activeContinuation);
  const closureDurableCarryover = normalizeStringList(visibleArtifacts.closureSummary?.followUps?.durableCarryover);
  const closureBlockers = normalizeStringList(visibleArtifacts.closureSummary?.blockers);
  const closureLimitations = normalizeStringList(visibleArtifacts.closureSummary?.limitations);
  const closureWarnings = normalizeStringList(visibleArtifacts.closureSummary?.warnings);
  const executionBlockers = Array.isArray(visibleArtifacts.executionState?.blockers)
    ? visibleArtifacts.executionState.blockers
      .filter((entry): entry is SessionExecutionStateBlocker => Boolean(entry?.label))
      .map((entry) => formatExecutionBlocker(entry))
    : [];
  const executionTree = Array.isArray(visibleArtifacts.executionState?.tree)
    ? visibleArtifacts.executionState.tree.filter((entry): entry is SessionExecutionStateNode => Boolean(entry?.id))
    : [];
  const skillRollup = {
    searchedCount: readCount(visibleArtifacts.sessionObservability?.search?.searchedCount ?? visibleArtifacts.sessionObservability?.search?.queryCount),
    selectedCount: readCount(visibleArtifacts.sessionObservability?.search?.selectedCount),
    invocationCount: readCount(visibleArtifacts.sessionObservability?.usage?.invocationCount ?? visibleArtifacts.skillUsage?.totalInvocations),
    explicitInvocationCount: readCount(visibleArtifacts.sessionObservability?.usage?.explicitInvocationCount ?? visibleArtifacts.skillUsage?.totalInvocations),
    proxyInvocationCount: readCount(visibleArtifacts.sessionObservability?.usage?.proxyInvocationCount ?? visibleArtifacts.sessionObservability?.usage?.proxyInferredCount),
  };
  const skillRollupEvidence = resolveEvidence(
    skillRollup.explicitInvocationCount,
    skillRollup.proxyInvocationCount,
    typeof visibleArtifacts.sessionObservability?.usage?.evidence === 'string' ? visibleArtifacts.sessionObservability.usage.evidence : null
  );

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    if (!session) {
      latestExecutionOverlayRef.current = null;
      latestExecutionStateRef.current = null;
      setArtifacts(EMPTY_ARTIFACTS_STATE);
      return () => {
        cancelled = true;
        if (pollTimer) {
          clearTimeout(pollTimer);
        }
      };
    }

    const currentSession = session;
    const currentSessionId = currentSession.id;

    latestExecutionOverlayRef.current = null;
    latestExecutionStateRef.current = null;

    async function readOptional<T>(loader: () => Promise<T>): Promise<OptionalArtifactResult<T>> {
      try {
        return {
          data: await loader(),
          error: null,
        };
      } catch (error) {
        if (isNotFoundError(error)) {
          return {
            data: null,
            error: null,
          };
        }
        return {
          data: null,
          error,
        };
      }
    }

    function schedulePoll(): void {
      if (cancelled || !shouldPollStructuredArtifacts(
        sessionIsActive,
        latestExecutionOverlayRef.current,
        latestExecutionStateRef.current
      )) {
        return;
      }

      pollTimer = setTimeout(() => {
        void loadArtifacts(true);
      }, ACTIVE_SESSION_POLL_INTERVAL_MS);
    }

    async function loadArtifacts(preserveExisting: boolean): Promise<void> {
      if (!preserveExisting) {
        setArtifacts({
          ...EMPTY_ARTIFACTS_STATE,
          sessionId: currentSessionId,
          sessionSource: selectedSessionSource,
          sessionSandbox: selectedSessionSandbox,
          loading: true,
          error: null,
        });
      } else {
        setArtifacts((current) => ({
          ...current,
          sessionId: currentSessionId,
          sessionSource: selectedSessionSource,
          sessionSandbox: selectedSessionSandbox,
          loading: true,
          error: null,
        }));
      }

      try {
        const [
          plansResponse,
          usageResponse,
          structuredStateResponse,
          propositionResponse,
          handoffResponse,
          verificationResponse,
          sessionAuditAnalyticsResponse,
        ] = await Promise.all([
          readOptional(() => listSessionPlans(currentSessionId, artifactQueryOptions)),
          readOptional(() => getSessionAgentUsage(currentSessionId, {
            ...artifactQueryOptions,
            limit: SESSION_AGENT_USAGE_EVENT_LIMIT,
          })),
          readOptional(() => getSessionStructuredState(currentSessionId, { ...artifactQueryOptions, planId: 'latest' })),
          readOptional(() => getSessionProposition(currentSessionId, artifactQueryOptions)),
          readOptional(() => getSessionHandoff(currentSessionId, artifactQueryOptions)),
          readOptional(() => getSessionVerificationGuide(currentSessionId, artifactQueryOptions)),
          supportsCatalogSessionObservability
            ? readOptional(() => getCatalogAssetAnalytics({
              sessionId: currentSessionId,
              limit: SESSION_AGENT_USAGE_EVENT_LIMIT,
            }))
            : Promise.resolve({
              data: null,
              error: null,
            }),
        ]);

        if (cancelled) {
          return;
        }

        const structuredState = structuredStateResponse.data;
        const nextUnit =
          structuredState && typeof structuredState.nextUnit === 'object' && structuredState.nextUnit != null
            ? (structuredState.nextUnit as SessionStructuredNextUnit)
            : null;

        const warnings = Array.isArray(structuredState?.warnings)
          ? structuredState.warnings
            .filter((entry): entry is string => typeof entry === 'string')
            .slice(0, 8)
          : [];

        const latestPropositionEntry = getLatestPropositionEntry(propositionResponse.data as SessionPropositionResponse | null);
        const structuredMeta = structuredState && typeof structuredState.meta === 'object' && structuredState.meta != null
          ? (structuredState.meta as SessionStructuredMeta)
          : null;
        const nextExecutionOverlay = preserveExisting && structuredStateResponse.error
          ? latestExecutionOverlayRef.current
          : structuredMeta && typeof structuredMeta.executionOverlay === 'object' && structuredMeta.executionOverlay != null
            ? structuredMeta.executionOverlay
            : null;
        const nextExecutionState = preserveExisting && structuredStateResponse.error
          ? latestExecutionStateRef.current
          : structuredMeta && typeof structuredMeta.executionState === 'object' && structuredMeta.executionState != null
            ? structuredMeta.executionState
            : null;
        const sessionAnalytics =
          sessionAuditAnalyticsResponse.data
          && typeof sessionAuditAnalyticsResponse.data.analytics === 'object'
          && sessionAuditAnalyticsResponse.data.analytics != null
            ? sessionAuditAnalyticsResponse.data.analytics
            : null;
        const sessionObservability = Array.isArray(sessionAnalytics?.sessions)
          ? sessionAnalytics.sessions.find((entry) => entry?.sessionId === currentSessionId) ?? null
          : null;
        const sessionSkills = Array.isArray(sessionAnalytics?.assets)
          ? sessionAnalytics.assets.filter((entry): entry is CatalogAuditAssetSummary => Boolean(entry?.assetId))
          : [];
        const partialErrors = [
          plansResponse.error ? `Plans: ${toErrorMessage(plansResponse.error)}` : null,
          usageResponse.error ? `Agent usage: ${toErrorMessage(usageResponse.error)}` : null,
          structuredStateResponse.error ? `Structured state: ${toErrorMessage(structuredStateResponse.error)}` : null,
          propositionResponse.error ? `Proposition: ${toErrorMessage(propositionResponse.error)}` : null,
          handoffResponse.error ? `Handoff: ${toErrorMessage(handoffResponse.error)}` : null,
          verificationResponse.error ? `Verification guide: ${toErrorMessage(verificationResponse.error)}` : null,
          sessionAuditAnalyticsResponse.error ? `Session observability: ${toErrorMessage(sessionAuditAnalyticsResponse.error)}` : null,
        ].filter((entry): entry is string => Boolean(entry));

        latestExecutionOverlayRef.current = nextExecutionOverlay;
        latestExecutionStateRef.current = nextExecutionState;

        setArtifacts((current) => ({
          sessionId: currentSessionId,
          sessionSource: selectedSessionSource,
          sessionSandbox: selectedSessionSandbox,
          loading: false,
          error: partialErrors.length > 0 ? partialErrors.join(' ') : null,
          plans: preserveExisting && plansResponse.error
            ? current.plans
            : Array.isArray(plansResponse.data?.plans) ? plansResponse.data.plans : [],
          nextUnit: preserveExisting && structuredStateResponse.error ? current.nextUnit : nextUnit,
          warnings: preserveExisting && structuredStateResponse.error ? current.warnings : warnings,
          proposition: preserveExisting && propositionResponse.error
            ? current.proposition
            : propositionResponse.data && typeof propositionResponse.data.content === 'string'
              ? propositionResponse.data.content
              : null,
          latestPropositionEntry: preserveExisting && propositionResponse.error
            ? current.latestPropositionEntry
            : latestPropositionEntry,
          handoff: preserveExisting && handoffResponse.error
            ? current.handoff
            : handoffResponse.data && typeof handoffResponse.data.content === 'string'
              ? handoffResponse.data.content
              : null,
          handoffParsed: preserveExisting && handoffResponse.error
            ? current.handoffParsed
            : handoffResponse.data && typeof handoffResponse.data.parsed === 'object' && handoffResponse.data.parsed != null
              ? handoffResponse.data.parsed
              : null,
          intentFrame: preserveExisting && structuredStateResponse.error
            ? current.intentFrame
            : structuredMeta && typeof structuredMeta.intentFrame === 'object' && structuredMeta.intentFrame != null
              ? structuredMeta.intentFrame
              : null,
          closureSummary: preserveExisting && structuredStateResponse.error
            ? current.closureSummary
            : structuredMeta && typeof structuredMeta.closureSummary === 'object' && structuredMeta.closureSummary != null
              ? structuredMeta.closureSummary
              : null,
          executionState: preserveExisting && structuredStateResponse.error
            ? current.executionState
            : nextExecutionState,
          executionOverlay: preserveExisting && structuredStateResponse.error
            ? current.executionOverlay
            : nextExecutionOverlay,
          executionOverlayWarnings: preserveExisting && structuredStateResponse.error
            ? current.executionOverlayWarnings
            : structuredMeta && Array.isArray(structuredMeta.executionOverlay?.warnings)
              ? structuredMeta.executionOverlay.warnings
                .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
              : [],
          resumeMeta: preserveExisting && structuredStateResponse.error
            ? current.resumeMeta
            : structuredMeta && typeof structuredMeta.resume === 'object' && structuredMeta.resume != null
              ? structuredMeta.resume
              : null,
          reviewLedgerApproved: preserveExisting && structuredStateResponse.error
            ? current.reviewLedgerApproved
            : structuredMeta && typeof structuredMeta.reviewLedger?.approved === 'boolean'
              ? structuredMeta.reviewLedger.approved
              : null,
          verificationGuide: preserveExisting && verificationResponse.error
            ? current.verificationGuide
            : verificationResponse.data && typeof verificationResponse.data.content === 'string'
              ? verificationResponse.data.content
              : null,
          agentUsage: preserveExisting && usageResponse.error
            ? current.agentUsage
            : normalizeAgentUsageEntries(
              usageResponse.data && typeof usageResponse.data.usage === 'object' && usageResponse.data.usage != null
                ? (usageResponse.data.usage as Record<string, number>)
                : undefined
            ),
          skillUsage: preserveExisting && usageResponse.error
            ? current.skillUsage
            : usageResponse.data && typeof usageResponse.data.skillUsage === 'object' && usageResponse.data.skillUsage != null
              ? usageResponse.data.skillUsage
              : null,
          sessionObservability: preserveExisting && sessionAuditAnalyticsResponse.error
            ? current.sessionObservability
            : sessionObservability,
          sessionSkills: preserveExisting && sessionAuditAnalyticsResponse.error
            ? current.sessionSkills
            : sessionSkills,
          sessionObservabilityError: sessionAuditAnalyticsResponse.error
            ? toErrorMessage(sessionAuditAnalyticsResponse.error)
            : null,
        }));
      } catch (error) {
        if (cancelled) {
          return;
        }

        setArtifacts((current) => (
          preserveExisting
            ? {
              ...current,
              sessionId: currentSessionId,
              sessionSource: selectedSessionSource,
              sessionSandbox: selectedSessionSandbox,
              loading: false,
              error: toErrorMessage(error),
            }
            : {
              ...EMPTY_ARTIFACTS_STATE,
              sessionId: currentSessionId,
              sessionSource: selectedSessionSource,
              sessionSandbox: selectedSessionSandbox,
              error: toErrorMessage(error),
            }
        ));
      } finally {
        schedulePoll();
      }
    }

    void loadArtifacts(false);

    return () => {
      cancelled = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
    };
  }, [session?.id, sessionIsActive, sessionSandbox, sessionSource]);

  return (
    <section className="session-detail" data-testid="session-detail">
      {session ? (
        <>
          <dl className="detail-grid">
            <div>
              <dt>ID</dt>
              <dd>{session.id}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{resolveSessionSourceLabel(session)}</dd>
            </div>
            <div>
              <dt>Active</dt>
              <dd>{resolveSessionActiveLabel(session)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{humanizeToken(resolveSessionStatus(session))}</dd>
            </div>
            <div>
              <dt>Reason</dt>
              <dd>{sessionReason?.label || 'Unknown'}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{formatTimestampLabel(resolveSessionStartedAt(session))}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatTimestampLabel(resolveSessionUpdatedAt(session))}</dd>
            </div>
          </dl>

          <p className="session-detail-reason-copy">
            {sessionReason?.message || 'No explicit reason provided by reconciliation metadata.'}
          </p>

          <section className="session-detail-artifacts">
            <h4>Plans and Session Framing</h4>
            {artifactsLoading ? (
              <p className="session-detail-hint">Loading session folder artifacts...</p>
            ) : null}

            {!artifactsLoading && visibleArtifacts.plans.length > 0 ? (
              <ul className="session-plan-list">
                {visibleArtifacts.plans.map((plan) => (
                  <li key={plan.id}>
                    <p className="session-plan-item-title">{plan.id}</p>
                    <p className="session-plan-item-copy">
                      {plan.source || 'plan artifact'}
                      {' | '}
                      {humanizeToken(typeof plan.kind === 'string' ? plan.kind : 'plan')}
                      {' | '}
                      {formatTimestampLabel(typeof plan.updatedMs === 'number' ? plan.updatedMs : null)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}

            {!artifactsLoading ? (
              <section className="metadata-block">
                <h5>Session Intent Frame</h5>
                {visibleArtifacts.intentFrame?.summary ? (
                  <p className="session-detail-suggestion">{visibleArtifacts.intentFrame.summary}</p>
                ) : (
                  <p className="session-detail-hint">
                    No persisted intent-frame summary could be derived yet for this session.
                  </p>
                )}
                <dl className="detail-grid">
                  <div>
                    <dt>Resume readiness</dt>
                    <dd>
                      {visibleArtifacts.resumeMeta
                        ? (visibleArtifacts.resumeMeta.ready ? 'Ready' : 'Needs attention')
                        : (visibleArtifacts.intentFrame?.resumeReady == null ? 'Unknown' : (visibleArtifacts.intentFrame.resumeReady ? 'Ready' : 'Needs attention'))}
                    </dd>
                  </div>
                  <div>
                    <dt>Review approval</dt>
                    <dd>
                      {visibleArtifacts.reviewLedgerApproved == null
                        ? 'Unknown'
                        : (visibleArtifacts.reviewLedgerApproved ? 'Approved' : 'Not approved')}
                    </dd>
                  </div>
                  <div>
                    <dt>Plan status</dt>
                    <dd>{visibleArtifacts.intentFrame?.planStatus || 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt>Primary sources</dt>
                    <dd>{normalizeStringList(visibleArtifacts.intentFrame?.sourceArtifacts).map((entry) => humanizeToken(entry)).join(', ') || 'None'}</dd>
                  </div>
                </dl>
                {intentFrameNextUnits.length > 0 || visibleArtifacts.nextUnit ? (
                  <p className="session-detail-suggestion">
                    <span>Next suggested unit:</span>{' '}
                    {intentFrameNextUnits.join(', ')
                      || (Array.isArray(visibleArtifacts.nextUnit?.workUnitIds) && visibleArtifacts.nextUnit.workUnitIds.length > 0
                        ? visibleArtifacts.nextUnit.workUnitIds.join(', ')
                        : visibleArtifacts.nextUnit?.workUnitId || 'unknown')}
                    {visibleArtifacts.nextUnit?.rationale ? ` - ${visibleArtifacts.nextUnit.rationale}` : ''}
                  </p>
                ) : null}
                {renderDerivedList('In scope now', intentFrameInScope, 'No explicit in-scope items were derived.')}
                {renderDerivedList('Deferred or out of scope', intentFrameOutOfScope, 'No deferred or out-of-scope edges were derived.')}
                {renderDerivedList('Success / completion signals', intentFrameSuccessSignals, 'No success signals were derived from persisted checkpoints or verification targets.')}
                {renderDerivedList('Constraints', intentFrameConstraints, 'No explicit user constraints were persisted.')}
                {renderDerivedList('Key decisions', intentFrameKeyDecisions, 'No key decisions were captured in the handoff artifact.')}
                {renderDerivedList('Context signals', intentFrameContextSignals, 'No exploration context signals were persisted.')}
                {renderDerivedList('Watch outs', intentFrameWatchOuts, 'No watch-outs were persisted.')}
                {renderDerivedList('Open risks', intentFrameRisks, 'No open risks were persisted.')}
                {renderDerivedList('Carryover / deferred follow-ups', intentFrameCarryover, 'No carryover signals were derived.')}
                {renderDerivedWarnings(intentFrameWarnings)}
              </section>
            ) : null}

            {!artifactsLoading ? (
              <section className="metadata-block">
                <h5>Execution State</h5>
                {visibleArtifacts.executionState?.summary ? (
                  <p className="session-detail-suggestion">{visibleArtifacts.executionState.summary}</p>
                ) : (
                  <p className="session-detail-hint">
                    No persisted execution-state overlay was found for this session yet.
                  </p>
                )}
                <dl className="detail-grid">
                  <div>
                    <dt>Lifecycle</dt>
                    <dd>{visibleArtifacts.executionState?.lifecycle ? humanizeToken(visibleArtifacts.executionState.lifecycle) : 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{visibleArtifacts.executionState?.status ? humanizeToken(visibleArtifacts.executionState.status) : 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt>Mode</dt>
                    <dd>{visibleArtifacts.executionState?.mode ? humanizeToken(visibleArtifacts.executionState.mode) : 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{formatIsoTimestampLabel(visibleArtifacts.executionState?.updatedAt)}</dd>
                  </div>
                  <div>
                    <dt>Active group</dt>
                    <dd>{formatExecutionRef(visibleArtifacts.executionState?.activeGroup)}</dd>
                  </div>
                  <div>
                    <dt>Active work unit</dt>
                    <dd>{formatExecutionRef(visibleArtifacts.executionState?.activeWorkUnit)}</dd>
                  </div>
                  <div>
                    <dt>Next unit</dt>
                    <dd>{formatExecutionRef(visibleArtifacts.executionState?.nextUnit || visibleArtifacts.nextUnit)}</dd>
                  </div>
                  <div>
                    <dt>Last completed unit</dt>
                    <dd>{formatExecutionRef(visibleArtifacts.executionState?.lastCompletedUnit)}</dd>
                  </div>
                  <div>
                    <dt>Replan count</dt>
                    <dd>{typeof visibleArtifacts.executionState?.replanCount === 'number' ? visibleArtifacts.executionState.replanCount : 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt>Overlay status</dt>
                    <dd>{getExecutionOverlayStatusLabel(visibleArtifacts.executionOverlay)}</dd>
                  </div>
                </dl>
                {renderDerivedList('Execution blockers', executionBlockers, 'No blockers were persisted in the execution overlay.')}
                <div className="metadata-block">
                  <h5>Execution tree</h5>
                  {executionTree.length > 0 ? (
                    <ul className="session-detail-warnings">
                      {executionTree.map((node) => renderExecutionTreeNode(node))}
                    </ul>
                  ) : (
                    <p className="session-detail-hint">
                      No execution tree hierarchy was persisted in the overlay yet.
                    </p>
                  )}
                </div>
                {renderDerivedWarnings(visibleArtifacts.executionOverlayWarnings)}
              </section>
            ) : null}

            {!artifactsLoading ? (
              <section className="metadata-block">
                <h5>Session Closure Summary</h5>
                {visibleArtifacts.closureSummary?.summary ? (
                  <p className="session-detail-suggestion">{visibleArtifacts.closureSummary.summary}</p>
                ) : (
                  <p className="session-detail-hint">
                    No persisted closure summary could be derived yet for this session.
                  </p>
                )}
                <dl className="detail-grid">
                  <div>
                    <dt>Outcome</dt>
                    <dd>{visibleArtifacts.closureSummary?.outcome ? humanizeToken(visibleArtifacts.closureSummary.outcome) : 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt>Confidence</dt>
                    <dd>{visibleArtifacts.closureSummary?.confidence ? humanizeToken(visibleArtifacts.closureSummary.confidence) : 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt>Review verdict</dt>
                    <dd>{visibleArtifacts.closureSummary?.reviewVerdict || 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt>Primary sources</dt>
                    <dd>{normalizeStringList(visibleArtifacts.closureSummary?.sourceArtifacts).map((entry) => humanizeToken(entry)).join(', ') || 'None'}</dd>
                  </div>
                </dl>
                {renderDerivedList('Delivered', closureDelivered, 'No delivered-work summary was derived.')}
                {renderDerivedList('Requested / intended work', closureRequested, 'No requested-work baseline was derived from persisted framing artifacts.')}
                {renderDerivedList('Changed files', closureChangedFiles, 'No changed-file list was persisted in the verification guide.')}
                {renderDerivedList('Where to verify', closureWhereToVerify, 'No verification targets were persisted.')}
                {renderDerivedList('Validation evidence', closureValidationEvidence, 'No explicit validation evidence was derived.')}
                {renderDerivedList('Active continuation follow-ups', closureActiveContinuation, 'No active continuation follow-ups were derived.')}
                {renderDerivedList('Durable carryover follow-ups', closureDurableCarryover, 'No durable carryover follow-ups were derived.')}
                {renderDerivedList('Blockers / gaps', closureBlockers, 'No blockers or open gaps were derived.')}
                {renderDerivedList('Session limitations', closureLimitations, 'No explicit limitations were persisted.')}
                {renderDerivedWarnings(closureWarnings)}
              </section>
            ) : null}

             {!artifactsLoading
               && visibleArtifacts.plans.length === 0
                && visibleArtifacts.agentUsage.length === 0
                && sessionSkillUsage.length === 0
                && !visibleArtifacts.intentFrame
                && !visibleArtifacts.executionState
                && !visibleArtifacts.closureSummary
                && !visibleArtifacts.handoff
                && !visibleArtifacts.proposition
              && !visibleArtifacts.verificationGuide ? (
                  <p className="session-detail-hint">No workflow artifacts found in this session folder.</p>
               ) : null}

            {!artifactsLoading && visibleArtifacts.warnings.length > 0 ? (
              <ul className="session-detail-warnings">
                {visibleArtifacts.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}

            {!artifactsLoading ? (
              <section className="metadata-block">
                <h5>Observed agent / planner usage</h5>
                <p className="session-detail-hint">
                  Derived from the most recent {SESSION_AGENT_USAGE_EVENT_LIMIT} session events, so this is a bounded sample rather than a full historical ledger.
                </p>
                {visibleArtifacts.agentUsage.length > 0 ? (
                  <>
                    <p className="session-detail-suggestion">
                      <span>Sampled invocations:</span> {totalAgentInvocations} across {visibleArtifacts.agentUsage.length} observed agent label(s).
                    </p>
                    <ul className="session-detail-warnings">
                      {visibleArtifacts.agentUsage.map((entry) => (
                        <li key={entry.agent}>
                          <strong>{humanizeToken(entry.agent)}</strong>: {entry.count}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="session-detail-hint">
                    No agent or planner usage was detected in the sampled events for this session.
                  </p>
                )}
              </section>
            ) : null}

            {!artifactsLoading ? (
              <section className="metadata-block">
                <h5>Observed skill usage</h5>
                {supportsCatalogSessionObservability ? (
                  <>
                    <p className="session-detail-hint">
                      Search and selection counts come from catalog search telemetry for this session when available. Invocation totals prefer
                      authoritative asset.invoked events and only fall back to proxy planner/agent usage when no explicit evidence exists.
                    </p>
                    <p className="session-detail-suggestion">
                      <span>Session rollup:</span> Searched {skillRollup.searchedCount} · Selected {skillRollup.selectedCount} · Invoked {skillRollup.invocationCount}
                    </p>
                    <p className="session-detail-hint">
                      {describeEvidence({
                        assetId: 'session-rollup',
                        assetKey: 'session-rollup',
                        searchedCount: skillRollup.searchedCount,
                        selectedCount: skillRollup.selectedCount,
                        invocationCount: skillRollup.invocationCount,
                        explicitInvocationCount: skillRollup.explicitInvocationCount,
                        proxyInvocationCount: skillRollup.proxyInvocationCount,
                        evidence: skillRollupEvidence,
                        lastInvokedAt: null,
                        toolNames: [],
                      })}
                    </p>
                    {sessionSkillUsage.length > 0 ? (
                      <ul className="session-detail-warnings">
                        {sessionSkillUsage.map((entry) => (
                          <li key={entry.assetId}>
                            <strong>{humanizeToken(entry.assetKey)}</strong>: searched {entry.searchedCount} · selected {entry.selectedCount} · invoked {entry.invocationCount}
                            <br />
                            <span>{describeEvidence(entry)}</span>
                            {entry.lastInvokedAt ? ` · last invoked ${formatIsoTimestampLabel(entry.lastInvokedAt)}` : ''}
                            {entry.toolNames.length > 0 ? ` · tools: ${entry.toolNames.join(', ')}` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="session-detail-hint">
                        No skill-specific search, selection, or invocation activity was detected for this session.
                      </p>
                    )}
                    {visibleArtifacts.sessionObservabilityError ? (
                      <p className="session-detail-hint">
                        Session search/selection observability is currently unavailable: {visibleArtifacts.sessionObservabilityError}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="session-detail-hint">
                    Search, selection, and catalog-derived skill observability are currently only source-aware for CLI sessions, so they are
                    suppressed for {resolveSessionSourceLabel(session)} sessions.
                  </p>
                )}
              </section>
            ) : null}

            {!artifactsLoading && (visibleArtifacts.proposition || visibleArtifacts.handoff || visibleArtifacts.verificationGuide) ? (
              <section className="metadata-block">
                <h5>Supporting raw artifacts</h5>
                <p className="session-detail-hint">
                  These persisted artifacts remain available as supporting detail behind the derived Session Intent Frame and Session Closure Summary.
                </p>
                {visibleArtifacts.proposition ? (
                  <details className="metadata-block">
                    <summary>Proposition</summary>
                    {visibleArtifacts.latestPropositionEntry ? (
                      <>
                        <p className="session-detail-hint">
                          Latest guidance: {visibleArtifacts.latestPropositionEntry.phase || 'unknown phase'}
                        </p>
                        {visibleArtifacts.latestPropositionEntry.sections.map((section) => renderArtifactSection(section))}
                      </>
                    ) : null}
                    <pre>{visibleArtifacts.proposition}</pre>
                  </details>
                ) : null}

                {visibleArtifacts.handoff ? (
                  <details className="metadata-block">
                    <summary>Handoff</summary>
                    {visibleArtifacts.handoffParsed?.manifest ? (
                      <dl className="detail-grid">
                        <div>
                          <dt>Session</dt>
                          <dd>{visibleArtifacts.handoffParsed.manifest.session || '—'}</dd>
                        </div>
                        <div>
                          <dt>Plan Status</dt>
                          <dd>{visibleArtifacts.handoffParsed.manifest.planStatus || '—'}</dd>
                        </div>
                        <div>
                          <dt>Reviewer</dt>
                          <dd>{visibleArtifacts.handoffParsed.manifest.reviewer || '—'}</dd>
                        </div>
                      </dl>
                    ) : null}
                    {Array.isArray(visibleArtifacts.handoffParsed?.sections)
                      ? visibleArtifacts.handoffParsed.sections
                        .filter((section) => section.key !== 'handoffManifest')
                        .map((section) => renderArtifactSection(section))
                      : null}
                    <pre>{visibleArtifacts.handoff}</pre>
                  </details>
                ) : null}

                {visibleArtifacts.verificationGuide ? (
                  <details className="metadata-block">
                    <summary>Verification Guide</summary>
                    <pre>{visibleArtifacts.verificationGuide}</pre>
                  </details>
                ) : null}
              </section>
            ) : null}

            {!artifactsLoading && visibleArtifacts.error ? (
              <p className="sessions-error" role="alert">
                {visibleArtifacts.error}
              </p>
            ) : null}
          </section>

          {extraMetadataJson ? (
            <details className="metadata-block">
              <summary>Additional Metadata</summary>
              <pre>{extraMetadataJson}</pre>
            </details>
          ) : null}
        </>
      ) : (
        <p className="empty-message">Select a session from the list to inspect its details.</p>
      )}
    </section>
  );
}
