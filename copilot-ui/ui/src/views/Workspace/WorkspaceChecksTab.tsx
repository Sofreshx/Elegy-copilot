import { useState, useEffect, useCallback } from 'react';
import { Button } from '../../components';
import { notificationStore } from '../../stores/notificationStore';
import { useStoreValue } from '../../lib/store';
import { checksStore } from '../../stores/checksStore';
import type { RunSession } from '../../stores/checksStore';
import type { GitCheckPlanCandidate, GitCheckResults, GitChecksDiscoverResponse } from '../../lib/api/git';
import { createRepoQualitySetupTask } from '../../lib/api/git';

interface WorkspaceChecksTabProps {
  repoPath: string;
  repoId: string | null;
}

// ─── Profile button config ──────────────────────────────────────────────────
const PROFILE_BUTTONS = [
  { id: 'commit', label: 'Run Commit', profile: 'commit' },
  { id: 'push', label: 'Run Push', profile: 'push' },
  { id: 'ci-local', label: 'Run CI', profile: 'ci-local' },
  { id: 'desktop-preview', label: 'Run Desktop', profile: 'desktop-preview' },
  { id: 'release', label: 'Run Release', profile: 'release' },
] as const;

// ─── Theme constants ────────────────────────────────────────────────────────
const DARK_BG = 'var(--color-surface-0)';
const DARK_BG_2 = 'var(--color-surface-1)';
const DARK_BG_3 = 'var(--color-surface-2)';
const TEXT_PRIMARY = 'var(--color-ink-200)';
const TEXT_SECONDARY = 'var(--color-ink-300)';
const TEXT_MUTED = 'var(--color-ink-400)';
const BORDER = 'var(--color-border)';
const SUCCESS = 'var(--color-success-500)';
const FAILURE = 'var(--color-danger-500)';
const WARNING = 'var(--color-warning-600)';
const INFO = 'var(--color-brand-400)';

type CheckRunAction = 'commit' | 'push' | 'ci-local' | 'release';

function actionForProfile(profile: string): CheckRunAction {
  if (profile === 'commit' || profile === 'push' || profile === 'release') return profile;
  return 'ci-local';
}

// ─── Style objects ──────────────────────────────────────────────────────────
const s = {
  container: {
    padding: '16px',
    color: TEXT_SECONDARY,
    fontSize: '13px',
  } as React.CSSProperties,
  topStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '8px 12px',
    background: DARK_BG_2,
    borderRadius: '6px',
    marginBottom: '12px',
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,
  label: {
    color: TEXT_MUTED,
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  } as React.CSSProperties,
  value: {
    color: TEXT_PRIMARY,
    fontWeight: 500,
  } as React.CSSProperties,
  profileBar: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
  } as React.CSSProperties,
  hooksStatus: {
    padding: '8px 12px',
    background: DARK_BG_2,
    borderRadius: '6px',
    marginBottom: '12px',
  } as React.CSSProperties,
  sectionTitle: {
    color: TEXT_PRIMARY,
    fontSize: '14px',
    fontWeight: 600,
    marginBottom: '8px',
  } as React.CSSProperties,
  laneCard: {
    background: DARK_BG_2,
    borderRadius: '6px',
    border: `1px solid ${BORDER}`,
    marginBottom: '6px',
    overflow: 'hidden',
  } as React.CSSProperties,
  laneRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    color: TEXT_SECONDARY,
    width: '100%',
    textAlign: 'left' as const,
    fontSize: '13px',
  } as React.CSSProperties,
  badge: (bg: string) => ({
    display: 'inline-flex',
    alignItems: 'center',
    padding: '1px 6px',
    borderRadius: '3px',
    fontSize: '10px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.3px',
    color: '#fff',
    background: bg,
  }) as React.CSSProperties,
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '12px',
  } as React.CSSProperties,
  th: {
    textAlign: 'left' as const,
    padding: '6px 8px',
    borderBottom: `1px solid ${BORDER}`,
    color: TEXT_MUTED,
    fontSize: '10px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.3px',
  } as React.CSSProperties,
  td: {
    padding: '6px 8px',
    borderBottom: `1px solid ${BORDER}`,
    color: TEXT_SECONDARY,
  } as React.CSSProperties,
  overlay: {
    position: 'fixed' as const,
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  } as React.CSSProperties,
  dialogBox: {
    background: DARK_BG_2,
    borderRadius: '8px',
    border: `1px solid ${BORDER}`,
    padding: '20px',
    maxWidth: '480px',
    width: '90%',
  } as React.CSSProperties,
  logEntry: {
    padding: '4px 8px',
    borderBottom: `1px solid ${BORDER}`,
    fontSize: '11px',
    fontFamily: 'monospace',
    color: TEXT_SECONDARY,
  } as React.CSSProperties,
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return ts;
  }
}

interface LaneInfo {
  name: string;
  cost?: string;
  opensWindow?: boolean;
}

type LaneStatusKind = 'pass' | 'fail' | 'warning' | 'skip' | 'running' | 'not-required' | 'not-run' | 'unknown';
interface DisplayLane {
  status: string;
  exitCode: number | null;
  durationMs: number | null;
  score: number | null;
  details: string;
  group: string | null;
  blocking: boolean;
  ciWorkflow: string | null;
  ciJob: string | null;
  ciRequired: boolean;
  required?: boolean;
  skippable?: boolean;
  cost?: string;
  opensWindow?: boolean;
  defaultProfiles?: string[];
  provenance?: string | null;
  source?: string | null;
  commandProvenance?: { source?: string; path?: string; field?: string; job?: string | null };
  commands: Array<{ command: string; exitCode: number | null; success: boolean; durationMs: number | null }>;
}

function normalizeLaneStatus(status: string | undefined): LaneStatusKind {
  const value = String(status || '').trim().toUpperCase().replace(/[_\s]+/g, '-');
  switch (value) {
    case 'PASS':
      return 'pass';
    case 'FAIL':
      return 'fail';
    case 'WARN':
    case 'WARNING':
      return 'warning';
    case 'SKIP':
    case 'SKIPPED':
      return 'skip';
    case 'RUNNING':
      return 'running';
    case 'NOT-REQUIRED':
      return 'not-required';
    case '':
    case 'CONFIGURED':
    case 'NOT-RUN':
      return 'not-run';
    default:
      return 'unknown';
  }
}

