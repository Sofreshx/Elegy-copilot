import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components';
import { notificationStore } from '../../stores/notificationStore';
import {
  discoverGitChecks,
  getGitCheckState,
  getGitCiSync,
} from '../../lib/api/git';
import type {
  GitCheckResult,
  GitCheckResults,
  GitCheckStateResponse,
  GitChecksDiscoverResponse,
  GitCiSyncResponse,
} from '../../lib/api/git';

interface WorkspaceChecksSectionProps {
  repoPath: string;
  checkResults?: GitCheckResults | null;
  runningChecks?: boolean;
  onRunChecks?: () => void;
}

type ReadinessStatus = 'ready' | 'stale' | 'failed' | 'running' | 'not-configured' | 'not-run' | 'ci-gap';

interface DisplayLane {
  name: string;
  status: string;
  details: string;
  exitCode: number | null;
  durationMs: number | null;
  score: number | null;
  group: string | null;
  blocking: boolean;
  ciWorkflow: string | null;
  ciJob: string | null;
  ciRequired: boolean;
  commands: Array<{ command: string; exitCode: number | null; success: boolean; durationMs: number | null }>;
}

function normalizeStatus(status: string | undefined, passed?: boolean): string {
  if (status) return status.toUpperCase();
  return passed ? 'PASS' : 'FAIL';
}

function resultToLane(result: GitCheckResult): DisplayLane {
  return {
    name: result.checkName,
    status: normalizeStatus(result.status, result.passed),
    details: result.output || result.error || '',
    exitCode: result.exitCode ?? null,
    durationMs: result.durationMs ?? null,
    score: result.score ?? null,
    group: result.group || null,
    blocking: result.blocking !== false,
    ciWorkflow: result.ciWorkflow || null,
    ciJob: result.ciJob || null,
    ciRequired: result.ciRequired === true,
    commands: (result.commands || []).map((command) => ({
      command: command.command,
      exitCode: command.exitCode,
      success: command.success,
      durationMs: command.durationMs,
    })),
  };
}

function stateToLane(name: string, lane: GitCheckStateResponse['lastRun']['lanes'][string]): DisplayLane {
  return {
    name,
    status: normalizeStatus(lane.status),
    details: lane.details || '',
    exitCode: lane.exitCode ?? null,
    durationMs: lane.durationMs ?? null,
    score: lane.score ?? null,
    group: lane.group || null,
    blocking: lane.blocking !== false,
    ciWorkflow: lane.ciWorkflow || null,
    ciJob: lane.ciJob || null,
    ciRequired: lane.ciRequired === true,
    commands: (lane.commands || []).map((command) => ({
      command: command.command,
      exitCode: command.exitCode,
      success: command.success,
      durationMs: command.durationMs,
    })),
  };
}

function discoveredToLane(check: GitChecksDiscoverResponse['checks'][number]): DisplayLane {
  const commands = check.path && check.path !== '(configured)'
    ? check.path.split(', ').map((command) => ({ command, exitCode: null, success: true, durationMs: null }))
    : [];
  return {
    name: check.name,
    status: 'CONFIGURED',
    details: check.description || 'Configured check lane.',
    exitCode: null,
    durationMs: null,
    score: null,
    group: check.group || null,
    blocking: check.blocking !== false,
    ciWorkflow: check.ciWorkflow || null,
    ciJob: check.ciJob || null,
    ciRequired: check.ciRequired === true,
    commands,
  };
}

function getLaneStatusIcon(status: string): string {
  switch (status.toUpperCase()) {
    case 'PASS': return '✓';
    case 'FAIL': return '✗';
    case 'SKIP': return '-';
    case 'RUNNING': return '…';
    case 'CONFIGURED': return '•';
    default: return '•';
  }
}

