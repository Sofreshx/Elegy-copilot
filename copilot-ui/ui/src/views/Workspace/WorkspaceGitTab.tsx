import { useState, useEffect, useRef } from 'react';
import { Button } from '../../components';
import { notificationStore } from '../../stores/notificationStore';
import type { CatalogRepoInventoryEntry } from '../../lib/types';
import type { GitState } from '../../stores/gitStore';
import type {
  GitCheckResults,
  GitBranchEntry,
  MergeCandidate,
  MergeDryRunResponse,
} from '../../lib/api/git';
import {
  getMergeCandidates,
  mergeDryRun,
  mergeLocal,
} from '../../lib/api/git';
import type { VerificationState } from '../Repositories/verification';
import { launchWorkspace } from '../../lib/api/workspace';
import type { WorkspaceLauncher } from '../../lib/api/workspace';
import WorkspaceWorktreesCard from './WorkspaceWorktreesCard';

interface WorkspaceGitTabProps {
  repo: CatalogRepoInventoryEntry | null;
  repoPath: string;
  repoId: string | null;
  gitState: GitState;
  verificationState: VerificationState;
  checkResults: GitCheckResults | null;
  runningChecks: boolean;
  launchers: WorkspaceLauncher[];
  onRunChecks: () => void;
  onCommit: () => void;
  onPush: () => void;
  onOpenPR: () => void;
  onCreatePR: () => void;
  onSetCommitMessage: (msg: string) => void;
  onSetPullRequestTitle: (t: string) => void;
  onSetPullRequestBody: (b: string) => void;
}

