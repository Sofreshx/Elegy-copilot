import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components';
import { getRepoContextCheck, type DriftCheckResponse } from '../../lib/api/repoContext';

interface WorkspaceHealthTabProps {
  repoPath: string;
}

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

export default function WorkspaceHealthTab({ repoPath }: WorkspaceHealthTabProps) {
  const [data, setData] = useState<DriftCheckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getRepoContextCheck(repoPath);
      setData(result);
      if (!result.ok && result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [repoPath]);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Running drift check...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem' }}>
        <div style={{ color: 'var(--tone-danger)', marginBottom: '1rem' }}>
          Failed to run drift check: {error}
        </div>
        <Button onClick={runCheck}>Retry</Button>
      </div>
    );
  }

  const report = data?.report;
  if (!report) {
    return (
      <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>
        No drift check data available.
        <div style={{ marginTop: '1rem' }}>
          <Button onClick={runCheck}>Run Check</Button>
        </div>
      </div>
    );
  }

  const issues = report.issues || [];
  const counts = report.severityCounts || { error: 0, warning: 0, info: 0 };

  return (
    <div style={{ padding: '1.5rem', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header: Score + Re-check */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem' }}>
          <span style={{ fontSize: '3rem', fontWeight: 700, color: scoreColor(report.score), lineHeight: 1 }}>
            {report.score}
          </span>
          <span style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>/ 100</span>
        </div>
        <Button onClick={runCheck} disabled={loading}>
          {loading ? 'Checking...' : 'Re-check'}
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
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Last checked: {new Date(report.timestamp).toLocaleString()}
      </div>

      {/* Issue list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
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
