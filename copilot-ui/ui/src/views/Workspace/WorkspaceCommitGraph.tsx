import { useState, useEffect } from 'react';
import { apiRequest } from '../../lib/api/core';

interface GraphCommit {
  fullHash: string;
  shortHash: string;
  refs: string[];
  author: string;
  date: string;
  subject: string;
  graph: string;
  isMerge: boolean;
}

interface GraphResponse {
  repoPath: string;
  count: number;
  commits: GraphCommit[];
}

interface WorkspaceCommitGraphProps {
  repoPath: string;
  compact?: boolean;
}

const REF_COLORS: Record<string, string> = {
  'HEAD': '#4caf50',
  'main': '#2196f3',
  'master': '#2196f3',
  'origin/main': '#90caf9',
  'origin/master': '#90caf9',
};

function getRefColor(ref: string): string {
  for (const [key, color] of Object.entries(REF_COLORS)) {
    if (ref.includes(key)) return color;
  }
  return '#ff9800';
}

function renderGraphLine(graph: string): { spans: Array<{ char: string; color: string; isMerge: boolean }> } {
  const spans: Array<{ char: string; color: string; isMerge: boolean }> = [];
  for (let i = 0; i < graph.length; i++) {
    const ch = graph[i];
    if (ch === '*') {
      spans.push({ char: '●', color: '#c8ccd4', isMerge: false });
    } else if (ch === '|') {
      spans.push({ char: '│', color: '#555', isMerge: false });
    } else if (ch === '/' || ch === '\\') {
      spans.push({ char: ch === '/' ? '╱' : '╲', color: '#777', isMerge: true });
    } else if (ch === ' ') {
      spans.push({ char: ' ', color: 'transparent', isMerge: false });
    } else {
      spans.push({ char: ch, color: '#555', isMerge: false });
    }
  }
  return { spans };
}

export default function WorkspaceCommitGraph({ repoPath, compact = true }: WorkspaceCommitGraphProps) {
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    setLoading(true);
    apiRequest<GraphResponse>(`/api/git/graph?repoPath=${encodeURIComponent(repoPath)}`)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repoPath]);

  if (loading) return <div className="state-message">Loading graph...</div>;
  if (error) return <div className="state-message" style={{ color: 'var(--color-error-500)' }}>{error}</div>;
  if (!data || data.commits.length === 0) return <div className="state-message">No commits</div>;

  return (
    <div className="workspace-commit-graph" data-testid="workspace-commit-graph" style={{
      fontFamily: 'var(--font-mono, monospace)',
      fontSize: '0.75em',
      lineHeight: 1.6,
      overflowX: 'auto',
      padding: 'var(--space-sm) 0',
    }}>
      {data.commits.map((commit, i) => {
        const { spans } = renderGraphLine(commit.graph);
        return (
          <div key={i} className="workspace-commit-graph-row" style={{ display: 'flex', alignItems: 'baseline', whiteSpace: 'pre', minHeight: '1.5em' }}>
            {/* Graph column */}
            <span style={{ minWidth: compact ? 80 : 120, color: '#555', flexShrink: 0 }}>
              {spans.map((s, j) => (
                <span key={j} style={{ color: s.color }}>{s.char}</span>
              ))}
            </span>
            {/* Hash */}
            <span style={{ color: '#90caf9', marginRight: 8, flexShrink: 0 }}>{commit.shortHash}</span>
            {/* Refs */}
            {commit.refs.map((ref, j) => (
              <span key={j} style={{
                color: getRefColor(ref),
                background: '#ffffff10',
                borderRadius: 3,
                padding: '0 4px',
                marginRight: 4,
                fontSize: '0.85em',
                flexShrink: 0,
              }}>{ref}</span>
            ))}
            {/* Subject */}
            <span style={{
              color: commit.isMerge ? '#ce93d8' : '#c8ccd4',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flex: 1,
            }}>{commit.subject}</span>
            {/* Author + date */}
            {!compact && (
              <span style={{ color: '#666', marginLeft: 8, flexShrink: 0 }}>
                {commit.author} · {commit.date}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