export default function WorkspaceGitTab({
  repo,
  repoPath,
  repoId,
  gitState,
  verificationState,
  checkResults,
  runningChecks,
  launchers,
  onRunChecks,
  onCommit,
  onPush,
  onOpenPR,
  onCreatePR,
  onSetCommitMessage,
  onSetPullRequestTitle,
  onSetPullRequestBody,
}: WorkspaceGitTabProps) {
  const GROUP_ORDER = ['ides', 'agents', 'terminals'] as const;
  const GROUP_LABELS: Record<string, string> = {
    ides: 'IDEs',
    agents: 'Agent CLIs',
    terminals: 'Terminals',
  };

  const summary = gitState.summary;
  const branch = summary?.branch ?? null;
  const hasRemote = summary?.hasRemote ?? false;
  const pullRequest = gitState.pullRequest?.pullRequest ?? null;
  const changeCount = summary?.changedFiles ?? 0;
  const stagedCount = summary?.stagedFiles ?? 0;

  // ─── Section 3 state: launchers, commit log expand ──────────────────────
  const [launching, setLaunching] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedCommit, setExpandedCommit] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // ─── Merge candidate state ───────────────────────────────────────────────
  const [mergeCandidates, setMergeCandidates] = useState<MergeCandidate[]>([]);
  const [mergeResults, setMergeResults] = useState<Record<string, MergeDryRunResponse>>({});
  const [merging, setMerging] = useState<string | null>(null);
  const [dryRunning, setDryRunning] = useState<string | null>(null);

  // ─── Load merge candidates ───────────────────────────────────────────────
  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    async function load() {
      try {
        const data = await getMergeCandidates(repoPath);
        if (!cancelled) setMergeCandidates(data.branches);
      } catch {
        // merge candidates are informational, not critical
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [repoPath]);

  // ─── Close menu on outside click ─────────────────────────────────────────
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  // ─── Launch handler ──────────────────────────────────────────────────────
  async function handleLaunch(launcherId: string) {
    setLaunching(launcherId);
    setMenuOpen(false);
    try {
      const result = await launchWorkspace(launcherId, repoPath);
      if (!result.ok) {
        notificationStore.error('Launch failed', { message: `Failed to open ${launcherId}` });
      }
    } catch (err) {
      notificationStore.error('Launch failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setLaunching(null);
    }
  }

  // ─── Merge dry-run handler ───────────────────────────────────────────────
  async function handleDryRun(branchName: string) {
    if (!repoPath || !summary?.branch) return;
    setDryRunning(branchName);
    try {
      const result = await mergeDryRun(repoPath, branchName, summary.branch);
      setMergeResults((prev) => ({ ...prev, [branchName]: result }));
    } catch (err) {
      setMergeResults((prev) => ({
        ...prev,
        [branchName]: {
          ok: false,
          clean: false,
          diagnostics: err instanceof Error ? err.message : String(err),
          sourceRef: branchName,
          targetRef: summary.branch || '',
          dirty: false,
        },
      }));
    } finally {
      setDryRunning(null);
    }
  }

  // ─── Merge local handler ─────────────────────────────────────────────────
  async function handleMerge(branchName: string) {
    if (!repoPath || !summary?.branch) return;
    setMerging(branchName);
    try {
      const result = await mergeLocal(repoPath, branchName, summary.branch);
      notificationStore.success('Merge complete', { message: `Merged ${branchName} into ${summary.branch}` });
      // Clear the dry-run result so the user can re-evaluate
      setMergeResults((prev) => {
        const next = { ...prev };
        delete next[branchName];
        return next;
      });
    } catch (err) {
      notificationStore.error('Merge failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setMerging(null);
    }
  }

  // ─── Group launchers ─────────────────────────────────────────────────────
  const grouped = new Map<string, WorkspaceLauncher[]>();
  for (const l of launchers) {
    const group = l.group || 'unknown';
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(l);
  }
  const availableLaunchers = launchers.filter((l) => l.available);

  // ─── Resolve branches from gitState, cross-reference with mergeCandidates ──
  const localBranches: GitBranchEntry[] = (gitState.branches?.branches ?? []).filter((b) => !b.remote);
  const mergeCandidateNames = new Set(mergeCandidates.map((m) => m.name));

  return (
    <div className="workspace-git-tab" data-testid="workspace-git-tab">

      {/* ──────────────────────────────────────────────────────────────── */}
      {/* SECTION 1 — Summary Strip                                        */}
      {/* ──────────────────────────────────────────────────────────────── */}
      <div className="workspace-git-summary" data-testid="workspace-git-summary">
        {branch ? (
          <span className="workspace-git-summary-branch" data-testid="workspace-summary-branch">
            ⎇ {branch}
          </span>
        ) : null}

        <span
          className={`workspace-git-summary-clean-badge ${
            changeCount > 0 ? 'workspace-git-summary-dirty' : 'workspace-git-summary-clean'
          }`}
          data-testid="workspace-summary-clean"
        >
          {changeCount > 0 ? `Dirty (${changeCount})` : 'Clean'}
        </span>

        {stagedCount > 0 ? (
          <span className="workspace-git-summary-staged" data-testid="workspace-summary-staged">
            {stagedCount} staged
          </span>
        ) : null}

        {(summary?.ahead ?? 0) > 0 ? (
          <span className="workspace-git-summary-ahead" data-testid="workspace-summary-ahead">
            ↑{summary?.ahead}
          </span>
        ) : null}

        {(summary?.behind ?? 0) > 0 ? (
          <span className="workspace-git-summary-behind" data-testid="workspace-summary-behind">
            ↓{summary?.behind}
          </span>
        ) : null}

        {summary?.upstream ? (
          <span className="workspace-git-summary-upstream" data-testid="workspace-summary-upstream">
            {summary.upstream}
          </span>
        ) : null}

        {pullRequest ? (
          <a
            className="workspace-git-summary-pr-link"
            href={pullRequest.url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="workspace-summary-pr-link"
          >
            PR #{pullRequest.number} ({pullRequest.state})
          </a>
        ) : null}

        <span className="workspace-git-summary-path" data-testid="workspace-summary-path">
          {repo?.repoLabel || repoPath}
        </span>
      </div>

      {/* ──────────────────────────────────────────────────────────────── */}
      {/* SECTION 2 — Branches & Worktrees                                 */}
      {/* ──────────────────────────────────────────────────────────────── */}
      <div className="workspace-git-branches-area" data-testid="workspace-git-branches-area">
        {/* Left: Local branches list */}
        <div className="workspace-git-branches-pane" data-testid="workspace-git-branches-pane">
          <h3 className="workspace-git-section-title">Local Branches</h3>
          {localBranches.length === 0 ? (
            <div className="state-message" data-testid="workspace-git-no-branches">No local branches found.</div>
          ) : (
            <ul className="workspace-git-branch-list" data-testid="workspace-git-branches-list">
              {localBranches.map((b) => {
                const mc = mergeCandidates.find((c) => c.name === b.name);
                const drResult = mergeResults[b.name];
                return (
                  <li
                    key={b.name}
                    className={`workspace-git-branch-item ${b.current ? 'workspace-git-branch-current' : ''}`}
                    data-testid={`workspace-git-branch-${b.name}`}
                  >
                    <div className="workspace-git-branch-row">
                      <span className="workspace-git-branch-name">
                        {b.current ? '✓ ' : ''}{b.name}
                      </span>
                      {b.upstream ? (
                        <span className="workspace-git-branch-upstream">{b.upstream}</span>
                      ) : null}
                      {b.current ? (
                        <span className="workspace-git-branch-current-badge">current</span>
                      ) : null}
                      {mc && mergeCandidateNames.has(b.name) ? (
                        <span className="workspace-git-branch-merge-candidate-badge">Merge candidate</span>
                      ) : null}
                    </div>

                    {/* Merge candidate details */}
                    {mc && !b.current ? (
                      <div className="workspace-git-merge-details" data-testid={`workspace-git-merge-details-${b.name}`}>
                        <span className="workspace-git-merge-ahead-behind">
                          Ahead ↑{mc.ahead} / Behind ↓{mc.behind}
                        </span>
                        {mc.lastCommit ? (
                          <span className="workspace-git-merge-last-commit">{mc.lastCommit.slice(0, 7)}</span>
                        ) : null}
                        {mc.isMerged ? (
                          <span className="workspace-git-merge-status-merged">Merged</span>
                        ) : (
                          <span className="workspace-git-merge-status-not-merged">Not merged</span>
                        )}

                        {/* Dry-run / Merge controls */}
                        {!mc.isMerged ? (
                          <div className="workspace-git-merge-controls">
                            {!drResult ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={dryRunning === b.name}
                                onClick={() => void handleDryRun(b.name)}
                                testId={`workspace-git-dry-run-${b.name}`}
                              >
                                {dryRunning === b.name ? 'Analyzing...' : 'Dry-run'}
                              </Button>
                            ) : drResult.ok ? (
                              <div className="workspace-git-merge-clean">
                                <span className="workspace-git-merge-clean-label">✓ Ready to merge locally</span>
                                <Button
                                  variant="primary"
                                  size="sm"
                                  disabled={merging === b.name}
                                  onClick={() => void handleMerge(b.name)}
                                  testId={`workspace-git-merge-local-${b.name}`}
                                >
                                  {merging === b.name ? 'Merging...' : 'Merge locally'}
                                </Button>
                              </div>
                            ) : drResult.dirty ? (
                              <div className="workspace-git-merge-dirty">
                                <span>⚠ Working tree is dirty</span>
                              </div>
                            ) : drResult.conflicts && drResult.conflicts.length > 0 ? (
                              <div className="workspace-git-merge-conflicts">
                                <span className="workspace-git-merge-conflicts-label">
                                  ✗ Conflicts: {drResult.conflicts.length} file(s)
                                </span>
                                <ul className="workspace-git-merge-conflicts-list">
                                  {drResult.conflicts.map((f) => (
                                    <li key={f}>{f}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : (
                              <div className="workspace-git-merge-error">
                                <span>✗ {drResult.diagnostics}</span>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Right: Worktrees card */}
        <div className="workspace-git-worktrees-pane" data-testid="workspace-git-worktrees-pane">
          <WorkspaceWorktreesCard repoPath={repoPath} repoId={repoId} />
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────── */}
      {/* SECTION 3 — Actions & History                                    */}
      {/* ──────────────────────────────────────────────────────────────── */}
      <div className="workspace-git-actions-area" data-testid="workspace-git-actions-area">
        {/* Launch row */}
        <div className="workspace-git-launch-row" ref={menuRef}>
          <Button
            variant="primary"
            size="sm"
            testId="workspace-launch-trigger"
            disabled={availableLaunchers.length === 0}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {launching ? 'Opening...' : 'Open in...'}
          </Button>
          {menuOpen && (
            <div className="workspace-launch-menu" data-testid="workspace-launch-menu">
              {GROUP_ORDER.filter((g) => grouped.has(g)).map((group) => (
                <div key={group} className="workspace-launch-menu-group">
                  <div className="workspace-launch-menu-group-label">{GROUP_LABELS[group] || group}</div>
                  {grouped.get(group)!.map((launcher) => (
                    <button
                      key={launcher.id}
                      className="workspace-launch-menu-item"
                      type="button"
                      disabled={!launcher.available || launching === launcher.id}
                      onClick={() => void handleLaunch(launcher.id)}
                      data-testid={`workspace-launch-${launcher.id}`}
                      title={launcher.available ? undefined : launcher.reason || `${launcher.label} is not available`}
                    >
                      <span className="workspace-launch-menu-item-label">
                        {launching === launcher.id ? 'Opening...' : launcher.label}
                      </span>
                      {launcher.argsPreview ? (
                        <span className="workspace-launch-menu-item-args">{launcher.argsPreview}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Check results */}
        {checkResults ? (
          <div
            className={`workspace-checks-result ${checkResults.allPassed ? 'workspace-checks-passed' : 'workspace-checks-failed'}`}
            data-testid="workspace-checks-result"
          >
            {checkResults.allPassed ? 'All checks passed' : 'Some checks failed'}
          </div>
        ) : null}

        {/* Commit form */}
        <div className="workspace-git-commit-row" data-testid="workspace-git-actions">
          <Button
            variant="secondary"
            size="sm"
            disabled={runningChecks}
            onClick={onRunChecks}
            testId="workspace-run-checks"
          >
            {runningChecks ? 'Running...' : 'Run checks'}
          </Button>
          <input
            className="form-input-field"
            type="text"
            placeholder="Commit message..."
            value={gitState.commitMessage}
            onChange={(e) => onSetCommitMessage(e.target.value)}
            disabled={gitState.committing}
          />
          <Button
            variant="primary"
            size="sm"
            disabled={!gitState.commitMessage.trim() || gitState.committing}
            onClick={onCommit}
            testId="workspace-commit"
          >
            {gitState.committing ? 'Committing...' : 'Commit'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!hasRemote || gitState.syncing}
            onClick={onPush}
            testId="workspace-push"
          >
            {gitState.syncing ? 'Pushing...' : 'Push'}
          </Button>
        </div>

        {/* Verification warning */}
        {verificationState !== 'verified' && changeCount > 0 ? (
          <div className="workspace-commit-warning" data-testid="workspace-commit-warning">
            Checks are not verified. Run checks before pushing.
          </div>
        ) : null}

        {/* PR section */}
        {hasRemote ? (
          pullRequest ? (
            <div className="workspace-git-pr-existing" data-testid="workspace-git-pr-existing">
              <a href={pullRequest.url} target="_blank" rel="noopener noreferrer" className="workspace-git-pr-link">
                PR #{pullRequest.number} ({pullRequest.state})
              </a>
              <Button variant="ghost" size="sm" onClick={onOpenPR} testId="workspace-open-pr">
                Open PR
              </Button>
            </div>
          ) : (
            <div className="workspace-git-pr-create" data-testid="workspace-git-pr-create">
              <input
                className="form-input-field"
                type="text"
                placeholder="PR title..."
                value={gitState.pullRequestTitle}
                onChange={(e) => onSetPullRequestTitle(e.target.value)}
                disabled={gitState.creatingPullRequest}
              />
              <input
                className="form-input-field"
                type="text"
                placeholder="PR body (optional)..."
                value={gitState.pullRequestBody}
                onChange={(e) => onSetPullRequestBody(e.target.value)}
                disabled={gitState.creatingPullRequest}
              />
              <Button
                variant="primary"
                size="sm"
                disabled={!gitState.pullRequestTitle.trim() || gitState.creatingPullRequest}
                onClick={onCreatePR}
                testId="workspace-create-pr"
              >
                {gitState.creatingPullRequest ? 'Creating...' : 'Create pull request'}
              </Button>
            </div>
          )
        ) : null}

        {/* Commit log */}
        {gitState.log && gitState.log.commits.length > 0 ? (
          <div className="workspace-commit-log" data-testid="workspace-commit-log">
            {gitState.log.commits.slice(0, 5).map((commit, index) => (
              <div key={commit.hash}>
                <button
                  type="button"
                  className="workspace-commit-entry workspace-commit-entry-clickable"
                  onClick={() => setExpandedCommit(expandedCommit === index ? null : index)}
                  data-testid={`workspace-commit-entry-${index}`}
                >
                  <span className="workspace-commit-hash">{commit.hash.slice(0, 7)}</span>
                  <span className="workspace-commit-msg">{commit.message}</span>
                </button>
                {expandedCommit === index ? (
                  <div className="workspace-commit-detail" data-testid={`workspace-commit-detail-${index}`}>
                    <div className="workspace-commit-detail-row">
                      <span className="workspace-commit-detail-label">Hash</span>
                      <span className="workspace-commit-detail-value">{commit.hash}</span>
                    </div>
                    {commit.fullHash ? (
                      <div className="workspace-commit-detail-row">
                        <span className="workspace-commit-detail-label">Full hash</span>
                        <span className="workspace-commit-detail-value">{commit.fullHash}</span>
                      </div>
                    ) : null}
                    <div className="workspace-commit-detail-row">
                      <span className="workspace-commit-detail-label">Message</span>
                      <span className="workspace-commit-detail-value">{commit.message}</span>
                    </div>
                    <div className="workspace-commit-detail-row">
                      <span className="workspace-commit-detail-label">Author</span>
                      <span className="workspace-commit-detail-value">{commit.author || 'Unknown author'}</span>
                    </div>
                    <div className="workspace-commit-detail-row">
                      <span className="workspace-commit-detail-label">Date</span>
                      <span className="workspace-commit-detail-value">{commit.authoredAt || 'Unknown date'}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="state-message">No commits found.</div>
        )}
      </div>
    </div>
  );
}
