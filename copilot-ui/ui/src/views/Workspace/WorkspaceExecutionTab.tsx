import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AppIcon,
  Badge,
  Button,
  FormInput,
  HealthDot,
  Panel,
  StatusBadge,
} from '../../components';
import { ApiError } from '../../lib/api/core';
import {
  getExecutionOverview,
  getExecutionRun,
  isExecutionRunActive,
  refreshExecutionCommands,
  runExecutionCommand,
  startExecutionSetup,
  stopExecutionRun,
} from '../../lib/api/execution';
import type {
  ExecutionCommand,
  ExecutionOverview,
  ExecutionRun,
} from '../../lib/api/execution';
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

function readCommandError(error: unknown): string {
  if (error instanceof ApiError && error.payload && typeof error.payload === 'object') {
    const payload = error.payload as Record<string, unknown>;
    return typeof payload.message === 'string' ? payload.message : error.message;
  }
  return error instanceof Error ? error.message : 'Request failed';
}

function commandDisplay(command: ExecutionCommand): string {
  return [command.command, ...(command.args ?? [])].join(' ').trim();
}

function sourceLabel(command: ExecutionCommand): string | null {
  const source = command.source;
  if (!source || source.kind !== 'readme') return null;
  const segments = source.docPath.split(/[\\/]/);
  return segments[segments.length - 1] || source.docPath;
}

function flattenCommands(overview: ExecutionOverview | null): ExecutionCommand[] {
  const out: ExecutionCommand[] = [];
  for (const group of overview?.discovery?.categories ?? []) {
    for (const command of group.commands ?? []) {
      out.push(command);
    }
  }
  return out;
}

const OUTPUT_URL_RE = /(https?:\/\/[^\s<>"']+)/gi;
const OUTPUT_URL_TRAILING_RE = /[.,;!?)\]}\s]+$/;

// Render run output with http(s) addresses (e.g. "Local: http://localhost:5173")
// as clickable links. Pure React nodes — no dangerouslySetInnerHTML.
function renderOutputLinks(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(OUTPUT_URL_RE)) {
    const raw = match[0];
    const href = raw.replace(OUTPUT_URL_TRAILING_RE, '');
    if (href.length === 0) continue;
    nodes.push(text.slice(lastIndex, match.index));
    nodes.push(
      <a
        key={match.index}
        className="workspace-execution-output-link"
        href={href}
        target="_blank"
        rel="noreferrer"
        data-testid={`workspace-execution-output-link-${match.index}`}
      >
        {href}
      </a>,
    );
    if (href.length < raw.length) nodes.push(raw.slice(href.length));
    lastIndex = match.index + raw.length;
  }
  nodes.push(text.slice(lastIndex));
  return nodes;
}

