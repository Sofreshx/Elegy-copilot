import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components';
import { useStoreValue } from '../../lib/store';
import { driftCheckStore, type DriftRepoState } from '../../stores/driftCheckStore';
import { notificationStore } from '../../stores/notificationStore';
import {
  listDocsRepairRuns,
  startDocsRepairRun,
  type DocsRepairRun,
  type DocsRepairStatusResponse,
} from '../../lib/api/repoContext';

interface WorkspaceHealthTabProps {
  repoPath: string;
  repoId?: string | null;
}

const ELIGIBLE_REPAIR_CODES = new Set([
  'broken_internal_link',
  'frontmatter_invalid',
  'missing_dependency',
  'tool_config_drift',
]);

const CHECKS: { id: string; label: string }[] = [
  { id: 'claims', label: 'Claims' },
  { id: 'frontmatter', label: 'Frontmatter' },
  { id: 'staleness', label: 'Staleness' },
  { id: 'links', label: 'Links' },
  { id: 'scripts', label: 'Scripts' },
  { id: 'cross-file', label: 'Cross-file' },
  { id: 'todo-fixme', label: 'Todo/Fixme' },
  { id: 'tool-config-sync', label: 'Tool Config' },
];

function scoreColor(score: number): string {
  if (score >= 90) return 'var(--tone-success)';
  if (score >= 70) return 'var(--tone-warning)';
  return 'var(--tone-danger)';
}