function getLaneStatusView(status: string | undefined): {
  kind: LaneStatusKind;
  icon: string;
  label: string;
  color: string;
  background: string;
  borderColor: string;
} {
  const kind = normalizeLaneStatus(status);
  switch (kind) {
    case 'pass':
      return { kind, icon: 'ok', label: 'PASS', color: SUCCESS, background: 'var(--color-success-50)', borderColor: 'var(--color-success-500)' };
    case 'fail':
      return { kind, icon: 'x', label: 'FAIL', color: FAILURE, background: 'var(--color-danger-50)', borderColor: 'var(--color-danger-500)' };
    case 'skip':
      return { kind, icon: '-', label: 'SKIP', color: TEXT_MUTED, background: 'var(--color-surface-2)', borderColor: BORDER };
    case 'running':
      return { kind, icon: 'run', label: 'RUNNING', color: INFO, background: 'rgba(120, 184, 176, 0.12)', borderColor: 'var(--color-brand-400)' };
    case 'warning':
      return { kind, icon: '!', label: 'WARNING', color: WARNING, background: 'var(--color-warning-50)', borderColor: 'var(--color-warning-200)' };
    case 'not-required':
      return { kind, icon: '—', label: 'NOT REQUIRED', color: TEXT_MUTED, background: 'var(--color-surface-1)', borderColor: BORDER };
    case 'not-run':
      return { kind, icon: '-', label: 'NOT RUN', color: TEXT_MUTED, background: 'var(--color-surface-1)', borderColor: BORDER };
    default:
      return { kind, icon: '?', label: 'UNKNOWN', color: WARNING, background: 'var(--color-warning-50)', borderColor: 'var(--color-warning-200)' };
  }
}

function discoveredToLane(check: GitChecksDiscoverResponse['checks'][number]): DisplayLane {
  const commands = check.path && check.path !== '(configured)'
    ? check.path.split(', ').map((command) => ({ command, exitCode: null, success: true, durationMs: null }))
    : [];

  return {
    status: 'NOT_RUN',
    exitCode: null,
    durationMs: null,
    score: null,
    details: check.description || 'Configured check lane. This lane has not run yet.',
    group: check.group || null,
    blocking: check.blocking !== false,
    ciWorkflow: check.ciWorkflow || null,
    ciJob: check.ciJob || null,
    ciRequired: check.ciRequired === true,
    required: check.required,
    skippable: check.skippable,
    cost: check.cost,
    opensWindow: check.opensWindow,
    defaultProfiles: check.defaultProfiles,
    source: check.source,
    commands,
  };
}

function planCandidateToLane(check: GitCheckPlanCandidate): DisplayLane {
  return {
    status: 'NOT_RUN',
    exitCode: null,
    durationMs: null,
    score: null,
    details: check.description || `${check.classification} candidate discovered from ${check.provenance || check.source || 'repository metadata'}.`,
    group: check.kind || null,
    blocking: check.blocking === true,
    ciWorkflow: check.ciWorkflow || null,
    ciJob: check.ciJob || null,
    ciRequired: check.ciRequired === true,
    required: check.required === true,
    skippable: check.skippable === true,
    cost: check.cost,
    opensWindow: check.opensWindow === true,
    defaultProfiles: check.defaultProfiles || [],
    provenance: check.provenance || null,
    source: check.source || null,
    commandProvenance: check.commandProvenance,
    commands: (check.commands || []).map((command) => ({ command, exitCode: null, success: true, durationMs: null })),
  };
}

function getHeavyLanes(
  lanes: Record<string, { cost?: string; opensWindow?: boolean; defaultProfiles?: string[] }> | undefined,
  profile: string,
): LaneInfo[] {
  if (!lanes) return [];
  const result: LaneInfo[] = [];
  for (const [name, lane] of Object.entries(lanes)) {
    if (lane.cost === 'heavy' || lane.opensWindow) {
      const profiles = lane.defaultProfiles;
      if (!profiles || profiles.length === 0 || profiles.includes(profile) || profile === 'all') {
        result.push({ name, cost: lane.cost, opensWindow: lane.opensWindow });
      }
    }
  }
  return result;
}

function getProfileLabel(profile: string): string {
  return profile === 'all' ? 'everything' : profile;
}

function resolveTargetLaneNames(
  lanes: Record<string, DisplayLane>,
  profile: string,
): string[] {
  const names = Object.keys(lanes).sort();
  if (profile === 'all') return names;
  return names.filter((name) => {
    const profiles = lanes[name].defaultProfiles;
    return Array.isArray(profiles) && profiles.includes(profile);
  });
}

function buildRunTrace(session: RunSession | null, backendLogs: GitCheckResults['logs'] = []) {
  if (!session) return backendLogs;
  const trace = [
    {
      timestamp: session.startedAt,
      event: 'run_start',
      lane: session.label,
      status: 'running',
      reason: `${session.targetLanes.length} lane(s) selected`,
    },
    ...backendLogs,
  ];
  if (session.endedAt) {
    trace.push({
      timestamp: session.endedAt,
      event: session.outcome === 'error' ? 'run_error' : 'run_end',
      lane: session.label,
      status: session.outcome,
      reason: session.error || session.results?.message,
    });
  }
  return trace;
}

function buildRunHandoff(session: RunSession | null): string {
  if (!session) return '';
  const failed = (session.results?.results ?? [])
    .filter((result) => !result.passed)
    .map((result) => result.checkName);
  const lines = [
    `Check run trace`,
    `Repo: ${session.results?.repoRoot || session.repoPath}`,
    `Profile: ${session.label}`,
    `Started: ${session.startedAt}`,
    `Ended: ${session.endedAt || 'still running'}`,
    `Outcome: ${session.outcome}`,
    `Selected lanes: ${session.targetLanes.join(', ') || 'none'}`,
  ];
  if (session.results) {
    lines.push(`Summary: ${session.results.message}`);
    lines.push(`Counts: ${session.results.checksPassed} passed, ${session.results.checksFailed} failed, ${session.results.checksRun} run`);
  }
  if (failed.length > 0) {
    lines.push(`Failed lanes: ${failed.join(', ')}`);
  }
  if (session.error) {
    lines.push(`Error: ${session.error}`);
  }
  if (session.results?.errorOutput) {
    lines.push(`Error output:\n${session.results.errorOutput.trim()}`);
  }
  return lines.join('\n');
}

