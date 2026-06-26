import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components';
import { useStoreValue } from '../../lib/store';
import { driftCheckStore, type DriftRepoState } from '../../stores/driftCheckStore';

interface WorkspaceHealthTabProps {
  repoPath: string;
}

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

export default function WorkspaceHealthTab({ repoPath }: WorkspaceHealthTabProps) {
  const state = useStoreValue(driftCheckStore);
  const [fullCheckLoading, setFullCheckLoading] = useState(false);
  const initRef = useRef(false);

  const normalizedRepoPath = repoPath.replace(/\\/g, '/').toLowerCase();

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    driftCheckStore.initRepo(repoPath);
  }, [repoPath]);

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
        <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-muted)' }}>
          Issues ({issues.length})
        </div>
        {issues.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--tone-success)' }}>
            ✅ No drift issues found.
          </div>
        ) : (
          issues.map((issue, idx) => {
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
