import { useState, useEffect } from 'react';
import { Button } from '../../components';
import { notificationStore } from '../../stores/notificationStore';
import {
  getGitCheckState,
  getGitCiSync,
} from '../../lib/api/git';
import type { GitCheckResults, GitCheckStateResponse, GitCiSyncResponse } from '../../lib/api/git';

interface WorkspaceChecksSectionProps {
  repoPath: string;
  checkResults?: GitCheckResults | null;
  runningChecks?: boolean;
  onRunChecks?: () => void;
}

type ReadinessStatus = 'ready' | 'stale' | 'failed' | 'running' | 'not-configured' | 'ci-gap';

export default function WorkspaceChecksSection({
  repoPath,
  checkResults,
  runningChecks,
  onRunChecks,
}: WorkspaceChecksSectionProps) {
  const [checkState, setCheckState] = useState<GitCheckStateResponse | null>(null);
  const [ciSync, setCiSync] = useState<GitCiSyncResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [expandedLane, setExpandedLane] = useState<string | null>(null);
  const [showCiSummary, setShowCiSummary] = useState(false);

  // ─── Load check state and CI sync on mount ────────────────────────────────
  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [stateResult, ciSyncResult] = await Promise.all([
          getGitCheckState(repoPath),
          getGitCiSync(repoPath),
        ]);
        if (!cancelled) {
          setCheckState(stateResult);
          setCiSync(ciSyncResult);
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
  }, [repoPath]);

  // ─── Compute readiness status ─────────────────────────────────────────────
  function getReadiness(): ReadinessStatus {
    // CI gap overrides other states
    if (ciSync?.syncResult.summary.readiness === 'ci-gap') return 'ci-gap';
    if (runningChecks) return 'running';
    if (checkResults && checkResults.checksAvailable === 0) return 'not-configured';
    if (!checkResults) return 'not-configured';
    if (!checkResults.allPassed) return 'failed';
    if (checkState?.freshness?.fresh) return 'ready';
    return 'stale';
  }

  const readiness = getReadiness();

  const readinessConfig: Record<ReadinessStatus, { label: string; className: string; icon: string }> = {
    ready:       { label: 'Ready',        className: 'workspace-checks-readiness-ready',       icon: '✅' },
    stale:       { label: 'Stale',        className: 'workspace-checks-readiness-stale',       icon: '⚠' },
    failed:      { label: 'Failed',       className: 'workspace-checks-readiness-failed',      icon: '❌' },
    running:     { label: 'Running...',   className: 'workspace-checks-readiness-running',     icon: '🔄' },
    'not-configured': { label: 'Not configured', className: 'workspace-checks-readiness-none', icon: '⬜' },
    'ci-gap':    { label: 'CI gap',       className: 'workspace-checks-readiness-ci-gap',      icon: '⚠' },
  };

  const rd = readinessConfig[readiness];

  // ─── Extract all groups from lastRun ───────────────────────────────────────
  const groups = checkState?.lastRun?.groups ?? {};
  const groupNames = Object.keys(groups);

  // ─── Filter lanes by active group ──────────────────────────────────────────
  const allLanes = checkState?.lastRun?.lanes ?? {};
  const laneNames = Object.keys(allLanes);

  const filteredLaneNames = activeGroup
    ? laneNames.filter((name) => allLanes[name].group === activeGroup)
    : laneNames;

  // ─── CI sync summary values ────────────────────────────────────────────────
  const ciSummary = ciSync?.syncResult.summary;
  const ciMappings = ciSync?.syncResult.mappings ?? [];

  // ─── Status icon for a lane ────────────────────────────────────────────────
  function getLaneStatusIcon(status: string): string {
    switch (status) {
      case 'pass': return '✅';
      case 'fail': return '❌';
      case 'skip': return '⬜';
      case 'running': return '🔄';
      default: return '⬜';
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="workspace-git-checks-section" data-testid="workspace-checks-section">
      {/* Section title */}
      <h3 className="workspace-git-section-title" style={{ marginBottom: 'var(--space-sm)' }}>
        Checks{loading ? ' (loading...)' : ''}
      </h3>

      {/* 1. Overall Readiness Banner */}
      <div
        className={`workspace-checks-readiness ${rd.className}`}
        data-testid="workspace-checks-readiness"
      >
        <span className="workspace-checks-readiness-icon">{rd.icon}</span>
        <span className="workspace-checks-readiness-label">{rd.label}</span>
        {readiness === 'stale' && checkState?.freshness?.reason && (
          <span className="workspace-checks-readiness-reason" title={checkState.freshness.reason}>
            ({checkState.freshness.reason})
          </span>
        )}
      </div>

      {/* 2. Group Filter Bar */}
      {groupNames.length > 0 && (
        <div className="workspace-checks-group-filter" data-testid="workspace-checks-group-filter">
          <button
            type="button"
            className={`workspace-checks-group-pill ${activeGroup === null ? 'workspace-checks-group-pill-active' : ''}`}
            onClick={() => setActiveGroup(null)}
            data-testid="workspace-checks-group-all"
          >
            All
          </button>
          {groupNames.map((g) => (
            <button
              key={g}
              type="button"
              className={`workspace-checks-group-pill ${activeGroup === g ? 'workspace-checks-group-pill-active' : ''}`}
              onClick={() => setActiveGroup(g)}
              data-testid={`workspace-checks-group-${g}`}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {/* 3. Lanes Table/List */}
      {laneNames.length > 0 ? (
        <div className="workspace-checks-lanes" data-testid="workspace-checks-lanes">
          {filteredLaneNames.map((laneName) => {
            const lane = allLanes[laneName];
            const isExpanded = expandedLane === laneName;
            return (
              <div
                key={laneName}
                className={`workspace-checks-lane ${isExpanded ? 'workspace-checks-lane-expanded' : ''}`}
                data-testid={`workspace-checks-lane-${laneName}`}
              >
                {/* Lane row (collapsed view) */}
                <button
                  type="button"
                  className="workspace-checks-lane-row"
                  onClick={() => setExpandedLane(isExpanded ? null : laneName)}
                  data-testid={`workspace-checks-lane-toggle-${laneName}`}
                >
                  {/* Left side */}
                  <span className="workspace-checks-lane-status-icon">
                    {getLaneStatusIcon(lane.status)}
                  </span>
                  <span className="workspace-checks-lane-name">{laneName}</span>
                  {lane.group && (
                    <span className="workspace-checks-lane-group-badge">{lane.group}</span>
                  )}

                  {/* Right side */}
                  <span className="workspace-checks-lane-meta">
                    {lane.durationMs > 0 && (
                      <span className="workspace-checks-lane-duration">
                        {(lane.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                    {lane.score !== null && (
                      <span className="workspace-checks-lane-score">
                        Score: {lane.score}
                      </span>
                    )}
                    {lane.ciWorkflow && (
                      <span className="workspace-checks-lane-ci-badge" title={`${lane.ciWorkflow}/${lane.ciJob || ''}`}>
                        CI: {lane.ciWorkflow}{lane.ciJob ? `/${lane.ciJob}` : ''}
                        {lane.ciRequired && <span className="workspace-checks-lane-ci-required">required</span>}
                      </span>
                    )}
                    {checkState?.freshness && (
                      <span
                        className={`workspace-checks-lane-freshness ${checkState.freshness.fresh ? 'workspace-checks-fresh' : 'workspace-checks-stale'}`}
                        title={checkState.freshness.reason || ''}
                      >
                        {checkState.freshness.fresh ? 'fresh' : 'stale'}
                      </span>
                    )}
                  </span>

                  <span className="workspace-checks-lane-expand-icon">
                    {isExpanded ? '▲' : '▼'}
                  </span>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="workspace-checks-lane-detail" data-testid={`workspace-checks-lane-detail-${laneName}`}>
                    {lane.details && (
                      <div className="workspace-checks-lane-detail-section">
                        <span className="workspace-checks-lane-detail-label">Details</span>
                        <pre className="workspace-checks-lane-detail-output">{lane.details.slice(0, 300)}</pre>
                      </div>
                    )}
                    {lane.commands && lane.commands.length > 0 && (
                      <div className="workspace-checks-lane-detail-section">
                        <span className="workspace-checks-lane-detail-label">Commands</span>
                        <div className="workspace-checks-lane-commands">
                          {lane.commands.map((cmd, idx) => (
                            <div key={idx} className="workspace-checks-lane-command">
                              <span className={`workspace-checks-lane-command-status ${cmd.success ? 'workspace-checks-lane-command-pass' : 'workspace-checks-lane-command-fail'}`}>
                                {cmd.success ? '✓' : '✗'}
                              </span>
                              <code className="workspace-checks-lane-command-text">{cmd.command}</code>
                              <span className="workspace-checks-lane-command-duration">
                                {cmd.durationMs > 0 ? `${(cmd.durationMs / 1000).toFixed(1)}s` : ''}
                              </span>
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
        !loading && (
          <div className="state-message" data-testid="workspace-checks-no-lanes">
            No lanes available.
          </div>
        )
      )}

      {/* 4. Action Buttons Row */}
      <div className="workspace-checks-actions" data-testid="workspace-checks-actions">
        <Button
          variant="primary"
          size="sm"
          disabled={runningChecks}
          onClick={onRunChecks}
          testId="workspace-checks-run-all"
        >
          {runningChecks ? 'Running...' : '▶ Run All'}
        </Button>

        {groupNames.map((g) => (
          <Button
            key={g}
            variant="ghost"
            size="sm"
            disabled={runningChecks}
            onClick={onRunChecks}
            testId={`workspace-checks-run-group-${g}`}
          >
            ▶ Run {g}
          </Button>
        ))}

        {ciSummary && ciSummary.gaps > 0 && (
          <Button
            variant="ghost"
            size="sm"
            disabled={runningChecks}
            onClick={onRunChecks}
            testId="workspace-checks-run-ci-equivalent"
          >
            ▶ Run CI-equivalent
          </Button>
        )}
      </div>

      {/* 5. CI Mapping Summary (collapsible) */}
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
                    <div key={idx} className={`workspace-checks-ci-mapping ${mapping.status === 'ci-gap' ? 'workspace-checks-ci-mapping-gap' : ''}`}>
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
  );
}
