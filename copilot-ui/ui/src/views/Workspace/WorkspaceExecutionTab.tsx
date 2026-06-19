import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppIcon,
  Badge,
  Button,
  FormInput,
  HealthDot,
  Panel,
  StatusBadge,
} from '../../components';
import {
  createOrchestratorSession,
  getOrchestratorHealth,
  getOrchestratorSession,
  listOrchestratorSessions,
  mutateOrchestratorSession,
  openOrchestratorEventStream,
  readOrchestratorError,
} from '../../lib/api/orchestrator';
import type {
  OrchestratorAdapterId,
  OrchestratorHealth,
  OrchestratorSession,
} from '../../lib/api/orchestrator';
import { navigationStore } from '../../stores/navigation';

interface WorkspaceExecutionTabProps {
  repoPath: string;
  repoId: string | null;
  repoLabel: string | null;
}

type PresentationState =
  | 'normal'
  | 'waiting-input'
  | 'validation-failed'
  | 'stale-approval'
  | 'disconnected'
  | 'completed';

function readString(record: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function latest(items: Array<Record<string, unknown>>): Record<string, unknown> | null {
  return items.length > 0 ? items[items.length - 1] : null;
}

export function deriveExecutionPresentation(
  session: OrchestratorSession | null,
  connected: boolean,
  commandErrorCode: string | null,
): PresentationState {
  if (!connected) return 'disconnected';
  if (!session) return 'normal';
  if (commandErrorCode === 'stale_state') return 'stale-approval';
  const approval = latest(session.approvals);
  if (readString(approval, 'status') === 'stale') return 'stale-approval';
  const workPoint = latest(session.workPoints);
  const validation = readRecord(workPoint?.validation);
  const validationStatus = readString(validation, 'status') ?? readString(workPoint, 'validationStatus');
  if (validationStatus === 'failed' || session.state === 'verification-failed') {
    return 'validation-failed';
  }
  const input = latest(session.inputRequests);
  if (input && readString(input, 'status') !== 'answered') return 'waiting-input';
  if (['completed', 'committed', 'merged'].includes(session.state)) return 'completed';
  return 'normal';
}

function stateCopy(state: PresentationState): { title: string; detail: string; tone: 'brand' | 'accent' | 'danger' | 'success' } | null {
  switch (state) {
    case 'waiting-input':
      return { title: 'Input required', detail: 'The worker is waiting for an operator response.', tone: 'accent' };
    case 'validation-failed':
      return { title: 'Validation failed', detail: 'Review observed evidence before retrying.', tone: 'danger' };
    case 'stale-approval':
      return { title: 'Approval is stale', detail: 'Repository state moved. Refresh evidence before approving.', tone: 'danger' };
    case 'disconnected':
      return { title: 'Orchestrator disconnected', detail: 'Commands are unavailable until the runtime reconnects.', tone: 'danger' };
    case 'completed':
      return { title: 'Execution completed', detail: 'The run reached a terminal successful state.', tone: 'success' };
    default:
      return null;
  }
}

function formatTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

export default function WorkspaceExecutionTab({
  repoPath,
  repoId,
  repoLabel,
}: WorkspaceExecutionTabProps) {
  const effectiveRepoId = repoId || repoPath;
  const [sessions, setSessions] = useState<OrchestratorSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<OrchestratorSession | null>(null);
  const [health, setHealth] = useState<OrchestratorHealth | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [adapterId, setAdapterId] = useState<OrchestratorAdapterId>('native');
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [healthResult, sessionResult] = await Promise.all([
        getOrchestratorHealth(),
        listOrchestratorSessions(),
      ]);
      const matching = sessionResult.filter((item) => item.repoId === effectiveRepoId);
      setHealth(healthResult);
      setConnected(healthResult.ok);
      setSessions(matching);
      const nextId = selectedId && matching.some((item) => item.sessionId === selectedId)
        ? selectedId
        : matching[0]?.sessionId ?? null;
      setSelectedId(nextId);
      setSession(nextId ? await getOrchestratorSession(nextId) : null);
    } catch (requestError) {
      const details = readOrchestratorError(requestError);
      setConnected(false);
      setError(details.message);
      setErrorCode(details.code);
    } finally {
      setLoading(false);
    }
  }, [effectiveRepoId, selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) return undefined;
    return openOrchestratorEventStream(selectedId, {
      onOpen: () => setConnected(true),
      onError: () => setConnected(false),
      onEvent: () => {
        void getOrchestratorSession(selectedId).then(setSession);
      },
    });
  }, [selectedId]);

  const runCommand = useCallback(async (
    action: 'retry' | 'resume' | 'cancel' | 'approvals' | 'input',
    payload: Record<string, unknown> = {},
  ) => {
    if (!session) return;
    try {
      setBusyAction(action);
      setError(null);
      setErrorCode(null);
      const updated = await mutateOrchestratorSession(session, action, payload);
      setSession(updated);
      setSessions((current) => current.map((item) => (
        item.sessionId === updated.sessionId ? updated : item
      )));
    } catch (requestError) {
      const details = readOrchestratorError(requestError);
      setError(details.message);
      setErrorCode(details.code);
    } finally {
      setBusyAction(null);
    }
  }, [session]);

  const createSession = useCallback(async () => {
    try {
      setBusyAction('create');
      setError(null);
      const created = await createOrchestratorSession({
        repoId: effectiveRepoId,
        title: title.trim() || `${repoLabel || 'Repository'} execution`,
        adapterId,
      });
      setSessions((current) => [created, ...current]);
      setSelectedId(created.sessionId);
      setSession(created);
      setTitle('');
    } catch (requestError) {
      const details = readOrchestratorError(requestError);
      setError(details.message);
      setErrorCode(details.code);
    } finally {
      setBusyAction(null);
    }
  }, [adapterId, effectiveRepoId, repoLabel, title]);

  const presentation = deriveExecutionPresentation(session, connected, errorCode);
  const warning = stateCopy(presentation);
  const workPoint = latest(session?.workPoints ?? []);
  const approval = latest(session?.approvals ?? []);
  const inputRequest = latest(session?.inputRequests ?? []);
  const validation = readRecord(workPoint?.validation);
  const evidence = readRecord(workPoint?.evidence);
  const lease = readRecord(workPoint?.lease);
  const planning = session?.planning ?? null;
  const approvalStatus = readString(approval, 'status');
  const approvalPending = Boolean(approval) && !['stale', 'approved', 'rejected'].includes(approvalStatus || '');
  const evidencePatch = readString(evidence, 'patch') ?? readString(evidence, 'diff');
  const adapterAvailability = useMemo(() => new Map(
    (health?.adapters ?? []).map((adapter) => [adapter.adapterId, adapter.available]),
  ), [health]);
  const planningRefs = useMemo(() => [
    ['Goal', readString(planning, 'goalId')],
    ['Roadmap', readString(planning, 'roadmapId')],
    ['Work point', readString(planning, 'workPointId')],
  ].filter((item): item is [string, string] => Boolean(item[1])), [planning]);

  return (
    <div className="workspace-execution-tab" data-testid="workspace-execution-tab">
      <div className="workspace-execution-toolbar">
        <div>
          <h2>Execution</h2>
          <p>Run isolated workers, inspect observed evidence, and approve repository actions.</p>
        </div>
        <div className="workspace-execution-health">
          <HealthDot
            tone={connected ? 'ok' : 'error'}
            label={connected ? 'Runtime connected' : 'Runtime disconnected'}
            testId="workspace-execution-connection"
          />
          <Button variant="ghost" size="sm" onClick={() => void load()} testId="workspace-execution-refresh">
            <AppIcon name="refresh" size={15} /> Refresh
          </Button>
        </div>
      </div>

      {warning && (
        <div
          className={`workspace-execution-alert workspace-execution-alert--${warning.tone}`}
          data-testid={`workspace-execution-state-${presentation}`}
        >
          <AppIcon name={warning.tone === 'success' ? 'success' : 'warning'} size={18} />
          <div><strong>{warning.title}</strong><span>{warning.detail}</span></div>
        </div>
      )}
      {error && <div className="workspace-execution-error" role="alert">{error}</div>}

      <Panel title="New session" subtitle={repoPath} testId="workspace-execution-create">
        <div className="workspace-execution-create-row">
          <FormInput
            label="Session title"
            value={title}
            placeholder={`${repoLabel || 'Repository'} execution`}
            onValueChange={setTitle}
            testId="workspace-execution-title"
          />
          <label className="form-input" htmlFor="workspace-execution-adapter">
            <span className="form-label">Worker</span>
            <select
              id="workspace-execution-adapter"
              className="form-select"
              value={adapterId}
              onChange={(event) => setAdapterId(event.target.value as OrchestratorAdapterId)}
              data-testid="workspace-execution-adapter"
            >
              <option value="native">Native checks</option>
              <option value="codex-exec" disabled={adapterAvailability.get('codex-exec') === false}>Codex</option>
              <option value="opencode-acp" disabled={adapterAvailability.get('opencode-acp') === false}>OpenCode</option>
            </select>
          </label>
          <Button
            onClick={() => void createSession()}
            disabled={!connected || busyAction === 'create'}
            testId="workspace-execution-create-button"
          >
            <AppIcon name="play" size={15} />
            {busyAction === 'create' ? 'Creating…' : 'Create session'}
          </Button>
        </div>
      </Panel>

      <div className="workspace-execution-layout">
        <Panel
          title="Sessions"
          subtitle={`${sessions.length} for this repository`}
          testId="workspace-execution-sessions"
        >
          {loading ? <p className="state-message">Loading execution sessions…</p> : null}
          {!loading && sessions.length === 0 ? (
            <p className="state-message">No execution sessions for this repository.</p>
          ) : null}
          <div className="workspace-execution-session-list">
            {sessions.map((item) => (
              <button
                key={item.sessionId}
                type="button"
                className={`workspace-execution-session${selectedId === item.sessionId ? ' is-active' : ''}`}
                onClick={() => {
                  setSelectedId(item.sessionId);
                  setSession(item);
                }}
                data-testid={`workspace-execution-session-${item.sessionId}`}
              >
                <span><strong>{item.title}</strong><small>{item.adapterId}</small></span>
                <StatusBadge status={item.state} />
              </button>
            ))}
          </div>
        </Panel>

        <div className="workspace-execution-detail">
          {!session ? (
            <Panel testId="workspace-execution-empty">
              <p className="state-message">Create or select a session to inspect execution state.</p>
            </Panel>
          ) : (
            <>
              <Panel
                title={session.title}
                subtitle={`${session.adapterId} · revision ${session.revision}`}
                testId="workspace-execution-summary"
                actions={<StatusBadge status={session.state} testId="workspace-execution-status" />}
                footer={(
                  <div className="workspace-execution-actions">
                    <Button size="sm" variant="secondary" disabled={!connected || Boolean(busyAction)} onClick={() => void runCommand('retry')}>
                      Retry
                    </Button>
                    <Button size="sm" variant="secondary" disabled={!connected || Boolean(busyAction)} onClick={() => void runCommand('resume')}>
                      Resume
                    </Button>
                    <Button size="sm" variant="danger" disabled={!connected || Boolean(busyAction) || session.state === 'cancelled'} onClick={() => void runCommand('cancel')}>
                      Cancel
                    </Button>
                  </div>
                )}
              >
                <div className="workspace-execution-facts">
                  <span><small>Lease</small><strong>{readString(lease, 'status') || 'not claimed'}</strong></span>
                  <span><small>Journal</small><strong>{health?.journal.ready ? 'ready' : 'unavailable'}</strong></span>
                  <span><small>Recovery</small><strong>{health?.orphanRecovery.ready ? 'ready' : 'blocked'}</strong></span>
                  <span><small>Updated</small><strong>{formatTime(session.updatedAt)}</strong></span>
                </div>
                {planningRefs.length > 0 && (
                  <div className="workspace-execution-planning-links">
                    {planningRefs.map(([label, value]) => (
                      <button
                        type="button"
                        key={label}
                        onClick={() => navigationStore.setActiveWorkspaceLocalTab('planning')}
                      >
                        <AppIcon name="diamond" size={13} /> {label}: {value}
                      </button>
                    ))}
                  </div>
                )}
              </Panel>

              <div className="workspace-execution-detail-grid">
                <Panel title="Work point & evidence" testId="workspace-execution-evidence">
                  {workPoint ? (
                    <dl className="workspace-execution-definition-list">
                      <div><dt>Work point</dt><dd>{readString(workPoint, 'workPointId') || 'Attached work point'}</dd></div>
                      <div><dt>Validation</dt><dd>{readString(validation, 'status') || readString(workPoint, 'validationStatus') || 'pending'}</dd></div>
                      <div><dt>Changed paths</dt><dd>{Array.isArray(evidence?.changedPaths) ? evidence.changedPaths.join(', ') : 'Not verified'}</dd></div>
                      <div><dt>Diff hash</dt><dd className="workspace-execution-mono">{readString(evidence, 'diffHash') || 'Not available'}</dd></div>
                      <div><dt>Result tree</dt><dd className="workspace-execution-mono">{readString(evidence, 'resultTreeSha') || 'Not available'}</dd></div>
                    </dl>
                  ) : <p className="state-message">No work point has been attached.</p>}
                  {evidencePatch && (
                    <pre className="workspace-execution-diff" data-testid="workspace-execution-diff">
                      {evidencePatch}
                    </pre>
                  )}
                </Panel>

                <Panel title="Approval" testId="workspace-execution-approval">
                  {approval ? (
                    <div className="workspace-execution-approval-copy">
                      <Badge tone={approvalStatus === 'stale' ? 'danger' : 'accent'}>
                        {approvalStatus || 'pending'}
                      </Badge>
                      <p>{readString(approval, 'summary') || 'Review the verified repository state.'}</p>
                    </div>
                  ) : <p className="state-message">No approval request is waiting.</p>}
                  <div className="workspace-execution-actions">
                    <Button size="sm" disabled={!connected || !approvalPending || Boolean(busyAction)} onClick={() => void runCommand('approvals', { decision: 'approved', status: 'approved' })}>
                      Approve
                    </Button>
                    <Button size="sm" variant="danger" disabled={!connected || !approvalPending || Boolean(busyAction)} onClick={() => void runCommand('approvals', { decision: 'rejected', status: 'rejected' })}>
                      Reject
                    </Button>
                  </div>
                </Panel>

                <Panel title="Input request" testId="workspace-execution-input">
                  {inputRequest ? (
                    <>
                      <p>{readString(inputRequest, 'prompt') || 'Worker input requested.'}</p>
                      <Button size="sm" variant="secondary" disabled={!connected || Boolean(busyAction)} onClick={() => void runCommand('input', { status: 'answered', value: 'continue' })}>
                        Continue
                      </Button>
                    </>
                  ) : <p className="state-message">No input request is waiting.</p>}
                </Panel>

                <Panel title="Timeline" testId="workspace-execution-timeline">
                  <ol className="workspace-execution-timeline">
                    {session.events.map((event) => (
                      <li key={event.eventId}>
                        <span aria-hidden="true" />
                        <div><strong>{event.eventType}</strong><small>{formatTime(event.occurredAt)}</small></div>
                      </li>
                    ))}
                  </ol>
                </Panel>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