function severityBadge(severity: string): { bg: string; label: string } {
  switch (severity) {
    case 'error': return { bg: 'var(--tone-danger)', label: 'Error' };
    case 'warning': return { bg: 'var(--tone-warning)', label: 'Warning' };
    case 'info': return { bg: 'var(--tone-brand)', label: 'Info' };
    default: return { bg: 'var(--tone-neutral)', label: severity };
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

function checkStatusIcon(status: string): string {
  switch (status) {
    case 'done': return '✓';
    case 'running': return '⟳';
    case 'error': return '✗';
    default: return '○';
  }
}

function checkStatusLabel(status: string, timestamp: string | null): string {
  if (status === 'running') return 'running...';
  if (status === 'error') return 'failed';
  if (status === 'done' && timestamp) return `done ${timeAgo(timestamp)}`;
  return 'idle';
}

function newestTimestamp(timestamps: Record<string, string | null>): string | null {
  return Object.values(timestamps).reduce<string | null>((latest, ts) => {
    if (!ts) return latest;
    if (!latest) return ts;
    return ts > latest ? ts : latest;
  }, null);
}

function formatIssuesForClipboard(issues: Array<{ code: string; severity: string; file: string; line: number; message: string; suggestion: string | null }>, repoPath: string): string {
  const header = `Fix the following ${issues.length} drift issues in ${repoPath}:\n\n`;
  const body = issues.map((issue, i) => {
    const loc = `${issue.file}${issue.line > 0 ? `:${issue.line}` : ''}`;
    const sev = `[${issue.severity.toUpperCase()}]`;
    return [
      `${i + 1}. ${sev} ${issue.code} — ${loc}`,
      `   ${issue.message}`,
      issue.suggestion ? `   💡 ${issue.suggestion}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');
  return header + body;
}

function getIssueKey(issue: { code: string; file: string; line: number; message: string }): string {
  return [issue.code, issue.file.replace(/\\/g, '/'), issue.line || 0, issue.message].join('|');
}

function isRepairEligible(issue: { code: string; file: string; line: number }): boolean {
  return ELIGIBLE_REPAIR_CODES.has(issue.code) && /\.(md|mdx)$/i.test(issue.file.replace(/\\/g, '/')) && issue.line > 0;
}

function formatRunTime(run: DocsRepairRun): string {
  const start = Date.parse(run.startedAt || run.createdAt || '');
  const end = Date.parse(run.finishedAt || run.updatedAt || '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  const seconds = Math.max(1, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

function runStatusColor(status: DocsRepairRun['status']): string {
  switch (status) {
    case 'succeeded': return 'var(--tone-success)';
    case 'failed': return 'var(--tone-danger)';
    case 'running': return 'var(--tone-brand)';
    case 'queued': return 'var(--tone-warning)';
    default: return 'var(--text-muted)';
  }
}

export default function WorkspaceHealthTab({ repoPath, repoId = null }: WorkspaceHealthTabProps) {
  const state = useStoreValue(driftCheckStore);
  const [fullCheckLoading, setFullCheckLoading] = useState(false);
  const initRef = useRef(false);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  const [copyCount, setCopyCount] = useState<25 | 50 | 100>(50);
  const [copied, setCopied] = useState(false);
  const [repairBatchSize, setRepairBatchSize] = useState<20 | 50>(50);
  const [repairStarting, setRepairStarting] = useState(false);
  const [repairStatus, setRepairStatus] = useState<DocsRepairStatusResponse | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);

  const normalizedRepoPath = repoPath.replace(/\\/g, '/').toLowerCase();

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    driftCheckStore.initRepo(repoPath);
  }, [repoPath]);

  async function loadRepairRuns() {
    try {
      const status = await listDocsRepairRuns(repoPath, repoId);
      setRepairStatus(status);
      setRepairError(null);
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    if (!repoPath) return;
    void loadRepairRuns();
  }, [repoPath, repoId]);

  useEffect(() => {
    if (!repoPath || !repairStatus?.runs.some((run) => run.status === 'queued' || run.status === 'running')) return;
    const timer = window.setInterval(() => {
      void loadRepairRuns();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [repoPath, repoId, repairStatus?.runs]);

  const repoState: DriftRepoState | undefined = state.byRepo[normalizedRepoPath];
  const report = repoState?.report ?? null;

  // Empty state — no report cached or fetched yet
  if (!report) {
    return (
      <div style={{ padding: '2rem' }}>
        <div style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
          No drift check data yet.
        </div>
        <Button
          onClick={async () => {
            setFullCheckLoading(true);
            try {
              await driftCheckStore.runFull(repoPath);
            } finally {
              setFullCheckLoading(false);
            }
          }}
          disabled={fullCheckLoading}
        >
          {fullCheckLoading ? 'Checking...' : 'Run Full Check'}
        </Button>

        {/* Check list (status indicators) */}
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-muted)' }}>
            Checks
          </div>
          {CHECKS.map((check) => {
            const status = repoState?.checkStatuses[check.id] ?? 'idle';
            const timestamp = repoState?.checkTimestamps[check.id] ?? null;
            return (
              <div
                key={check.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.4rem 0',
                  fontSize: '0.85rem',
                  color: 'var(--text-muted)',
                }}
              >
                <span style={{ width: '1.2rem', textAlign: 'center' }}>
                  {checkStatusIcon(status)}
                </span>
                <span>{check.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: '0.8rem' }}>
                  {checkStatusLabel(status, timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Data state — has report
  const issues = report.issues || [];
  const counts = report.severityCounts || { error: 0, warning: 0, info: 0 };
  const hasRunningCheck = repoState?.checkStatuses
    ? Object.values(repoState.checkStatuses).some((s) => s === 'running')
    : false;
  const isFullCheckDisabled = fullCheckLoading || hasRunningCheck;
  const filteredIssues = severityFilter === 'all'
    ? issues
    : issues.filter(i => i.severity === severityFilter);
  const visibleIssues = filteredIssues.slice(0, copyCount);
  const isTruncated = filteredIssues.length > copyCount;
  const eligibleFilteredIssues = filteredIssues.filter(isRepairEligible);
  const ineligibleFilteredCount = filteredIssues.length - eligibleFilteredIssues.length;
  const activeRepairCount = repairStatus?.activeCount ?? 0;
  const repairLimit = repairStatus?.concurrencyLimit ?? 3;
  const isRepairLimitReached = activeRepairCount >= repairLimit;
  const isOpenCodeUnavailable = repairStatus?.openCodeAvailable === false;
  const repairDisabledReason = (() => {
    if (eligibleFilteredIssues.length === 0) return 'No eligible issues match the current filter.';
    if (isOpenCodeUnavailable) return 'OpenCode CLI is not available.';
    if (isRepairLimitReached) return 'Repair concurrency limit reached.';
    return null;
  })();
  const canStartRepair = !repairStarting && !repairDisabledReason;

  async function handleStartRepair() {
    setRepairStarting(true);
    setRepairError(null);
    try {
      const response = await startDocsRepairRun({
        repoPath,
        repoId,
        batchSize: repairBatchSize,
        filters: { severity: severityFilter },
        issues: issues.map((issue) => ({
          code: issue.code,
          severity: issue.severity,
          file: issue.file,
          line: issue.line,
          message: issue.message,
          suggestion: issue.suggestion,
          key: getIssueKey(issue),
        })),
      });
      setRepairStatus(response.status);
      notificationStore.success('Docs repair queued', {
        message: `${response.run.issueSummary.total} issues queued for OpenCode repair.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRepairError(message);
      notificationStore.error('Docs repair failed to start', { message });
    } finally {
      setRepairStarting(false);
    }
  }

  async function handleCopy() {
    const toCopy = filteredIssues.slice(0, copyCount);
    const text = formatIssuesForClipboard(toCopy, repoPath);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      notificationStore.success('Issues copied', {
        message: `${toCopy.length} issues copied to clipboard.`,
      });
    } catch (err) {
      notificationStore.error('Copy failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Determine timestamp display
  const timestampEl = (() => {
    if (repoState?.lastFullRunAt) {
      return `Last full check: ${timeAgo(repoState.lastFullRunAt)}`;
    }
    const newest = repoState?.checkTimestamps ? newestTimestamp(repoState.checkTimestamps) : null;
    if (newest) {
      return `Last check: ${timeAgo(newest)} (partial)`;
    }
    return null;
  })();

  return (
    <div style={{ padding: '1.5rem', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Top row: Score + Run Full Check */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem' }}>
          <span style={{ fontSize: '3rem', fontWeight: 700, color: scoreColor(report.score), lineHeight: 1 }}>
            {report.score}
          </span>
          <span style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>/ 100</span>
        </div>
        <Button
          onClick={async () => {
            setFullCheckLoading(true);
            try {
              await driftCheckStore.runFull(repoPath);
            } finally {
              setFullCheckLoading(false);
            }
          }}
          disabled={isFullCheckDisabled}
        >
          {fullCheckLoading ? 'Checking...' : 'Run Full Check'}
        </Button>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        <span style={{ color: 'var(--tone-danger)' }}>🔴 {counts.error} errors</span>
        <span style={{ color: 'var(--tone-warning)' }}>🟡 {counts.warning} warnings</span>
        <span style={{ color: 'var(--tone-brand)' }}>🔵 {counts.info} info</span>
        <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {report.fileCount} files · {report.claimCount} claims · {report.verifiedCount} verified
        </span>
      </div>

      {/* Timestamp */}
      {timestampEl && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          {timestampEl}
        </div>
      )}

      {/* Check list section */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-muted)' }}>
          Checks
        </div>
        {CHECKS.map((check) => {
          const status = repoState?.checkStatuses[check.id] ?? 'idle';
          const timestamp = repoState?.checkTimestamps[check.id] ?? null;
          const isRunning = status === 'running';
          return (
            <div
              key={check.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.4rem 0.5rem',
                fontSize: '0.85rem',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <span style={{ width: '1.2rem', textAlign: 'center' }}>
                {checkStatusIcon(status)}
              </span>
              <span style={{ fontWeight: 500 }}>{check.label}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                {checkStatusLabel(status, timestamp)}
              </span>
              <span style={{ marginLeft: 'auto' }}>
                {status === 'done' && (
                  <Button
                    onClick={async () => {
                      await driftCheckStore.runSingle(repoPath, check.id);
                    }}
                    disabled={isRunning}
                    style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                  >
                    Re-run
                  </Button>
                )}
                {status === 'idle' && (
                  <Button
                    onClick={async () => {
                      await driftCheckStore.runSingle(repoPath, check.id);
                    }}
                    disabled={isRunning}
                    style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                  >
                    Run
                  </Button>
                )}
                {status === 'error' && (
                  <Button
                    onClick={async () => {
                      await driftCheckStore.runSingle(repoPath, check.id);
                    }}
                    disabled={isRunning}
                    style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                  >
                    Retry
                  </Button>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* Issues section */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Filter bar + copy controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              Issues ({issues.length})
            </span>
            {/* Severity filter chips */}
            {issues.length > 0 && (
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                {[
                  { key: 'all' as const, label: 'All' },
                  { key: 'error' as const, label: 'Errors' },
                  { key: 'warning' as const, label: 'Warnings' },
                  { key: 'info' as const, label: 'Info' },
                ].map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setSeverityFilter(f.key)}
                    style={{
                      fontSize: '0.75rem',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: severityFilter === f.key ? 'var(--tone-brand)' : 'transparent',
                      color: severityFilter === f.key ? '#fff' : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Copy controls */}
          {issues.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {/* Count selector */}
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                {[25, 50, 100].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCopyCount(n as 25 | 50 | 100)}
                    style={{
                      fontSize: '0.75rem',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: copyCount === n ? 'var(--tone-brand)' : 'transparent',
                      color: copyCount === n ? '#fff' : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <Button onClick={handleCopy} disabled={filteredIssues.length === 0} style={{ fontSize: '0.75rem', padding: '2px 8px' }}>
                {copied ? '✓ Copied!' : 'Copy to Clipboard'}
              </Button>
            </div>
          )}
        </div>

        {/* Truncation notice */}
        {isTruncated && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            Showing first {copyCount} of {filteredIssues.length} {severityFilter === 'all' ? '' : severityFilter} issues
          </div>
        )}

        {issues.length > 0 && (
          <div
            data-testid="workspace-health-repair-controls"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              flexWrap: 'wrap',
              padding: '0.65rem 0',
              marginBottom: '0.75rem',
              borderTop: '1px solid var(--border-color)',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              OpenCode repair
            </span>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {eligibleFilteredIssues.length} eligible · {ineligibleFilteredCount} skipped · {activeRepairCount}/{repairLimit} active
            </span>
            <div style={{ display: 'flex', gap: '0.25rem' }} aria-label="Repair batch size">
              {[20, 50].map((n) => (
                <button
                  key={n}
                  type="button"
                  data-testid={`workspace-health-repair-batch-${n}`}
                  onClick={() => setRepairBatchSize(n as 20 | 50)}
                  style={{
                    fontSize: '0.75rem',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: repairBatchSize === n ? 'var(--tone-brand)' : 'transparent',
                    color: repairBatchSize === n ? '#fff' : 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <Button
              onClick={handleStartRepair}
              disabled={!canStartRepair}
              loading={repairStarting}
              loadingLabel="Starting..."
              testId="workspace-health-start-repair"
              title={repairDisabledReason ?? undefined}
              style={{ fontSize: '0.75rem', padding: '2px 8px' }}
            >
              Start OpenCode Repair
            </Button>
            {repairDisabledReason && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {repairDisabledReason}
              </span>
            )}
          </div>
        )}

        {repairError && (
          <div
            data-testid="workspace-health-repair-error"
            style={{ fontSize: '0.8rem', color: 'var(--tone-danger)', marginBottom: '0.75rem' }}
          >
            {repairError}
          </div>
        )}

        {repairStatus?.runs.length ? (
          <div
            data-testid="workspace-health-repair-runs"
            style={{
              marginBottom: '0.75rem',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              backgroundColor: 'var(--bg-surface)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              Repair Runs
            </div>
            {repairStatus.runs.slice(0, 8).map((run) => (
              <div
                key={run.id}
                data-testid={`workspace-health-repair-run-${run.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(110px, 0.7fr) minmax(160px, 1.1fr) minmax(180px, 1fr) auto',
                  gap: '0.75rem',
                  alignItems: 'center',
                  padding: '0.55rem 0.75rem',
                  borderTop: '1px solid var(--border-color)',
                  fontSize: '0.78rem',
                }}
              >
                <div>
                  <div style={{ color: runStatusColor(run.status), fontWeight: 700, textTransform: 'uppercase' }}>
                    {run.status}
                  </div>
                  <div style={{ color: 'var(--text-muted)' }}>
                    {run.batchSize} issues · {formatRunTime(run) || timeAgo(run.updatedAt)}
                  </div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {run.modelProfile}
                  </div>
                  <code style={{ color: 'var(--text-muted)', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {run.branch || run.id}
                  </code>
                </div>
                <div style={{ minWidth: 0, color: 'var(--text-muted)' }}>
                  <div>
                    {Object.entries(run.issueSummary.byCode || {}).map(([code, count]) => `${code}: ${count}`).join(' · ') || 'No issue summary'}
                  </div>
                  <code style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {run.worktreePath || 'worktree pending'}
                  </code>
                </div>
                <div style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                  {run.validation ? (
                    <div>
                      fixed {run.validation.fixedCount}/{run.validation.selectedCount}
                    </div>
                  ) : (
                    <div>validation pending</div>
                  )}
                  {run.prUrl && (
                    <a href={run.prUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--tone-brand)' }}>
                      Draft PR
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Issue cards */}
        {visibleIssues.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--tone-success)' }}>
            ✅ No drift issues found.
          </div>
        ) : (
          visibleIssues.map((issue, idx) => {
            const badge = severityBadge(issue.severity);
            return (
              <div
                key={idx}
                style={{
                  padding: '0.75rem',
                  marginBottom: '0.5rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  backgroundColor: 'var(--bg-surface)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: badge.bg,
                      color: '#fff',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                    }}
                  >
                    {badge.label}
                  </span>
                  <code style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {issue.file}{issue.line > 0 ? `:${issue.line}` : ''}
                  </code>
                  {issue.code && (
                    <code style={{ fontSize: '0.75rem', color: 'var(--text-muted)', opacity: 0.7 }}>
                      {issue.code}
                    </code>
                  )}
                </div>
                <div style={{ fontSize: '0.9rem', marginBottom: issue.suggestion ? '0.25rem' : 0 }}>
                  {issue.message}
                </div>
                {issue.suggestion && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--tone-brand)', fontStyle: 'italic' }}>
                    💡 {issue.suggestion}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
