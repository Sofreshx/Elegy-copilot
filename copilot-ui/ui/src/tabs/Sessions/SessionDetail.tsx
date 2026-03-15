import { useEffect, useState } from 'react';
import {
  ApiError,
  getSessionHandoff,
  getSessionProposition,
  getSessionStructuredState,
  getSessionVerificationGuide,
  listSessionPlans,
} from '../../lib/api';
import type { SessionSummary } from '../../lib/types';
import type {
  SessionArtifactSection,
  SessionHandoffResponse,
  SessionPlanArtifact,
  SessionPropositionEntry,
  SessionPropositionResponse,
  SessionStructuredMeta,
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

interface SessionArtifactsState {
  loading: boolean;
  error: string | null;
  plans: SessionPlanArtifact[];
  nextUnit: SessionStructuredNextUnit | null;
  warnings: string[];
  proposition: string | null;
  propositionEntries: SessionPropositionEntry[];
  handoff: string | null;
  handoffParsed: SessionHandoffResponse['parsed'] | null;
  resumeMeta: SessionStructuredMeta['resume'] | null;
  reviewLedgerApproved: boolean | null;
  verificationGuide: string | null;
}

const EMPTY_ARTIFACTS_STATE: SessionArtifactsState = {
  loading: false,
  error: null,
  plans: [],
  nextUnit: null,
  warnings: [],
  proposition: null,
  propositionEntries: [],
  handoff: null,
  handoffParsed: null,
  resumeMeta: null,
  reviewLedgerApproved: null,
  verificationGuide: null,
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

function getLatestStructuredProposition(response: SessionPropositionResponse | null): SessionPropositionEntry | null {
  if (!response || !Array.isArray(response.entries) || response.entries.length === 0) {
    return null;
  }

  return response.entries[response.entries.length - 1] || null;
}

export default function SessionDetail({ session = null }: SessionDetailProps) {
  const [artifacts, setArtifacts] = useState<SessionArtifactsState>(EMPTY_ARTIFACTS_STATE);
  const extraMetadata = session ? getExtraMetadata(session) : {};
  const extraMetadataJson = Object.keys(extraMetadata).length > 0 ? JSON.stringify(extraMetadata, null, 2) : null;
  const sessionReason = session ? resolveSessionReason(session) : null;
  const sessionSource = typeof session?.source === 'string' ? session.source : undefined;

  useEffect(() => {
    let cancelled = false;

    if (!session) {
      setArtifacts(EMPTY_ARTIFACTS_STATE);
      return () => {
        cancelled = true;
      };
    }

    async function readOptional<T>(loader: () => Promise<T>): Promise<T | null> {
      try {
        return await loader();
      } catch (error) {
        if (isNotFoundError(error)) {
          return null;
        }
        throw error;
      }
    }

    setArtifacts((current) => ({
      ...current,
      loading: true,
      error: null,
    }));

    void Promise.all([
      readOptional(() => listSessionPlans(session.id, { source: sessionSource })),
      readOptional(() => getSessionStructuredState(session.id, { source: sessionSource, planId: 'latest' })),
      readOptional(() => getSessionProposition(session.id, { source: sessionSource })),
      readOptional(() => getSessionHandoff(session.id, { source: sessionSource })),
      readOptional(() => getSessionVerificationGuide(session.id, { source: sessionSource })),
    ])
      .then(([plansResponse, structuredState, propositionResponse, handoffResponse, verificationResponse]) => {
        if (cancelled) {
          return;
        }

        const nextUnit =
          structuredState && typeof structuredState.nextUnit === 'object' && structuredState.nextUnit != null
            ? (structuredState.nextUnit as SessionStructuredNextUnit)
            : null;

        const warnings = Array.isArray(structuredState?.warnings)
          ? structuredState.warnings
            .filter((entry): entry is string => typeof entry === 'string')
            .slice(0, 8)
          : [];

        const latestPropositionEntry = getLatestStructuredProposition(propositionResponse as SessionPropositionResponse | null);
        const propositionEntries = Array.isArray((propositionResponse as SessionPropositionResponse | null)?.entries)
          ? ((propositionResponse as SessionPropositionResponse).entries as SessionPropositionEntry[])
          : [];
        const structuredMeta = structuredState && typeof structuredState.meta === 'object' && structuredState.meta != null
          ? (structuredState.meta as SessionStructuredMeta)
          : null;

        setArtifacts({
          loading: false,
          error: null,
          plans: Array.isArray(plansResponse?.plans) ? plansResponse.plans : [],
          nextUnit,
          warnings,
          proposition:
            propositionResponse && typeof propositionResponse.content === 'string'
              ? propositionResponse.content
              : null,
          propositionEntries: latestPropositionEntry ? latestPropositionEntry.sections.length > 0 ? propositionEntries : propositionEntries : propositionEntries,
          handoff:
            handoffResponse && typeof handoffResponse.content === 'string'
              ? handoffResponse.content
              : null,
          handoffParsed:
            handoffResponse && typeof handoffResponse.parsed === 'object' && handoffResponse.parsed != null
              ? handoffResponse.parsed
              : null,
          resumeMeta:
            structuredMeta && typeof structuredMeta.resume === 'object' && structuredMeta.resume != null
              ? structuredMeta.resume
              : null,
          reviewLedgerApproved:
            structuredMeta && typeof structuredMeta.reviewLedger?.approved === 'boolean'
              ? structuredMeta.reviewLedger.approved
              : null,
          verificationGuide:
            verificationResponse && typeof verificationResponse.content === 'string'
              ? verificationResponse.content
              : null,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setArtifacts({
          ...EMPTY_ARTIFACTS_STATE,
          error: toErrorMessage(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [session?.id, sessionSource]);

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
            <h4>Plans and Suggestions</h4>
            {artifacts.loading ? (
              <p className="session-detail-hint">Loading session folder artifacts...</p>
            ) : null}

            {!artifacts.loading && artifacts.nextUnit ? (
              <p className="session-detail-suggestion">
                <span>Next suggested unit:</span>{' '}
                {Array.isArray(artifacts.nextUnit.workUnitIds) && artifacts.nextUnit.workUnitIds.length > 0
                  ? artifacts.nextUnit.workUnitIds.join(', ')
                  : artifacts.nextUnit.workUnitId || 'unknown'}
                {artifacts.nextUnit.rationale ? ` - ${artifacts.nextUnit.rationale}` : ''}
              </p>
            ) : null}

            {!artifacts.loading && artifacts.resumeMeta ? (
              <p className="session-detail-suggestion">
                <span>Resume readiness:</span>{' '}
                {artifacts.resumeMeta.ready ? 'ready' : 'needs attention'}
                {Array.isArray(artifacts.resumeMeta.blockers) && artifacts.resumeMeta.blockers.length > 0
                  ? ` - ${artifacts.resumeMeta.blockers.join(', ')}`
                  : ''}
              </p>
            ) : null}

            {!artifacts.loading && artifacts.reviewLedgerApproved === false ? (
              <p className="session-detail-hint">Review ledger does not currently show a resumable approval verdict.</p>
            ) : null}

            {!artifacts.loading && artifacts.plans.length > 0 ? (
              <ul className="session-plan-list">
                {artifacts.plans.map((plan) => (
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

            {!artifacts.loading
            && artifacts.plans.length === 0
            && !artifacts.nextUnit
            && !artifacts.proposition
            && !artifacts.verificationGuide ? (
              <p className="session-detail-hint">No plan artifacts found in this session folder.</p>
            ) : null}

            {artifacts.warnings.length > 0 ? (
              <ul className="session-detail-warnings">
                {artifacts.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}

            {artifacts.proposition ? (
              <details className="metadata-block">
                <summary>Proposition</summary>
                {artifacts.propositionEntries.length > 0 ? (
                  <>
                    <p className="session-detail-hint">
                      Latest guidance: {artifacts.propositionEntries[artifacts.propositionEntries.length - 1]?.phase || 'unknown phase'}
                    </p>
                    {artifacts.propositionEntries[artifacts.propositionEntries.length - 1]?.sections.map((section) => renderArtifactSection(section))}
                  </>
                ) : null}
                <pre>{artifacts.proposition}</pre>
              </details>
            ) : null}

            {artifacts.handoff ? (
              <details className="metadata-block">
                <summary>Handoff</summary>
                {artifacts.handoffParsed?.manifest ? (
                  <dl className="detail-grid">
                    <div>
                      <dt>Session</dt>
                      <dd>{artifacts.handoffParsed.manifest.session || '—'}</dd>
                    </div>
                    <div>
                      <dt>Plan Status</dt>
                      <dd>{artifacts.handoffParsed.manifest.planStatus || '—'}</dd>
                    </div>
                    <div>
                      <dt>Reviewer</dt>
                      <dd>{artifacts.handoffParsed.manifest.reviewer || '—'}</dd>
                    </div>
                  </dl>
                ) : null}
                {Array.isArray(artifacts.handoffParsed?.sections)
                  ? artifacts.handoffParsed.sections
                    .filter((section) => section.key !== 'handoffManifest')
                    .map((section) => renderArtifactSection(section))
                  : null}
                <pre>{artifacts.handoff}</pre>
              </details>
            ) : null}

            {artifacts.verificationGuide ? (
              <details className="metadata-block">
                <summary>Verification Guide</summary>
                <pre>{artifacts.verificationGuide}</pre>
              </details>
            ) : null}

            {artifacts.error ? (
              <p className="sessions-error" role="alert">
                {artifacts.error}
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