// ─── Component ──────────────────────────────────────────────────────────────
export default function WorkspaceChecksTab({ repoPath, repoId }: WorkspaceChecksTabProps) {
  const storeState = useStoreValue(checksStore.store);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState<'release' | 'everything' | null>(null);
  const [showLogConsole, setShowLogConsole] = useState(false);
  const [logFilter, setLogFilter] = useState('');
  const [expandedLane, setExpandedLane] = useState<string | null>(null);
  const [confirmHeavyLanes, setConfirmHeavyLanes] = useState<LaneInfo[]>([]);
  const [profileBarOpen, setProfileBarOpen] = useState(false);
  const [setupTaskPrompt, setSetupTaskPrompt] = useState<string | null>(null);
  const [startingSetupTask, setStartingSetupTask] = useState(false);
  const [historySource, setHistorySource] = useState<'local' | 'github'>('local');
  const [historyBranch, setHistoryBranch] = useState<'current' | 'all'>('current');

  const {
    runSession,
    runningChecks,
    checkResults,
    checkState,
    ciSync,
    discoveredChecks,
    qualityStatus,
    checkPlan,
    githubHistory: githubHistoryResponse,
    error,
    loading,
    remoteLoading,
    remoteError,
    sections,
  } = storeState;

  // ─── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!repoPath) return;
    void checksStore.load(repoPath);
    void checksStore.loadRemote(repoPath, { allBranches: true });
  }, [repoPath]);

  // ─── Derived data ──────────────────────────────────────────────────────────
  const repoName = repoPath.split(/[/\\]/).filter(Boolean).pop() || repoPath;

  const lastRun = checkState?.lastRun;
  const lastRunTimestamp = lastRun?.timestamp || null;
  const overallPass = lastRun?.overallPass;
  const compositeScore = lastRun?.compositeScore;
  const freshness = checkState?.freshness;
  const recommendedChecks = checkPlan?.recommendedChecks ?? [];
  const recommendedProfile = checkPlan?.action && ['commit', 'push', 'ci-local', 'release'].includes(checkPlan.action)
    ? checkPlan.action
    : 'commit';
  const ciGapCount = ciSync?.syncResult?.summary?.gaps ?? 0;
  const allLanes = lastRun?.lanes ?? {};
  const baseDisplayLanes: Record<string, DisplayLane> = {
    ...Object.fromEntries((discoveredChecks?.checks ?? []).map((check) => [check.name, discoveredToLane(check)])),
    ...Object.fromEntries((checkPlan?.candidates ?? []).map((check) => [check.id, planCandidateToLane(check)])),
    ...allLanes,
  };
  const runningLaneNames = new Set(runSession?.outcome === 'running' ? runSession.targetLanes : []);
  const displayLanes: Record<string, DisplayLane> = Object.fromEntries(
    Object.entries(baseDisplayLanes).map(([name, lane]) => [
      name,
      runningLaneNames.has(name)
        ? {
          ...lane,
          status: 'RUNNING',
          details: `Running ${runSession?.label || 'selected'} profile. Waiting for process output.`,
          durationMs: null,
          exitCode: null,
        }
        : lane,
    ]),
  );
  const laneNames = Object.keys(displayLanes);
  const laneStatusCounts = laneNames.reduce(
    (counts, name) => {
      const kind = getLaneStatusView(displayLanes[name].status).kind;
      counts[kind] += 1;
      return counts;
    },
    { pass: 0, fail: 0, warning: 0, skip: 0, running: 0, 'not-required': 0, 'not-run': 0, unknown: 0 } as Record<LaneStatusKind, number>,
  );
  const currentBranch = checkPlan?.affectedScope.branch || lastRun?.branch || qualityStatus?.remote.branch || null;
  const localHistory = [
    ...(checkState?.lastRun ? [checkState.lastRun] : []),
    ...(checkState?.history ?? []),
  ].slice(0, 25) as Array<{
    runId?: string | null;
    timestamp?: string;
    profile?: string | null;
    overallPass?: boolean;
    branch?: string | null;
    head?: string | null;
    planHash?: string | null;
    source?: string | null;
    lanes?: Record<string, { durationMs?: number; status?: string }>;
  }>;
  const githubHistory = githubHistoryResponse?.runs ?? qualityStatus?.remote.runs ?? [];
  const filteredGithubHistory = githubHistory
    .filter((entry) => {
      if (historyBranch === 'all' || !currentBranch) return true;
      const branch = String(entry.headBranch || entry.branch || entry.ref || '')
        .replace(/^refs\/heads\//, '');
      return !branch || branch === currentBranch;
    })
    .slice(0, 10);
  const githubHistoryAvailable = githubHistoryResponse?.available ?? qualityStatus?.remote.available ?? false;
  const githubHistoryReason = githubHistoryResponse?.reason || qualityStatus?.remote.reason || null;
  const filteredLocalHistory = localHistory
    .filter((entry) => historyBranch === 'all' || !currentBranch || !entry.branch || entry.branch === currentBranch)
    .slice(0, 10);

  // Freshness display
  let freshnessLabel: string;
  let freshnessColor: string;
  if (loading) {
    freshnessLabel = 'loading...';
    freshnessColor = TEXT_MUTED;
  } else if (!freshness) {
    freshnessLabel = 'no-prior-run';
    freshnessColor = TEXT_MUTED;
  } else if (freshness.fresh) {
    freshnessLabel = 'fresh';
    freshnessColor = SUCCESS;
  } else {
    freshnessLabel = 'stale';
    freshnessColor = WARNING;
  }

  // Group lanes by group field
  const groupedLanes = new Map<string, string[]>();
  for (const name of laneNames) {
    const group = displayLanes[name].group || 'ungrouped';
    if (!groupedLanes.has(group)) groupedLanes.set(group, []);
    groupedLanes.get(group)!.push(name);
  }
  const groupEntries = Array.from(groupedLanes.entries());

  // ─── Handlers ──────────────────────────────────────────────────────────────
  function handleRunProfile(profile: string, selectionMode = 'profile') {
    const action = actionForProfile(profile);
    // Explicit profile runs honor the adopted/discovered profile membership.
    // The change-aware plan has its own one-click action below; it must not
    // silently replace a user's request for a named profile.
    const targetLanes = resolveTargetLaneNames(baseDisplayLanes, profile);
    setShowLogConsole(true);
    void checksStore.startRun(repoPath, profile, getProfileLabel(profile), targetLanes, {
      selectionMode,
      action,
      selectedLanes: targetLanes,
    });
  }

  function handleRunRecommended() {
    if (!checkPlan || recommendedChecks.length === 0) {
      setProfileBarOpen(true);
      return;
    }
    setActiveProfile(recommendedProfile);
    setShowLogConsole(true);
    void checksStore.startRun(
      repoPath,
      recommendedProfile,
      `recommended ${recommendedProfile}`,
      recommendedChecks.map((check) => check.id),
      {
        selectionMode: 'recommended',
        action: actionForProfile(recommendedProfile),
        selectedLanes: recommendedChecks.map((check) => check.id),
      },
    );
  }

  const handleRefresh = useCallback(() => {
    void checksStore.refresh(repoPath);
    void checksStore.loadRemote(repoPath, { allBranches: true });
  }, [repoPath]);

  function handleProfileClick(profile: string) {
    setActiveProfile(profile);
    if (profile === 'release') {
      const heavy = getHeavyLanes(displayLanes, 'release');
      if (heavy.length > 0) {
        setConfirmHeavyLanes(heavy);
        setShowConfirmDialog('release');
        return;
      }
    }
    void handleRunProfile(profile);
  }

  function handleRunEverything() {
    setActiveProfile('all');
    const heavy = getHeavyLanes(displayLanes, 'all');
    if (heavy.length > 0) {
      setConfirmHeavyLanes(heavy);
      setShowConfirmDialog('everything');
      return;
    }
    void handleRunProfile('all');
  }

  function handleConfirmRun() {
    const profile = showConfirmDialog === 'everything' ? 'all' : 'release';
    setShowConfirmDialog(null);
    setConfirmHeavyLanes([]);
    void handleRunProfile(profile);
  }

  function handleCancelConfirm() {
    setShowConfirmDialog(null);
    setConfirmHeavyLanes([]);
  }

  async function handleQualityPrimaryAction() {
    if (!qualityStatus) return;
    if (qualityStatus.readiness === 'setup-required' || qualityStatus.readiness === 'repair-required') {
      setStartingSetupTask(true);
      try {
        const result = await createRepoQualitySetupTask(repoPath);
        if (result.launched) {
          notificationStore.success('Repository quality task started');
        } else {
          setSetupTaskPrompt(result.prompt);
        }
      } catch (err) {
        notificationStore.error(`Failed to start setup task: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setStartingSetupTask(false);
      }
      return;
    }
    if (qualityStatus.readiness === 'local-failing') {
      setProfileBarOpen(true);
      return;
    }
    void checksStore.refresh(repoPath);
    void checksStore.loadRemote(repoPath, { allBranches: true });
  }

  function renderReadiness() {
    if (!qualityStatus) return null;
    const readinessLabels: Record<string, string> = {
      ready: 'Ready',
      unsupported: 'Not supported yet',
      'setup-required': 'Setup required',
      'repair-required': 'Migration required',
      'local-failing': 'Local checks failing',
      'remote-failing': 'GitHub checks failing',
      'remote-unknown': 'GitHub status unavailable',
    };
    const hooksLabel = qualityStatus.local.hooks.configured && qualityStatus.local.hooks.active
      ? qualityStatus.local.hooks.manager
      : 'Not configured';
    const githubLabel = sections.githubStatus.loading && qualityStatus.remote.deferred
      ? 'Loading…'
      : qualityStatus.remote.available
      ? qualityStatus.remote.latestConclusion || 'Connected'
      : 'Unavailable';
    return (
      <section style={{ ...s.hooksStatus, border: `1px solid ${BORDER}`, padding: 16 }} data-testid="workspace-checks-readiness">
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <div style={s.label}>Repository quality</div>
            <h2 style={{ color: TEXT_PRIMARY, fontSize: 20, margin: '4px 0 10px' }}>
              {readinessLabels[qualityStatus.readiness] || qualityStatus.readiness}
            </h2>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <div><span style={s.label}>Hooks</span><div style={s.value}>{hooksLabel}</div></div>
              <div><span style={s.label}>Local proof</span><div style={s.value}>{qualityStatus.local.lastProof ? (qualityStatus.local.lastProof.overallPass ? 'Passing' : 'Failing') : 'Not run'}</div></div>
              <div><span style={s.label}>GitHub</span><div style={s.value}>{githubLabel}</div></div>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={startingSetupTask}
            onClick={() => void handleQualityPrimaryAction()}
            testId="workspace-checks-primary-action"
          >
            {startingSetupTask ? 'Starting...' : qualityStatus.nextAction.label}
          </Button>
        </div>
        {qualityStatus.drift.length > 0 && (
          <div style={{ marginTop: 12, color: WARNING }}>
            {qualityStatus.drift.map((item) => <div key={item.id}>{item.message}</div>)}
          </div>
        )}
        {ciGapCount > 0 && (
          <div style={{ marginTop: 12, color: WARNING }} data-testid="workspace-checks-ci-gap">
            {ciGapCount} GitHub job(s) have no local lane mapping. Local proof remains separate from remote evidence.
          </div>
        )}
        {sections.githubStatus.error && (
          <div style={{ marginTop: 12, color: WARNING }} data-testid="workspace-checks-github-status-error">
            GitHub status refresh failed: {sections.githubStatus.error}
          </div>
        )}
        {setupTaskPrompt && (
          <pre data-testid="workspace-checks-setup-prompt" style={{ margin: '12px 0 0', padding: 10, background: DARK_BG, whiteSpace: 'pre-wrap' }}>
            {setupTaskPrompt}
          </pre>
        )}
      </section>
    );
  }

  function renderRecommendation() {
    const recommendationError = sections.checkPlan.error;
    if (recommendationError) {
      return (
        <section style={{ ...s.hooksStatus, border: `1px solid ${FAILURE}`, marginBottom: 12 }} data-testid="workspace-checks-error">
          <div style={s.label}>Checks unavailable</div>
          <div style={{ color: FAILURE, marginTop: 4 }}>{recommendationError}</div>
          <div style={{ marginTop: 8 }}>
            <Button variant="ghost" size="sm" onClick={handleRefresh}>
              Retry discovery
            </Button>
          </div>
        </section>
      );
    }
    if (!checkPlan) {
      return (
        <section style={{ ...s.hooksStatus, border: `1px solid ${BORDER}`, marginBottom: 12 }} data-testid="workspace-checks-recommendation-loading">
          <div style={s.label}>Recommended for this change</div>
          <div style={{ color: TEXT_MUTED, marginTop: 4 }}>Inspecting repository policy and affected scope…</div>
        </section>
      );
    }
    const remoteCount = checkPlan.remoteEvidence?.length ?? checkPlan.candidates.filter((check) => check.classification === 'remote-only').length;
    const adopted = checkPlan.discoveryMode?.includes('adopted') || checkPlan.candidates.some((check) => check.provenance === 'adopted-policy');
    return (
      <section style={{ ...s.hooksStatus, border: `1px solid ${BORDER}`, marginBottom: 12 }} data-testid="workspace-checks-recommendation">
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 260, flex: 1 }}>
            <div style={s.label}>Recommended for this change</div>
            <h2 style={{ color: TEXT_PRIMARY, fontSize: 18, margin: '4px 0 8px' }}>
              {recommendedChecks.length > 0 ? `${recommendedChecks.length} local proof lane${recommendedChecks.length === 1 ? '' : 's'}` : 'No executable local proof selected'}
            </h2>
            <div style={{ color: TEXT_SECONDARY, lineHeight: 1.45 }}>{checkPlan.selectionRationale}</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, color: TEXT_MUTED, fontSize: 11 }}>
              <span>Action: {checkPlan.action}</span>
              <span>Cost: {checkPlan.expectedCost.tier}</span>
              <span>Branch: {checkPlan.affectedScope.branch || 'detached'}</span>
              <span>Source: {adopted ? 'adopted policy + discovery' : 'zero-config discovery'}</span>
              {remoteCount > 0 && <span>{remoteCount} remote-only lane{remoteCount === 1 ? '' : 's'}</span>}
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={runningChecks || recommendedChecks.length === 0}
            loading={runningChecks && activeProfile === recommendedProfile}
            onClick={() => handleRunRecommended()}
            testId="workspace-checks-recommended-run"
          >
            Run recommended proof
          </Button>
        </div>
        {!adopted && recommendedChecks.length > 0 && (
          <div style={{ marginTop: 10, color: WARNING, fontSize: 12 }}>
            Discovery is read-only. This run uses an ephemeral plan; adopt the policy separately if you want hooks and durable metadata.
          </div>
        )}
      </section>
    );
  }

  // ─── Render: Top Strip ─────────────────────────────────────────────────────
  function renderTopStrip() {
    const isRunning = runSession?.outcome === 'running';
    return (
      <div style={s.topStrip} data-testid="workspace-checks-top-strip">
        {/* Repo name */}
        <div>
          <div style={s.label}>Repo</div>
          <div style={s.value} title={repoPath}>{repoName}</div>
        </div>

        <div>
          <div style={s.label}>Branch</div>
          <div style={s.value}>{checkPlan?.affectedScope.branch || lastRun?.branch || 'detached'}</div>
        </div>

        <div>
          <div style={s.label}>Evidence source</div>
          <div style={s.value}>{lastRun?.sourceKind || (lastRun?.source === 'elegy-checks' ? 'local' : lastRun?.source) || 'local'}</div>
        </div>

        {/* Last run timestamp */}
        <div>
          <div style={s.label}>Last Run</div>
          <div style={s.value}>
            {lastRunTimestamp ? formatTimestamp(lastRunTimestamp) : '—'}
          </div>
        </div>

        {/* Freshness */}
        <div>
          <div style={s.label}>Freshness</div>
          <div style={{ ...s.value, color: freshnessColor }}>{freshnessLabel}</div>
        </div>

        {/* Active profile */}
        <div>
          <div style={s.label}>Profile</div>
          <div style={s.value}>{isRunning ? runSession.label : activeProfile || (lastRun?.profile) || '—'}</div>
        </div>

        {/* Overall result */}
        <div>
          <div style={s.label}>Result</div>
          <div style={s.value}>
            {isRunning ? (
              <span style={{ color: INFO }}>RUNNING</span>
            ) : lastRun ? (
              <>
                {overallPass ? 'PASS' : 'FAIL'}
                {compositeScore !== null && compositeScore !== undefined && (
                  <span style={{ color: TEXT_MUTED, marginLeft: 4 }}>
                    (score: {compositeScore})
                  </span>
                )}
              </>
            ) : (
              <span style={{ color: TEXT_MUTED }}>—</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderRunStatus() {
    if (!runSession) return null;
    const isRunning = runSession.outcome === 'running';
    const color = runSession.outcome === 'pass' ? SUCCESS
      : runSession.outcome === 'fail' || runSession.outcome === 'error' ? FAILURE
        : INFO;
    return (
      <div
        style={{
          marginBottom: 12,
          padding: '10px 12px',
          border: `1px solid ${color}`,
          borderRadius: 6,
          background: isRunning ? 'rgba(33, 150, 243, 0.10)' : DARK_BG_2,
          color: TEXT_SECONDARY,
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
        data-testid="workspace-checks-run-status"
      >
        <span style={{ color, fontWeight: 700 }}>
          {isRunning ? 'RUNNING' : runSession.outcome.toUpperCase()}
        </span>
        <span>
          {runSession.label} profile
        </span>
        <span style={{ color: TEXT_MUTED }}>
          {runSession.targetLanes.length} lane(s)
        </span>
        <span style={{ color: TEXT_MUTED }}>
          started {formatTimestamp(runSession.startedAt)}
        </span>
        {runSession.endedAt && (
          <span style={{ color: TEXT_MUTED }}>
            ended {formatTimestamp(runSession.endedAt)}
          </span>
        )}
        {runSession.error && (
          <span style={{ color: FAILURE }}>{runSession.error}</span>
        )}
      </div>
    );
  }

  // ─── Render: Profile Controls ──────────────────────────────────────────────
  function renderProfileBar() {
    return (
      <div style={s.profileBar} data-testid="workspace-checks-profile-bar">
        {PROFILE_BUTTONS.map((btn) => (
          <Button
            key={btn.id}
            variant="secondary"
            size="sm"
            disabled={runningChecks}
            loading={runningChecks && activeProfile === btn.profile}
            onClick={() => handleProfileClick(btn.profile)}
            testId={`workspace-checks-profile-${btn.id}`}
          >
            {btn.label}
          </Button>
        ))}

        <Button
          variant="primary"
          size="sm"
          disabled={runningChecks}
          loading={runningChecks && activeProfile === 'all'}
          onClick={handleRunEverything}
          testId="workspace-checks-run-everything"
        >
          Run Everything
        </Button>

        <Button
          variant="ghost"
          size="sm"
          disabled={runningChecks}
          onClick={handleRefresh}
          testId="workspace-checks-refresh"
        >
          Refresh
        </Button>
      </div>
    );
  }

  // ─── Render: Confirmation Dialog ──────────────────────────────────────────
  function renderConfirmDialog() {
    if (!showConfirmDialog) return null;
    const profileLabel = showConfirmDialog === 'release' ? 'Release' : 'Everything';

    return (
      <div style={s.overlay} data-testid="workspace-checks-confirm-dialog">
        <div style={s.dialogBox}>
          <h3 style={{ color: TEXT_PRIMARY, margin: '0 0 12px', fontSize: '15px' }}>
            Run {profileLabel} checks?
          </h3>
          <p style={{ color: WARNING, fontSize: '12px', marginBottom: 12 }}>
            This profile contains lanes that are{' '}
            <strong>heavy</strong> or <strong>open windows</strong>:
          </p>
          <ul style={{ margin: '0 0 16px', paddingLeft: 20, color: TEXT_SECONDARY, fontSize: '12px' }}>
            {confirmHeavyLanes.map((lane) => (
              <li key={lane.name}>
                <strong>{lane.name}</strong>
                {lane.cost === 'heavy' && lane.opensWindow && (
                  <span> — heavy cost, opens window</span>
                )}
                {lane.cost === 'heavy' && !lane.opensWindow && (
                  <span> — heavy cost</span>
                )}
                {lane.opensWindow && lane.cost !== 'heavy' && (
                  <span> — opens window</span>
                )}
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm" onClick={handleCancelConfirm}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={handleConfirmRun}>
              Run Anyway
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: Lane Matrix ───────────────────────────────────────────────────
  function renderLaneCard(laneName: string) {
    const lane = displayLanes[laneName];
    if (!lane) return null;
    const isExpanded = expandedLane === laneName;
    const statusView = getLaneStatusView(lane.status);

    return (
      <div
        key={laneName}
        style={s.laneCard}
        data-testid={`workspace-checks-lane-${laneName}`}
      >
        {/* Lane row (collapsed) */}
        <button
          type="button"
          style={s.laneRow}
          onClick={() => setExpandedLane(isExpanded ? null : laneName)}
          data-testid={`workspace-checks-lane-toggle-${laneName}`}
        >
          <span
            aria-label={`${laneName} status: ${statusView.label}`}
            title={statusView.label}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              minWidth: 82,
              padding: '2px 7px',
              borderRadius: 999,
              border: `1px solid ${statusView.borderColor}`,
              background: statusView.background,
              color: statusView.color,
              fontSize: 11,
              fontWeight: 700,
              lineHeight: 1.2,
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 13, lineHeight: 1 }}>{statusView.icon}</span>
            <span>{statusView.label}</span>
          </span>
          <span style={{ fontWeight: 500, color: TEXT_PRIMARY, minWidth: 140 }}>
            {laneName}
          </span>

          {lane.group && (
            <span style={s.badge('#455a64')}>{lane.group}</span>
          )}

          {lane.cost && (
            <span style={s.badge(lane.cost === 'heavy' ? FAILURE : lane.cost === 'medium' ? WARNING : SUCCESS)}>
              {lane.cost}
            </span>
          )}

          {lane.required && (
            <span style={s.badge('#1565c0')}>required</span>
          )}

          {lane.skippable && (
            <span style={s.badge('#6a1b9a')}>skippable</span>
          )}

          <div style={{ flex: 1 }} />

          <span style={{ color: TEXT_MUTED, marginRight: 4 }}>
            {formatDuration(lane.durationMs)}
          </span>

          <span style={{ color: TEXT_MUTED, fontSize: '10px' }}>
            {isExpanded ? 'Collapse' : 'Expand'}
          </span>
        </button>

        {/* Expanded detail */}
        {isExpanded && (
          <div
            style={{ padding: '8px 12px 12px', borderTop: `1px solid ${BORDER}` }}
            data-testid={`workspace-checks-lane-detail-${laneName}`}
          >
            {/* Detail excerpt */}
            {lane.details && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: TEXT_MUTED, fontSize: '10px', textTransform: 'uppercase', marginBottom: 4 }}>
                  Output
                </div>
                <pre style={{
                  margin: 0,
                  padding: 8,
                  background: DARK_BG,
                  borderRadius: 4,
                  fontSize: 11,
                  color: TEXT_SECONDARY,
                  maxHeight: 120,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}>
                  {lane.details.slice(0, 500)}
                  {lane.details.length > 500 && (
                    <span style={{ color: TEXT_MUTED, display: 'block', marginTop: 4 }}>
                      ... (truncated, {lane.details.length - 500} more chars)
                    </span>
                  )}
                </pre>
              </div>
            )}

            {/* Commands */}
            {(lane.provenance || lane.commandProvenance) && (
              <div style={{ color: TEXT_MUTED, fontSize: 11, marginBottom: 8 }}>
                Evidence source: {lane.provenance || lane.source || 'repository metadata'}
                {lane.commandProvenance?.path ? ` · ${lane.commandProvenance.path}` : ''}
                {lane.commandProvenance?.field ? ` · ${lane.commandProvenance.field}` : ''}
              </div>
            )}
            {lane.commands && lane.commands.length > 0 && (
              <div>
                <div style={{ color: TEXT_MUTED, fontSize: '10px', textTransform: 'uppercase', marginBottom: 4 }}>
                  Commands ({lane.commands.length})
                </div>
                {lane.commands.map((cmd, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '3px 6px',
                      background: DARK_BG,
                      borderRadius: 3,
                      marginBottom: 3,
                      fontSize: 11,
                      fontFamily: 'monospace',
                    }}
                  >
                    <span style={{ color: normalizeLaneStatus(lane.status) === 'not-run' ? TEXT_MUTED : cmd.success ? SUCCESS : FAILURE }}>
                      {normalizeLaneStatus(lane.status) === 'not-run' ? 'planned' : cmd.success ? 'ok' : 'fail'}
                    </span>
                    <code style={{ flex: 1, color: TEXT_SECONDARY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cmd.command}
                    </code>
                    <span style={{ color: TEXT_MUTED, fontSize: 10 }}>
                      exit={cmd.exitCode}
                    </span>
                    <span style={{ color: TEXT_MUTED, fontSize: 10 }}>
                      {formatDuration(cmd.durationMs)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Exit code & score */}
            <div style={{ display: 'flex', gap: 12, marginTop: lane.commands?.length ? 8 : 0 }}>
              <span style={{ color: TEXT_MUTED, fontSize: 11 }}>
                Exit code: {lane.exitCode}
              </span>
              {lane.score !== null && lane.score !== undefined && (
                <span style={{ color: TEXT_MUTED, fontSize: 11 }}>
                  Score: {lane.score}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderLaneMatrix() {
    return (
      <div style={{ marginBottom: 16 }} data-testid="workspace-checks-lane-matrix">
        <div style={s.sectionTitle}>
          <span>
            Lanes {loading ? '(loading...)' : `(${laneNames.length})`}
          </span>
          {laneNames.length > 0 && (
            <span style={{ display: 'inline-flex', gap: 6, marginLeft: 10, flexWrap: 'wrap', verticalAlign: 'middle' }}>
              {laneStatusCounts.pass > 0 && <span style={{ ...s.badge('var(--color-success-50)'), color: SUCCESS }}>PASS {laneStatusCounts.pass}</span>}
              {laneStatusCounts.fail > 0 && <span style={{ ...s.badge('var(--color-danger-50)'), color: FAILURE }}>FAIL {laneStatusCounts.fail}</span>}
              {laneStatusCounts.warning > 0 && <span style={{ ...s.badge('var(--color-warning-50)'), color: WARNING }}>WARN {laneStatusCounts.warning}</span>}
              {laneStatusCounts.running > 0 && <span style={{ ...s.badge('rgba(120, 184, 176, 0.12)'), color: INFO }}>RUN {laneStatusCounts.running}</span>}
              {laneStatusCounts.skip > 0 && <span style={{ ...s.badge('rgba(154, 160, 166, 0.18)'), color: TEXT_MUTED }}>- {laneStatusCounts.skip}</span>}
              {laneStatusCounts['not-required'] > 0 && <span style={{ ...s.badge('var(--color-surface-2)'), color: TEXT_MUTED }}>NOT REQUIRED {laneStatusCounts['not-required']}</span>}
              {laneStatusCounts['not-run'] > 0 && <span style={{ ...s.badge('var(--color-surface-2)'), color: TEXT_MUTED }}>NOT RUN {laneStatusCounts['not-run']}</span>}
              {laneStatusCounts.unknown > 0 && <span style={{ ...s.badge('rgba(255, 152, 0, 0.20)'), color: WARNING }}>? {laneStatusCounts.unknown}</span>}
            </span>
          )}
        </div>

        {laneNames.length === 0 && !loading && (
          <div style={{ color: TEXT_MUTED, fontStyle: 'italic', padding: '16px 0' }}>
            No lanes available.
          </div>
        )}

        {loading && laneNames.length === 0 && (
          <div style={{ color: TEXT_MUTED, padding: '16px 0' }}>
            Loading lanes...
          </div>
        )}

        {/* Grouped lanes */}
        {groupEntries.map(([group, names]) => (
          <div key={group} style={{ marginBottom: 12 }}>
            {group !== 'ungrouped' && (
              <div
                style={{
                  color: TEXT_MUTED,
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: 6,
                  paddingLeft: 4,
                }}
              >
                {group}
              </div>
            )}
            {names.map((name) => renderLaneCard(name))}
          </div>
        ))}
      </div>
    );
  }

  // ─── Render: Run History ──────────────────────────────────────────────────
  function renderRunHistory() {
    const showingLocal = historySource === 'local';
    const hasRows = showingLocal ? filteredLocalHistory.length > 0 : filteredGithubHistory.length > 0;
    const githubHistoryLoading = sections.githubHistory.loading;
    const githubHistoryError = sections.githubHistory.error;

    return (
      <div style={{ marginBottom: 16 }} data-testid="workspace-checks-run-history">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <div style={s.sectionTitle}>Evidence history</div>
          <div style={{ display: 'flex', gap: 4 }} role="group" aria-label="Evidence source">
            {(['local', 'github'] as const).map((source) => (
              <button
                key={source}
                type="button"
                onClick={() => setHistorySource(source)}
                style={{
                  border: `1px solid ${historySource === source ? INFO : BORDER}`,
                  background: historySource === source ? 'rgba(120, 184, 176, 0.12)' : DARK_BG_2,
                  color: historySource === source ? TEXT_PRIMARY : TEXT_MUTED,
                  borderRadius: 4,
                  padding: '4px 8px',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
                data-testid={`workspace-checks-history-${source}`}
              >
                {source === 'local' ? 'Local proof' : 'GitHub history'}
              </button>
            ))}
          </div>
          <label style={{ color: TEXT_MUTED, fontSize: 11, marginLeft: 'auto' }}>
            Branch{' '}
            <select
              value={historyBranch}
              onChange={(event) => setHistoryBranch(event.target.value as 'current' | 'all')}
              style={{ background: DARK_BG_3, color: TEXT_SECONDARY, border: `1px solid ${BORDER}`, borderRadius: 4, padding: '3px 5px' }}
              data-testid="workspace-checks-history-branch"
            >
              <option value="current">{currentBranch || 'current'}</option>
              <option value="all">All branches</option>
            </select>
          </label>
        </div>
        <div style={{ color: TEXT_MUTED, fontSize: 11, marginBottom: 8 }}>
          {showingLocal
            ? 'Local runs are the repository proof source; GitHub results are never merged into this pass/fail state.'
            : githubHistoryLoading && !hasRows
              ? 'Loading GitHub history…'
              : githubHistoryAvailable
              ? `Read-only GitHub runs for ${historyBranch === 'all' ? 'all branches' : currentBranch || 'the current branch'}.`
              : githubHistoryError || githubHistoryReason || 'GitHub history is unavailable.'}
        </div>
        {!showingLocal && githubHistoryError && hasRows && (
          <div style={{ color: WARNING, fontSize: 11, marginBottom: 8 }} data-testid="workspace-checks-github-history-error">
            Showing the last successful GitHub history. Refresh failed: {githubHistoryError}
          </div>
        )}
        {!hasRows && (
          <div style={{ color: TEXT_MUTED, fontStyle: 'italic', padding: '8px 0' }} data-testid="workspace-checks-history-empty">
            {showingLocal
              ? 'No local evidence runs recorded.'
              : githubHistoryLoading
                ? 'Loading GitHub history…'
                : githubHistoryAvailable
                ? `No GitHub runs recorded for ${historyBranch === 'all' ? 'these branches' : 'this branch'}.`
                : githubHistoryError || 'GitHub history is unavailable.'}
          </div>
        )}
        {!showingLocal && filteredGithubHistory.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead><tr><th style={s.th}>Created</th><th style={s.th}>Workflow</th><th style={s.th}>Result</th><th style={s.th}>Commit</th></tr></thead>
              <tbody>
                {filteredGithubHistory.map((entry, idx) => {
                  const conclusion = String(entry.conclusion || entry.status || 'unknown');
                  const passed = conclusion.toLowerCase() === 'success';
                  return (
                    <tr key={`${String(entry.databaseId || entry.createdAt || idx)}`}>
                      <td style={s.td}>{entry.createdAt ? formatTimestamp(String(entry.createdAt)) : '—'}</td>
                      <td style={s.td}>{String(entry.workflowName || 'GitHub workflow')}</td>
                      <td style={{ ...s.td, color: passed ? SUCCESS : conclusion === 'unknown' ? WARNING : FAILURE }}>{conclusion}</td>
                      <td style={s.td}>{entry.headSha ? String(entry.headSha).slice(0, 8) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {showingLocal && filteredLocalHistory.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Timestamp</th>
                <th style={s.th}>Profile</th>
                <th style={s.th}>Result</th>
                <th style={s.th}>Duration</th>
                <th style={s.th}>Summary</th>
              </tr>
            </thead>
            <tbody>
              {filteredLocalHistory.map((entry, idx) => {
                const hLanes = entry.lanes ?? {};
                const hLaneEntries = Object.entries(hLanes);
                const passed = hLaneEntries.filter(([, l]) => String(l.status).toUpperCase() === 'PASS').length;
                const failed = hLaneEntries.filter(([, l]) => String(l.status).toUpperCase() === 'FAIL').length;
                const totalDuration = hLaneEntries.reduce((sum, [, l]) => sum + (l.durationMs || 0), 0);

                return (
                  <tr key={idx}>
                    <td style={s.td}>
                      {entry.timestamp ? formatTimestamp(entry.timestamp) : '—'}
                    </td>
                    <td style={s.td}>{entry.profile || '—'}</td>
                    <td style={{ ...s.td, color: entry.overallPass ? SUCCESS : FAILURE }}>
                      {entry.overallPass ? 'PASS' : 'FAIL'}
                    </td>
                    <td style={s.td}>{formatDuration(totalDuration)}</td>
                    <td style={s.td}>
                      <span style={{ color: SUCCESS }}>{passed} passed</span>
                      {failed > 0 && (
                        <span style={{ color: FAILURE, marginLeft: 4 }}>
                          , {failed} failed
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>
    );
  }

  // ─── Render: Log Console ──────────────────────────────────────────────────
  function renderLogConsole() {
    const logs = buildRunTrace(runSession, checkResults?.logs ?? []);

    const filteredLogs = logFilter
      ? logs.filter((log) => {
        const haystack = `${log.lane || ''} ${log.event || ''} ${log.status || ''} ${log.reason || ''}`.toLowerCase();
        return haystack.includes(logFilter.toLowerCase());
      })
      : logs;

    return (
      <div style={{ marginBottom: 16 }} data-testid="workspace-checks-log-console">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            placeholder="Filter by lane name..."
            value={logFilter}
            onChange={(e) => setLogFilter(e.target.value)}
            style={{
              flex: 1,
              padding: '6px 8px',
              background: DARK_BG_3,
              border: `1px solid ${BORDER}`,
              borderRadius: 4,
              color: TEXT_PRIMARY,
              fontSize: 12,
              outline: 'none',
            }}
            data-testid="workspace-checks-log-filter"
          />
          <span style={{ color: TEXT_MUTED, fontSize: 11 }}>
            {filteredLogs.length} / {logs.length} entries
          </span>
        </div>

        {filteredLogs.length === 0 ? (
          <div style={{ color: TEXT_MUTED, fontStyle: 'italic', padding: 8 }}>
            {logs.length === 0 ? 'No logs available.' : 'No logs match filter.'}
          </div>
        ) : (
          <div style={{
            background: DARK_BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 4,
            maxHeight: 300,
            overflow: 'auto',
          }}>
            {filteredLogs.map((log, idx) => (
              <div key={idx} style={s.logEntry}>
                <span style={{ color: TEXT_MUTED, marginRight: 8 }}>
                  {log.timestamp ? formatTimestamp(log.timestamp) : '—'}
                </span>
                <span style={{
                  color: log.event === 'lane_end' && log.status === 'pass' ? SUCCESS
                    : log.event === 'lane_end' && log.status === 'fail' ? FAILURE
                    : log.event === 'lane_start' ? INFO
                    : WARNING,
                  marginRight: 8,
                  fontWeight: 500,
                }}>
                  [{log.event}]
                </span>
                {log.lane && (
                  <span style={{ color: TEXT_PRIMARY, marginRight: 8 }}>{log.lane}</span>
                )}
                {(log.event === 'lane_end' || log.event === 'run_end' || log.event === 'run_error') && (
                  <>
                    {log.status && (
                      <span style={{ color: log.status === 'PASS' || log.status === 'pass' ? SUCCESS : FAILURE, marginRight: 8 }}>
                        status={log.status}
                      </span>
                    )}
                    {log.exitCode !== undefined && (
                      <span style={{ color: TEXT_MUTED, marginRight: 8 }}>
                        exit={log.exitCode}
                      </span>
                    )}
                    {log.durationMs !== undefined && log.durationMs > 0 && (
                      <span style={{ color: TEXT_MUTED }}>
                        {formatDuration(log.durationMs)}
                      </span>
                    )}
                  </>
                )}
                {(log.event === 'skip' || log.event === 'run_start' || log.event === 'run_end' || log.event === 'run_error') && log.reason && (
                  <span style={{ color: TEXT_MUTED }}>
                    {log.event === 'skip' ? 'reason' : 'detail'}: {log.reason}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  async function handleCopyTrace() {
    const text = buildRunHandoff(runSession);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      notificationStore.success('Trace copied', { message: 'Check run trace copied to clipboard.' });
    } catch (err) {
      notificationStore.error('Copy failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function renderRunTraceSummary() {
    const handoff = buildRunHandoff(runSession);
    if (!handoff || runSession?.outcome === 'running') return null;
    return (
      <div style={{ marginBottom: 16 }} data-testid="workspace-checks-run-trace">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={s.sectionTitle}>Run Trace</div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyTrace}
            testId="workspace-checks-copy-trace"
          >
            Copy trace
          </Button>
        </div>
        <pre style={{
          margin: 0,
          padding: 10,
          background: DARK_BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 4,
          color: TEXT_SECONDARY,
          fontSize: 11,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 220,
          overflow: 'auto',
        }}>
          {handoff}
        </pre>
      </div>
    );
  }

  // ─── Render: Main ──────────────────────────────────────────────────────────
  return (
    <div style={s.container} className="workspace-checks-tab" data-testid="workspace-checks-tab">
      {error && !sections.checkPlan.error && (
        <div style={{ color: WARNING, marginBottom: 12 }} data-testid="workspace-checks-local-section-error">
          Some local check details could not refresh: {error}
        </div>
      )}
      {remoteLoading && qualityStatus && (
        <span className="sr-only" data-testid="workspace-checks-remote-loading">Refreshing GitHub sections</span>
      )}
      {remoteError && !sections.githubStatus.error && !sections.githubHistory.error && (
        <span className="sr-only">{remoteError}</span>
      )}
      {renderReadiness()}
      {renderRecommendation()}
      {renderTopStrip()}

      {/* Manual run — collapsible */}
      <div style={{ marginBottom: 12 }}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setProfileBarOpen(!profileBarOpen)}
          testId="workspace-checks-manual-run-toggle"
        >
          {profileBarOpen ? 'Hide check details' : 'Check details and manual runs'}
        </Button>
      </div>
      {profileBarOpen && (
        <>
          {renderProfileBar()}
          {renderConfirmDialog()}
          {renderRunStatus()}
          {renderLaneMatrix()}

          <div style={{ marginBottom: 16 }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowLogConsole(!showLogConsole)}
              testId="workspace-checks-log-toggle"
            >
              {showLogConsole ? 'Hide Logs' : 'Show Logs'}
            </Button>
          </div>

          {showLogConsole && renderLogConsole()}
          {renderRunTraceSummary()}
        </>
      )}
      {renderRunHistory()}
    </div>
  );
}