export default function WorkspaceExecutionTab({
  repoPath,
  repoId,
  repoLabel,
}: WorkspaceExecutionTabProps) {
  const effectiveRepoId = repoId || repoPath;
  const [overview, setOverview] = useState<ExecutionOverview | null>(null);
  const [commandsLoading, setCommandsLoading] = useState(true);
  const [commandsError, setCommandsError] = useState<string | null>(null);
  const [busyCommandId, setBusyCommandId] = useState<string | null>(null);
  const [expandedCommands, setExpandedCommands] = useState<ReadonlySet<string>>(new Set());
  const [runOutputs, setRunOutputs] = useState<Record<string, ExecutionRun>>({});

  const loadOverview = useCallback(async () => {
    try {
      setCommandsLoading(true);
      setCommandsError(null);
      const next = await getExecutionOverview(repoPath);
      setOverview(next);
    } catch (requestError) {
      setCommandsError(readCommandError(requestError));
    } finally {
      setCommandsLoading(false);
    }
  }, [repoPath]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const activeRun = overview?.activeRun ?? null;
  const activeRunId = activeRun?.runId ?? null;
  const activeRunStatus = activeRun?.status ?? null;
  useEffect(() => {
    if (!activeRunId || !isExecutionRunActive(activeRunStatus)) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      try {
        const run = await getExecutionRun(activeRunId);
        if (cancelled) return;
        const outputKey = run.commandId ?? run.kind;
        setRunOutputs((current) => ({ ...current, [outputKey]: run }));
        if (!isExecutionRunActive(run.status)) {
          if (timer) clearInterval(timer);
          void loadOverview();
        }
      } catch {
        // transient polling error; keep polling
      }
    };
    void poll();
    timer = setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [activeRunId, activeRunStatus, loadOverview]);

  const runCommand = useCallback(async (commandId: string) => {
    try {
      setBusyCommandId(commandId);
      setCommandsError(null);
      await runExecutionCommand(repoPath, commandId);
      await loadOverview();
    } catch (requestError) {
      setCommandsError(readCommandError(requestError));
    } finally {
      setBusyCommandId(null);
    }
  }, [repoPath, loadOverview]);

  const stopActiveRun = useCallback(async () => {
    if (!activeRun) return;
    try {
      setBusyCommandId(activeRun.commandId ?? 'active-run');
      setCommandsError(null);
      await stopExecutionRun(activeRun.runId);
      await loadOverview();
    } catch (requestError) {
      setCommandsError(readCommandError(requestError));
    } finally {
      setBusyCommandId(null);
    }
  }, [activeRun, loadOverview]);

  const runSetup = useCallback(async () => {
    try {
      setBusyCommandId('setup');
      setCommandsError(null);
      await startExecutionSetup(repoPath);
      await loadOverview();
    } catch (requestError) {
      setCommandsError(readCommandError(requestError));
    } finally {
      setBusyCommandId(null);
    }
  }, [repoPath, loadOverview]);

  const refreshCommands = useCallback(async () => {
    try {
      setCommandsLoading(true);
      setCommandsError(null);
      const discovery = await refreshExecutionCommands(repoPath);
      setOverview((current) => (current ? { ...current, discovery } : current));
    } catch (requestError) {
      setCommandsError(readCommandError(requestError));
    } finally {
      setCommandsLoading(false);
    }
  }, [repoPath]);

  const toggleExpanded = useCallback((commandId: string) => {
    setExpandedCommands((current) => {
      const next = new Set(current);
      if (next.has(commandId)) next.delete(commandId);
      else next.add(commandId);
      return next;
    });
  }, []);

  const setupState = overview?.setup;
  const setupActive = activeRun && activeRun.kind === 'setup';
  const discoveredCommands = flattenCommands(overview);
  const discovery = overview?.discovery ?? null;

  // --- Orchestrator (pilot-gated workers) state, preserved from earlier design ---

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
  const [workersOpen, setWorkersOpen] = useState(true);

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

  const runOrchestratorAction = useCallback(async (
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
  const pilotEnabled = health?.pilot?.enabled ?? true;
  const pilotAdapters = useMemo(
    () => new Set(health?.pilot?.allowedAdapters ?? ['native', 'codex-exec', 'opencode-acp']),
    [health],
  );
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
          <p>Run commands discovered from this repository, then drive worker sessions.</p>
        </div>
        <div className="workspace-execution-health">
          {repoLabel && (
            <Badge tone="accent" testId="workspace-execution-repo-label">
              <AppIcon name="repo" size={13} /> {repoLabel}
            </Badge>
          )}
          {discovery && (
            <span className="workspace-execution-scan-time" data-testid="workspace-execution-scan-time">
              Scanned {formatTime(discovery.detectedAt)}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={() => void refreshCommands()} testId="workspace-execution-commands-refresh">
            <AppIcon name="refresh" size={15} /> Refresh
          </Button>
        </div>
      </div>

      {commandsError && (
        <div className="workspace-execution-error" role="alert" data-testid="workspace-execution-commands-error">
          {commandsError}
        </div>
      )}

      <section className="workspace-execution-commands" data-testid="workspace-execution-commands">
        {discovery?.setup && (
          <Panel
            title="Setup"
            subtitle={discovery.setup.label}
            testId="workspace-execution-setup"
            actions={(
              <StatusBadge
                status={setupState?.status ?? 'not-started'}
                testId="workspace-execution-setup-status"
              />
            )}
          >
            <div className="workspace-execution-setup-row">
              <span>
                {setupActive
                  ? 'Installing dependencies and preparing the workspace…'
                  : setupState?.status === 'done'
                    ? 'Setup completed successfully.'
                    : setupState?.status === 'failed'
                      ? `Setup failed with exit code ${setupState.lastExitCode ?? -1}.`
                      : 'Run the discovered setup command to prepare this repository.'}
              </span>
              <Button
                onClick={() => void (setupActive ? stopActiveRun() : runSetup())}
                disabled={Boolean(busyCommandId) || (activeRun !== null && !setupActive)}
                testId="workspace-execution-setup-button"
              >
                <AppIcon name={setupActive ? 'pause' : 'play'} size={15} />
                {setupActive
                  ? 'Stop setup'
                  : busyCommandId === 'setup'
                    ? 'Starting…'
                    : setupState?.status === 'done' || setupState?.status === 'failed'
                      ? 'Re-run setup'
                      : 'Run setup'}
              </Button>
            </div>
          </Panel>
        )}

        <div className="workspace-execution-command-list">
          {commandsLoading && !discovery ? (
            <Panel testId="workspace-execution-loading">
              <p className="state-message">Discovering repository commands…</p>
            </Panel>
          ) : null}
          {!commandsLoading && discoveredCommands.length === 0 ? (
            <Panel testId="workspace-execution-empty">
              <p className="state-message">
                No commands discovered in this repository. Add npm scripts or shell instructions to a
                README, then press Refresh.
              </p>
            </Panel>
          ) : null}
          {discovery?.categories.map((group) => (
            <div
              className="workspace-execution-group"
              key={group.id}
              data-testid={`workspace-execution-category-${group.id}`}
            >
              <div className="workspace-execution-group-header">
                <strong>{group.label}</strong>
                <span>{group.commands.length}</span>
              </div>
              {group.commands.map((command) => {
                const isActive = activeRun?.commandId === command.id;
                const lastOutcome = overview?.lastRuns?.[command.id];
                const outputRun = isActive ? activeRun : runOutputs[command.id];
                const expanded = expandedCommands.has(command.id);
                const outputText = outputRun
                  ? [outputRun.stdout, outputRun.stderr].filter(Boolean).join('\n')
                  : '';
                return (
                  <div
                    className={`workspace-execution-command${isActive ? ' is-active' : ''}`}
                    key={command.id}
                    data-testid={`workspace-execution-command-${command.id}`}
                  >
                    <div className="workspace-execution-command-main">
                      <div className="workspace-execution-command-copy">
                        <strong>{command.label}</strong>
                        <span className="workspace-execution-mono">{commandDisplay(command)}</span>
                        {command.description ? <small>{command.description}</small> : null}
                      </div>
                      {sourceLabel(command) && (
                        <Badge tone="accent">{sourceLabel(command)}</Badge>
                      )}
                      {command.longRunning && (
                        <Badge tone="brand" testId={`workspace-execution-server-${command.id}`}>
                          Server
                        </Badge>
                      )}
                      <div className="workspace-execution-command-actions">
                        {lastOutcome && (
                          <StatusBadge
                            status={lastOutcome.lastExitCode === 0 ? 'done' : 'failed'}
                            testId={`workspace-execution-outcome-${command.id}`}
                          />
                        )}
                        <Button
                          size="sm"
                          variant={isActive ? 'danger' : 'secondary'}
                          disabled={
                            Boolean(busyCommandId)
                            || (!isActive && activeRun !== null && !setupActive)
                          }
                          onClick={() => void (isActive ? stopActiveRun() : runCommand(command.id))}
                          testId={`workspace-execution-run-${command.id}`}
                        >
                          <AppIcon name={isActive ? 'pause' : 'play'} size={14} />
                          {isActive
                            ? 'Stop'
                            : busyCommandId === command.id
                              ? 'Starting…'
                              : 'Run'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleExpanded(command.id)}
                          testId={`workspace-execution-expand-${command.id}`}
                        >
                          <AppIcon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} />
                        </Button>
                      </div>
                    </div>
                    {expanded && (
                      <pre className="workspace-execution-output" data-testid={`workspace-execution-output-${command.id}`}>
                        {outputText ? renderOutputLinks(outputText) : (isActive ? 'Waiting for output…' : 'Run this command to see its output.')}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <section className="workspace-execution-workers">
        <div className="workspace-execution-workers-toggle">
          <button
            type="button"
            onClick={() => setWorkersOpen((current) => !current)}
            data-testid="workspace-execution-workers-toggle"
            aria-expanded={workersOpen}
          >
            <AppIcon name={workersOpen ? 'chevron-down' : 'chevron-up'} size={15} />
            <strong>Workers & orchestrator sessions</strong>
          </button>
        </div>
        {workersOpen && (
          <div className="workspace-execution-workers-body">
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
            {!pilotEnabled && (
              <div className="workspace-execution-alert workspace-execution-alert--accent" data-testid="workspace-execution-pilot-disabled">
                <AppIcon name="warning" size={18} />
                <div><strong>Experimental pilot is off</strong><span>Set ELEGY_ORCHESTRATOR_EXPERIMENTAL=1 to enable bounded execution.</span></div>
              </div>
            )}

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
                    <option value="native" disabled={!pilotAdapters.has('native')}>Native checks</option>
                    <option value="codex-exec" disabled={!pilotAdapters.has('codex-exec') || adapterAvailability.get('codex-exec') === false}>Codex</option>
                    <option value="opencode-acp" disabled={!pilotAdapters.has('opencode-acp') || adapterAvailability.get('opencode-acp') === false}>OpenCode</option>
                  </select>
                </label>
                <Button
                  onClick={() => void createSession()}
                  disabled={!connected || !pilotEnabled || busyAction === 'create'}
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
                          <Button size="sm" variant="secondary" disabled={!connected || Boolean(busyAction)} onClick={() => void runOrchestratorAction('retry')}>
                            Retry
                          </Button>
                          <Button size="sm" variant="secondary" disabled={!connected || Boolean(busyAction)} onClick={() => void runOrchestratorAction('resume')}>
                            Resume
                          </Button>
                          <Button size="sm" variant="danger" disabled={!connected || Boolean(busyAction) || session.state === 'cancelled'} onClick={() => void runOrchestratorAction('cancel')}>
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
                          <Button size="sm" disabled={!connected || !approvalPending || Boolean(busyAction)} onClick={() => void runOrchestratorAction('approvals', { decision: 'approved', status: 'approved' })}>
                            Approve
                          </Button>
                          <Button size="sm" variant="danger" disabled={!connected || !approvalPending || Boolean(busyAction)} onClick={() => void runOrchestratorAction('approvals', { decision: 'rejected', status: 'rejected' })}>
                            Reject
                          </Button>
                        </div>
                      </Panel>

                      <Panel title="Input request" testId="workspace-execution-input">
                        {inputRequest ? (
                          <>
                            <p>{readString(inputRequest, 'prompt') || 'Worker input requested.'}</p>
                            <Button size="sm" variant="secondary" disabled={!connected || Boolean(busyAction)} onClick={() => void runOrchestratorAction('input', { status: 'answered', value: 'continue' })}>
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
        )}
      </section>
    </div>
  );
}