function formatDuration(durationMs: number | null): string | null {
  if (durationMs == null || durationMs <= 0) return null;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export default function WorkspaceChecksSection({
  repoPath,
  checkResults,
  runningChecks,
  onRunChecks,
}: WorkspaceChecksSectionProps) {
  const [checkState, setCheckState] = useState<GitCheckStateResponse | null>(null);
  const [ciSync, setCiSync] = useState<GitCiSyncResponse | null>(null);
  const [discoveredChecks, setDiscoveredChecks] = useState<GitChecksDiscoverResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [expandedLane, setExpandedLane] = useState<string | null>(null);
  const [showCiSummary, setShowCiSummary] = useState(false);

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [stateResult, ciSyncResult, discoveryResult] = await Promise.all([
          getGitCheckState(repoPath),
          getGitCiSync(repoPath),
          discoverGitChecks(repoPath),
        ]);
        if (!cancelled) {
          setCheckState(stateResult);
          setCiSync(ciSyncResult);
          setDiscoveredChecks(discoveryResult);
        }
      } catch (err) {
        if (!cancelled) {
          notificationStore.error('Failed to load check state', {
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [repoPath, checkResults?.checkedAt]);

  useEffect(() => {
    if (runningChecks || (checkResults && !checkResults.allPassed)) {
      setExpanded(true);
    }
  }, [checkResults, runningChecks]);

  const lanes = useMemo(() => {
    if (checkResults?.results?.length) return checkResults.results.map(resultToLane);
    const stateLanes = checkState?.lastRun?.lanes || {};
    const stateLaneNames = Object.keys(stateLanes);
    if (stateLaneNames.length > 0) return stateLaneNames.map((name) => stateToLane(name, stateLanes[name]));
    return (discoveredChecks?.checks || []).map(discoveredToLane);
  }, [checkResults, checkState, discoveredChecks]);

  const groups = checkResults?.groups || checkState?.lastRun?.groups || discoveredChecks?.groups || {};
  const ciSummary = ciSync?.syncResult.summary;
  const ciMappings = ciSync?.syncResult.mappings ?? [];
  const failedLanes = lanes.filter((lane) => lane.status === 'FAIL');

  function getReadiness(): ReadinessStatus {
    if (runningChecks) return 'running';
    if (checkResults && checkResults.checksAvailable === 0) return 'not-configured';
    if (checkResults && !checkResults.allPassed) return 'failed';
    if (ciSummary?.readiness === 'ci-gap') return 'ci-gap';
    if (checkResults?.allPassed && checkState?.freshness?.fresh) return 'ready';
    if (checkResults?.allPassed) return 'stale';
    if (lanes.length > 0) return checkState?.lastRun ? 'stale' : 'not-run';
    return 'not-configured';
  }

  const readiness = getReadiness();
  const readinessConfig: Record<ReadinessStatus, { label: string; className: string }> = {
    ready: { label: 'Ready', className: 'workspace-checks-readiness-ready' },
    stale: { label: 'Stale', className: 'workspace-checks-readiness-stale' },
    failed: { label: 'Failed', className: 'workspace-checks-readiness-failed' },
    running: { label: 'Running checks...', className: 'workspace-checks-readiness-running' },
    'not-configured': { label: 'No checks configured', className: 'workspace-checks-readiness-none' },
    'not-run': { label: 'Not run', className: 'workspace-checks-readiness-none' },
    'ci-gap': { label: 'CI gap', className: 'workspace-checks-readiness-ci-gap' },
  };
  const rd = readinessConfig[readiness];
  const statusText = runningChecks
    ? `Running ${lanes.length || discoveredChecks?.checksAvailable || 0} checks`
    : checkResults
      ? checkResults.allPassed
        ? `${checkResults.checksPassed} of ${checkResults.checksRun} checks passed`
        : `${checkResults.checksFailed} of ${checkResults.checksRun} checks failed`
      : lanes.length > 0
        ? `${lanes.length} checks configured`
        : loading ? 'Loading checks' : 'No checks configured';

  return (
    <div className="workspace-git-checks-section workspace-checks-card" data-testid="workspace-checks-section">
      <div className="workspace-checks-card-header">
        <button
          type="button"
          className="workspace-checks-card-toggle"
          onClick={() => setExpanded(!expanded)}
          data-testid="workspace-checks-card-toggle"
          aria-expanded={expanded}
        >
          <span className={`workspace-checks-readiness ${rd.className}`} data-testid="workspace-checks-readiness">
            <span className="workspace-checks-readiness-label">{rd.label}</span>
          </span>
          <span className="workspace-checks-card-summary" data-testid="workspace-checks-result">
            {statusText}
            {checkResults?.compositeScore != null ? ` · score ${checkResults.compositeScore}` : ''}
            {ciSummary && ciSummary.gaps > 0 ? ` · ${ciSummary.gaps} CI gap${ciSummary.gaps !== 1 ? 's' : ''}` : ''}
          </span>
          <span className="workspace-checks-lane-expand-icon">{expanded ? '▲' : '▼'}</span>
        </button>

        <Button
          variant="ghost"
          size="sm"
          disabled={runningChecks}
          onClick={onRunChecks}
          testId="workspace-checks-run-all"
        >
          {runningChecks ? 'Running...' : checkResults ? 'Re-run checks' : 'Run All'}
        </Button>
      </div>

      {expanded && (
        <div className="workspace-checks-card-body" data-testid="workspace-checks-card-body">
          {failedLanes.length > 0 && (
            <div className="workspace-checks-failure-summary" data-testid="workspace-checks-failure-summary">
              {failedLanes.map((lane) => (
                <span key={lane.name} className="workspace-checks-failure-pill">{lane.name}</span>
              ))}
            </div>
          )}

          {Object.keys(groups).length > 0 && (
            <div className="workspace-checks-group-filter" data-testid="workspace-checks-group-filter">
              {Object.entries(groups).map(([name, group]) => (
                <span key={name} className="workspace-checks-group-pill" title={group.description}>
                  {name}
                </span>
              ))}
            </div>
          )}

          {lanes.length > 0 ? (
            <div className="workspace-checks-lanes" data-testid="workspace-checks-lanes">
              {lanes.map((lane) => {
                const isExpanded = expandedLane === lane.name;
                const duration = formatDuration(lane.durationMs);
                return (
                  <div
                    key={lane.name}
                    className={`workspace-checks-lane ${isExpanded ? 'workspace-checks-lane-expanded' : ''}`}
                    data-testid={`workspace-checks-lane-${lane.name}`}
                  >
                    <button
                      type="button"
                      className="workspace-checks-lane-row"
                      onClick={() => setExpandedLane(isExpanded ? null : lane.name)}
                      data-testid={`workspace-checks-lane-toggle-${lane.name}`}
                    >
                      <span className="workspace-checks-lane-status-icon">{getLaneStatusIcon(lane.status)}</span>
                      <span className="workspace-checks-lane-name">{lane.name}</span>
                      {lane.group && <span className="workspace-checks-lane-group-badge">{lane.group}</span>}
                      <span className="workspace-checks-lane-meta">
                        <span className={`workspace-checks-lane-status workspace-checks-lane-status-${lane.status.toLowerCase()}`}>
                          {lane.status.toLowerCase()}
                        </span>
                        {duration && <span className="workspace-checks-lane-duration">{duration}</span>}
                        {lane.score != null && <span className="workspace-checks-lane-score">Score: {lane.score}</span>}
                        {lane.ciWorkflow && (
                          <span className="workspace-checks-lane-ci-badge" title={`${lane.ciWorkflow}/${lane.ciJob || ''}`}>
                            CI: {lane.ciWorkflow}{lane.ciJob ? `/${lane.ciJob}` : ''}
                            {lane.ciRequired && <span className="workspace-checks-lane-ci-required">required</span>}
                          </span>
                        )}
                      </span>
                      <span className="workspace-checks-lane-expand-icon">{isExpanded ? '▲' : '▼'}</span>
                    </button>

                    {isExpanded && (
                      <div className="workspace-checks-lane-detail" data-testid={`workspace-checks-lane-detail-${lane.name}`}>
                        {lane.details && (
                          <div className="workspace-checks-lane-detail-section">
                            <span className="workspace-checks-lane-detail-label">Summary</span>
                            <pre className="workspace-checks-lane-detail-output">{lane.details.slice(0, 800)}</pre>
                          </div>
                        )}
                        {lane.commands.length > 0 && (
                          <div className="workspace-checks-lane-detail-section">
                            <span className="workspace-checks-lane-detail-label">Commands</span>
                            <div className="workspace-checks-lane-commands">
                              {lane.commands.map((cmd, idx) => (
                                <div key={`${cmd.command}-${idx}`} className="workspace-checks-lane-command">
                                  <span className={`workspace-checks-lane-command-status ${cmd.success ? 'workspace-checks-lane-command-pass' : 'workspace-checks-lane-command-fail'}`}>
                                    {cmd.success ? '✓' : '✗'}
                                  </span>
                                  <code className="workspace-checks-lane-command-text">{cmd.command}</code>
                                  {cmd.exitCode != null && <span className="workspace-checks-lane-command-duration">exit {cmd.exitCode}</span>}
                                  {cmd.durationMs != null && cmd.durationMs > 0 && (
                                    <span className="workspace-checks-lane-command-duration">{formatDuration(cmd.durationMs)}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            !loading && <div className="state-message" data-testid="workspace-checks-no-lanes">No lanes available.</div>
          )}

          {ciSummary && (
            <div className="workspace-checks-ci-summary" data-testid="workspace-checks-ci-summary">
              <button
                type="button"
                className="workspace-checks-ci-summary-toggle"
                onClick={() => setShowCiSummary(!showCiSummary)}
                data-testid="workspace-checks-ci-summary-toggle"
              >
                {showCiSummary ? '▼' : '▶'} CI Mapping: {ciSummary.mapped} CI jobs covered
                {ciSummary.gaps > 0 && `, ${ciSummary.gaps} gap${ciSummary.gaps !== 1 ? 's' : ''}`}
              </button>

              {showCiSummary && (
                <div className="workspace-checks-ci-summary-content" data-testid="workspace-checks-ci-summary-detail">
                  {ciMappings.length === 0 ? (
                    <div className="workspace-checks-ci-summary-empty">No CI workflows mapped.</div>
                  ) : (
                    <div className="workspace-checks-ci-mappings">
                      {ciMappings.map((mapping, idx) => (
                        <div key={`${mapping.workflowFile}-${mapping.jobName}-${idx}`} className={`workspace-checks-ci-mapping ${mapping.status === 'ci-gap' ? 'workspace-checks-ci-mapping-gap' : ''}`}>
                          <span className="workspace-checks-ci-mapping-workflow">{mapping.workflowFile}</span>
                          <span className="workspace-checks-ci-mapping-job">{mapping.jobName}</span>
                          <span className={`workspace-checks-ci-mapping-status ${mapping.status === 'ci-gap' ? 'workspace-checks-ci-mapping-gap-label' : 'workspace-checks-ci-mapping-mapped-label'}`}>
                            {mapping.status === 'ci-gap' ? 'CI gap' : 'Mapped'}
                          </span>
                          {mapping.required && <span className="workspace-checks-ci-mapping-required">required</span>}
                          {mapping.localLanes.length > 0 && (
                            <span className="workspace-checks-ci-mapping-lanes">
                              Lanes: {mapping.localLanes.join(', ')}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
