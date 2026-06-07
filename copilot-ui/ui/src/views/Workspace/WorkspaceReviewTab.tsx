import { useState, useEffect } from 'react';
import { listExecutorWorktrees } from '../../lib/api/executor';
import { getEnrichedWorktrees } from '../../lib/api/elegyDb';
import type { ExecutorWorktreeRecord, EnrichedWorktreeEntry } from '../../lib/types';

interface WorkspaceReviewTabProps {
  repoPath: string;
  repoId: string | null;
}

type ReviewTarget = 'worktree' | 'pr';

const HARNESS_OPTIONS = [
  { id: 'opencode', label: 'OpenCode', icon: '\u229E', description: 'Use OpenCode for code review' },
  { id: 'codex', label: 'Codex', icon: '\u25C8', description: 'Use Codex for code review' },
];

const OPENCODE_LANES = [
  { id: 'quick', label: 'Quick', description: 'Fast review, small scope' },
  { id: 'standard', label: 'Standard', description: 'Normal review with gates' },
  { id: 'spec', label: 'Spec', description: 'Spec-driven review' },
  { id: 'project', label: 'Project', description: 'Multi-session project review' },
];

export default function WorkspaceReviewTab({ repoPath, repoId }: WorkspaceReviewTabProps) {
  const [worktrees, setWorktrees] = useState<ExecutorWorktreeRecord[]>([]);
  const [enrichedWorktrees, setEnrichedWorktrees] = useState<EnrichedWorktreeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Form state
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget>('worktree');
  const [selectedWorktree, setSelectedWorktree] = useState<string>('');
  const [prUrl, setPrUrl] = useState('');
  const [harness, setHarness] = useState('opencode');
  const [lane, setLane] = useState('standard');
  
  // Result state
  const [launching, setLaunching] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null);
  const [prepareData, setPrepareData] = useState<any>(null);
  const [prepareLoading, setPrepareLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!repoPath) return;
      setLoading(true);
      try {
        const [execData, enriched] = await Promise.all([
          listExecutorWorktrees({ repoId: repoId || undefined, repoPath }),
          getEnrichedWorktrees(repoPath).catch(() => ({ worktrees: [], count: 0 })),
        ]);
        if (!cancelled) {
          setWorktrees(execData.worktrees || []);
          setEnrichedWorktrees(enriched.worktrees || []);
          // Auto-select the most active worktree
          const enrichedWithActivity = enriched.worktrees
            .filter(w => w.sessionCount > 0 || w.status === 'active')
            .sort((a, b) => b.sessionCount - a.sessionCount);
          if (enrichedWithActivity.length > 0) {
            setSelectedWorktree(enrichedWithActivity[0].path);
          } else if ((execData.worktrees || []).length > 0) {
            setSelectedWorktree(execData.worktrees[0].path || execData.worktrees[0].worktreePath || '');
          }
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [repoPath, repoId]);

  // Prepare review context when worktree changes
  useEffect(() => {
    if (!selectedWorktree || reviewTarget !== 'worktree') {
      setPrepareData(null);
      return;
    }
    let cancelled = false;
    async function loadPrepare() {
      setPrepareLoading(true);
      try {
        const params = new URLSearchParams({ repoPath, worktreePath: selectedWorktree });
        const res = await fetch(`/api/code-review/prepare?${params}`);
        if (!cancelled && res.ok) {
          setPrepareData(await res.json());
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setPrepareLoading(false);
      }
    }
    void loadPrepare();
    return () => { cancelled = true; };
  }, [selectedWorktree, repoPath, reviewTarget]);

  async function handleLaunch() {
    setLaunching(true);
    setResult(null);
    try {
      const body: any = {
        harness,
        lane: harness === 'opencode' ? lane : undefined,
        repoPath,
      };
      if (reviewTarget === 'worktree' && selectedWorktree) {
        body.worktreePath = selectedWorktree;
      } else if (reviewTarget === 'pr' && prUrl) {
        body.prUrl = prUrl;
      }

      const res = await fetch('/api/code-review/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLaunching(false);
    }
  }

  const getWorktreeStatus = (wt: ExecutorWorktreeRecord): string => {
    const enriched = enrichedWorktrees.find(w =>
      (w.path || '').replace(/\\/g, '/').toLowerCase() === (wt.path || wt.worktreePath || '').replace(/\\/g, '/').toLowerCase()
    );
    if (enriched) {
      if (enriched.sessionCount > 0) return `${enriched.sessionCount} session(s) active`;
      return enriched.status || 'ready';
    }
    return wt.status || 'ready';
  };

  return (
    <div className="workspace-review-tab" data-testid="workspace-review-tab">
      <div className="workspace-review-header">
        <h3>Code Review</h3>
        <span className="workspace-review-subtitle">Launch automated code review for worktrees or pull requests</span>
      </div>

      {/* Review target selection */}
      <div className="workspace-review-section">
        <label className="workspace-review-label">Review Target</label>
        <div className="workspace-review-target-row">
          <button
            type="button"
            className={`workspace-review-target-btn${reviewTarget === 'worktree' ? ' active' : ''}`}
            onClick={() => setReviewTarget('worktree')}
          >
            <span>{'\uD83C\uDF33'}</span> Local Worktree
          </button>
          <button
            type="button"
            className={`workspace-review-target-btn${reviewTarget === 'pr' ? ' active' : ''}`}
            onClick={() => setReviewTarget('pr')}
          >
            <span>{'\uD83D\uDD17'}</span> Pull Request
          </button>
        </div>
      </div>

      {/* Worktree selection */}
      {reviewTarget === 'worktree' && (
        <div className="workspace-review-section">
          <label className="workspace-review-label">Worktree</label>
          {loading ? (
            <div className="state-message">Loading worktrees...</div>
          ) : worktrees.length === 0 ? (
            <div className="state-message">No worktrees found for this repo. Create one first.</div>
          ) : (
            <select
              className="workspace-review-select"
              value={selectedWorktree}
              onChange={(e) => setSelectedWorktree(e.target.value)}
            >
              {worktrees.map((wt) => {
                const path = wt.path || wt.worktreePath || '';
                const branch = wt.branch || (wt.git && wt.git.branch) || 'unknown';
                return (
                  <option key={path} value={path}>
                    {branch} — {path} [{getWorktreeStatus(wt)}]
                  </option>
                );
              })}
            </select>
          )}

          {/* Diff preview */}
          {prepareLoading ? (
            <div className="state-message" style={{marginTop: 8}}>Analyzing changes...</div>
          ) : prepareData ? (
            <div className="workspace-review-prepare">
              <div className="workspace-review-prepare-header">
                <span>{prepareData.branch || 'unknown branch'}</span>
                <span>{prepareData.changedFileCount} files changed</span>
              </div>
              {prepareData.diffStat && (
                <pre className="workspace-review-diff-stat">{prepareData.diffStat}</pre>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* PR URL input */}
      {reviewTarget === 'pr' && (
        <div className="workspace-review-section">
          <label className="workspace-review-label">Pull Request URL</label>
          <input
            type="text"
            className="workspace-review-input"
            value={prUrl}
            onChange={(e) => setPrUrl(e.target.value)}
            placeholder="https://github.com/owner/repo/pull/123"
          />
          <small className="workspace-review-hint">Enter the full URL of the pull request to review</small>
        </div>
      )}

      {/* Harness selection */}
      <div className="workspace-review-section">
        <label className="workspace-review-label">Review Tool</label>
        <div className="workspace-review-harness-row">
          {HARNESS_OPTIONS.map((h) => (
            <button
              key={h.id}
              type="button"
              className={`workspace-review-harness-btn${harness === h.id ? ' active' : ''}`}
              onClick={() => setHarness(h.id)}
              title={h.description}
            >
              <span className="workspace-review-harness-icon">{h.icon}</span>
              {h.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lane selection (OpenCode only) */}
      {harness === 'opencode' && (
        <div className="workspace-review-section">
          <label className="workspace-review-label">Lane</label>
          <div className="workspace-review-lane-row">
            {OPENCODE_LANES.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`workspace-review-lane-btn${lane === l.id ? ' active' : ''}`}
                onClick={() => setLane(l.id)}
                title={l.description}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Launch button */}
      <div className="workspace-review-section">
        <button
          type="button"
          className="workspace-review-launch-btn"
          onClick={() => void handleLaunch()}
          disabled={
            launching ||
            (reviewTarget === 'worktree' && !selectedWorktree) ||
            (reviewTarget === 'pr' && !prUrl)
          }
        >
          {launching ? (
            <>{'\u23F3'} Launching...</>
          ) : (
            <>{'\u25B6'} Start Code Review</>
          )}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className={`workspace-review-result${result.ok ? ' success' : ' error'}`}>
          {result.ok ? (
            <span>{'\u2705'} {result.message}</span>
          ) : (
            <span>{'\u274C'} {result.error || 'Launch failed'}</span>
          )}
        </div>
      )}
    </div>
  );
}
