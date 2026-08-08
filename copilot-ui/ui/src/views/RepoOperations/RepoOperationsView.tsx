import { useEffect, useMemo, useState } from 'react';
import { AppIcon, Badge, Button, PageContainer } from '../../components';
import type { RepoOperationsActionResult, RepoOperationsEntity, RepoOperationsPullRequest, RepoOperationsRepository } from '../../lib/api/repoOperations';
import { useStoreValue } from '../../lib/store';
import { navigationStore } from '../../stores/navigation';
import { repoOperationsStore } from './repoOperationsStore';

type PendingAction = 'fetch' | 'sync' | 'analyze' | 'strict-cleanup' | 'analyzed-cleanup' | null;
type EntityRow = RepoOperationsEntity & { repoId: string; repoLabel: string; repoPath: string | null };

const ISSUE_TITLES: Record<string, string> = {
  'dirty-worktree': 'Working tree is dirty', diverged: 'Branch diverged', 'no-upstream': 'No upstream',
  'active-session-or-worktree': 'Active session or worktree', 'protected-branch': 'Protected branch',
  'analysis-required': 'Analysis required', 'analysis-not-high-confidence': 'Analysis not high confidence',
  'remote-unavailable': 'Remote unavailable', 'stale-cleanup-candidate': 'State changed',
};

function relativeTime(value: number | string | null | undefined): string {
  const timestamp = typeof value === 'number' ? value : Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'No recent activity';
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1_440)}d ago`;
}

function entityKey(entity: EntityRow): string { return `${entity.repoId}\u0000${entity.id}`; }

function statusTone(value: string): 'success' | 'accent' | 'danger' | 'neutral' {
  if (['strict-safe', 'analyzed-safe', 'up-to-date', 'merged', 'clean'].includes(value)) return 'success';
  if (['blocked', 'diverged', 'dirty'].includes(value)) return 'danger';
  if (['analysis-required', 'protected', 'behind', 'active-worktree'].includes(value)) return 'accent';
  return 'neutral';
}

function entitiesForRepository(repo: RepoOperationsRepository): EntityRow[] {
  if (repo.entities?.length) return repo.entities.map((entity) => ({ ...entity, repoId: String(repo.repoId || ''), repoLabel: repo.repoLabel, repoPath: repo.repoPath }));
  return repo.branches.map((branch) => ({
    id: `local:${branch.name}`, kind: 'local-branch', branch: branch.name, worktreePath: branch.worktree || null,
    remoteName: null, observedSha: branch.sha || null, observedDefaultSha: repo.sync.headSha || null, activityAt: branch.activityAt || null,
    localState: branch.state, remoteState: branch.upstream ? 'tracked' : 'none', safety: branch.cleanupEligible ? 'strict-safe' : branch.current || branch.default ? 'protected' : 'analysis-required',
    cleanupEligible: branch.cleanupEligible, blockerCodes: branch.issueCodes || [], repoId: String(repo.repoId || ''), repoLabel: repo.repoLabel, repoPath: repo.repoPath,
  }));
}

function ConfirmationDialog({ action, count, onCancel, onConfirm }: { action: Exclude<PendingAction, null>; count: number; onCancel: () => void; onConfirm: () => void }) {
  const copy: Record<Exclude<PendingAction, null>, { title: string; body: string; button: string }> = {
    fetch: { title: 'Fetch all selected remotes', body: 'This fetches and prunes local remote-tracking refs only. It does not update any checkout.', button: 'Fetch remotes' },
    sync: { title: 'Fast-forward eligible repositories', body: 'Only clean, inactive current branches with a fresh matching upstream can update. Others remain visible as skipped.', button: 'Fast-forward eligible' },
    analyze: { title: 'Analyze selected candidates', body: 'This runs deterministic Git and GitHub checks only. It does not modify repositories.', button: 'Analyze selected' },
    'strict-cleanup': { title: 'Clean safe candidates', body: 'Only freshly revalidated, inactive, provably merged entities are removed.', button: 'Clean safe' },
    'analyzed-cleanup': { title: 'Delete analyzed candidates', body: 'Each selected item must remain high-confidence content-equivalent with the exact observed SHA. This is a stronger confirmation than strict cleanup.', button: 'Delete analyzed candidates' },
  };
  const detail = copy[action];
  return <div className="repo-operations-dialog-backdrop" role="presentation"><div aria-modal="true" className="repo-operations-dialog" role="dialog">
    <div className="repo-operations-dialog-header"><div><h2>{detail.title}</h2><p>{detail.body}</p></div><Button onClick={onCancel} size="sm" variant="ghost">Cancel</Button></div>
    <p className="repo-operations-confirm-count">{count} selected {count === 1 ? 'entity' : 'entities'}</p>
    <div className="repo-operations-dialog-actions"><Button onClick={onCancel} variant="ghost">Cancel</Button><Button onClick={onConfirm} variant={action.includes('cleanup') ? 'secondary' : 'primary'}>{detail.button}</Button></div>
  </div></div>;
}

function DetailDrawer({ repo, entity, onClose, onAnalyze }: { repo: RepoOperationsRepository | null; entity: EntityRow | null; onClose: () => void; onAnalyze: () => void }) {
  if (!repo && !entity) return null;
  const issues = repo?.issues || [];
  const evidence = entity?.analysis;
  return <aside aria-label="Repository details" className="repo-operations-detail-drawer">
    <div className="repo-operations-drawer-header"><div><strong>{repo?.repoLabel || entity?.repoLabel}</strong><span>{entity?.branch || relativeTime(repo?.lastActivityMs)}</span></div><Button aria-label="Close details" onClick={onClose} size="sm" variant="ghost">×</Button></div>
    {repo?.repoPath ? <Button onClick={() => navigationStore.openWorkspace(repo.repoPath!, repo.repoLabel)} size="sm" variant="primary">Open workspace</Button> : null}
    {entity ? <Button onClick={onAnalyze} size="sm" variant="secondary">Analyze blockers</Button> : null}
    {entity ? <section className="repo-operations-drawer-section"><h2>Safety</h2><Badge tone={statusTone(entity.safety)}>{entity.safety.replace(/-/g, ' ')}</Badge><dl><dt>Local state</dt><dd>{entity.localState || '—'}</dd><dt>Remote state</dt><dd>{entity.remoteState || '—'}</dd><dt>Observed SHA</dt><dd>{entity.observedSha || 'Unavailable'}</dd></dl></section> : null}
    {evidence ? <section className="repo-operations-drawer-section"><h2>Cheap analysis report</h2><strong>{evidence.classification === 'analyzed-safe' ? 'Safe to delete after fresh recheck' : evidence.classification === 'strict-safe' ? 'Strictly safe candidate' : 'Needs deeper review'}</strong><dl><dt>Tip reachable from default</dt><dd>{evidence.branchTipReachableFromDefault ? 'Yes' : 'No'}</dd><dt>Unique commits</dt><dd>{evidence.uniqueCommits ?? 'Unavailable'}</dd><dt>Tree delta</dt><dd>{evidence.treeDelta === false ? 'None' : evidence.treeDelta === true ? 'Present' : 'Unavailable'}</dd><dt>Open pull requests</dt><dd>{evidence.openPullRequests.length || 'None'}</dd><dt>Active work</dt><dd>{evidence.active ? 'Yes' : 'None'}</dd></dl></section> : null}
    <section className="repo-operations-drawer-section"><h2>Issues ({issues.length || entity?.blockerCodes.length || 0})</h2><div className="repo-operations-drawer-issues">{(() => { const entries = entity?.blockerCodes.length ? entity.blockerCodes.map((code) => ({ code, title: ISSUE_TITLES[code] || code, message: '' })) : issues; return entries.length ? entries.map((issue) => <article key={issue.code}><AppIcon name="warning" size={15} /><div><strong>{issue.title || ISSUE_TITLES[issue.code] || issue.code}</strong><span>{issue.message}</span></div></article>) : <p>No issues.</p>; })()}</div></section>
  </aside>;
}

function ActionResultPanel({ result }: { result: RepoOperationsActionResult }) {
  const summary = Object.entries(result.summary).map(([key, value]) => `${key} ${value}`).join(' · ');
  return <section className="repo-operations-result" aria-label="Latest operation results" data-testid="repo-operations-action-results" role="status">
    <header><strong>{result.operation} finished</strong><span>{summary}</span></header>
    {result.repositories?.length ? <div className="repo-operations-result-list">{result.repositories.map((repository) => <article key={repository.repoId || repository.repoLabel}>
      <div><strong>{repository.repoLabel || repository.repoId || 'Unknown repository'}</strong><Badge tone={repository.status === 'fetched' ? 'success' : repository.status === 'failed' ? 'danger' : 'accent'}>{repository.status}</Badge></div>
      {repository.remotes?.map((remote) => <p key={remote.name}><span>{remote.name}</span><span>{remote.status}{remote.error ? ` · ${remote.error}` : ''}</span></p>)}
      {repository.error ? <p>{repository.error}</p> : null}{repository.issueCodes?.length ? <small>{repository.issueCodes.join(' · ')}</small> : null}
    </article>)}</div> : null}
    {result.entities?.length ? <div className="repo-operations-result-list">{result.entities.map((entity) => <article key={`${entity.repoId}\u0000${entity.entityId}`}>
      <div><strong>{entity.entityId}</strong><Badge tone={entity.status === 'completed' || entity.status === 'removed' ? 'success' : entity.status === 'failed' ? 'danger' : 'accent'}>{entity.status}</Badge></div>
      {entity.evidence ? <p><span>Classification</span><span>{entity.evidence.classification.replaceAll('-', ' ')} · tree delta {entity.evidence.treeDelta === false ? 'none' : entity.evidence.treeDelta === true ? 'present' : 'unknown'} · unique commits {entity.evidence.uniqueCommits ?? 'unknown'}</span></p> : null}
      {entity.blockerCodes.length ? <small>{entity.blockerCodes.join(' · ')}</small> : null}{entity.error ? <p>{entity.error}</p> : null}
    </article>)}</div> : null}
  </section>;
}

function RepositoryTable({ repositories, onDetail, onPrepare }: { repositories: RepoOperationsRepository[]; onDetail: (repo: RepoOperationsRepository) => void; onPrepare: (repo: RepoOperationsRepository) => void }) {
  return <div className="repo-operations-table-wrap"><table><thead><tr><th>Repository</th><th>Activity</th><th>Sync</th><th>Branches / worktrees</th><th>Issues</th><th>Actions</th></tr></thead><tbody>{repositories.map((repo) => {
    const issueCount = repo.issues.length + (repo.sync.issueCodes?.length || 0); const entityCount = entitiesForRepository(repo).length;
    return <tr key={repo.repoId || repo.repoPath}><td><button className="repo-operations-repo-link" onClick={() => repo.repoPath && navigationStore.openWorkspace(repo.repoPath, repo.repoLabel)}>{repo.repoLabel}</button><span className="repo-operations-secondary-cell">{repo.sync.branch || 'Detached'}</span></td><td>{relativeTime(repo.lastActivityMs)}</td><td><Badge tone={repo.sync.syncEligible ? 'success' : statusTone(repo.sync.clean === false ? 'dirty' : 'analysis-required')}>{repo.sync.syncEligible ? 'Up to date / eligible' : repo.sync.clean === false ? 'Dirty' : 'Needs attention'}</Badge></td><td>{entityCount} entities</td><td><button className="repo-operations-issue-button" onClick={() => onDetail(repo)}><AppIcon name={issueCount ? 'warning' : 'check'} size={15} /> {issueCount || 'Clean'}</button></td><td><div className="repo-operations-row-menu" data-testid={`repo-operations-repository-actions-${repo.repoId || repo.repoLabel}`}><Button onClick={() => onDetail(repo)} size="sm" variant="ghost">Details</Button>{repo.actionCapabilities?.prAgent ? <Button disabled={!repo.actionCapabilities.prAgent.enabled} onClick={() => onPrepare(repo)} size="sm" testId={`repo-operations-prepare-${repo.repoId || repo.repoLabel}`} variant="secondary">Prepare merge</Button> : null}</div></td></tr>;
  })}{repositories.length === 0 ? <tr><td colSpan={6} className="empty-cell">No repositories match this filter.</td></tr> : null}</tbody></table></div>;
}

function EntityTable({ entities, selectedKeys, onSelect, onSelectAll, onDetail }: { entities: EntityRow[]; selectedKeys: string[]; onSelect: (entity: EntityRow) => void; onSelectAll: (selected: boolean) => void; onDetail: (entity: EntityRow) => void }) {
  const allSelected = entities.length > 0 && entities.every((entity) => selectedKeys.includes(entityKey(entity)));
  return <div className="repo-operations-table-wrap"><table><thead><tr><th><input aria-label="Select all visible entities" checked={allSelected} disabled={entities.length === 0} onChange={(event) => onSelectAll(event.target.checked)} type="checkbox" /></th><th>Repository</th><th>Branch / worktree</th><th>Last activity</th><th>Local state</th><th>Remote state</th><th>Safety</th><th>Issues</th></tr></thead><tbody>{entities.map((entity) => { const key = entityKey(entity); return <tr key={key}><td><input aria-label={`Select ${entity.branch}`} checked={selectedKeys.includes(key)} onChange={() => onSelect(entity)} type="checkbox" /></td><td><button className="repo-operations-repo-link" onClick={() => entity.repoPath && navigationStore.openWorkspace(entity.repoPath, entity.repoLabel)}>{entity.repoLabel}</button></td><td><button className="repo-operations-entity-link" onClick={() => onDetail(entity)}>{entity.kind === 'worktree' ? entity.worktreePath || entity.branch : entity.branch}</button></td><td>{relativeTime(entity.activityAt)}</td><td>{entity.localState || '—'}</td><td>{entity.remoteState || '—'}</td><td><Badge tone={statusTone(entity.safety)}>{entity.safety.replace(/-/g, ' ')}</Badge></td><td>{entity.blockerCodes.length ? entity.blockerCodes.length : '—'}</td></tr>; })}{entities.length === 0 ? <tr><td colSpan={8} className="empty-cell">No branch or worktree entities match this filter.</td></tr> : null}</tbody></table></div>;
}

function PullRequestTable({ pullRequests }: { pullRequests: RepoOperationsPullRequest[] }) { return <div className="repo-operations-table-wrap"><table><thead><tr><th>Repository</th><th>Pull request</th><th>Branch</th><th>Review</th><th>Checks / merge</th></tr></thead><tbody>{pullRequests.map((pr) => <tr key={`${pr.repoId}-${pr.number}`}><td>{pr.repoLabel}</td><td><a className="repo-operations-link" href={pr.url} rel="noreferrer" target="_blank">#{pr.number} · {pr.title}</a></td><td>{pr.headRefName} <span className="repo-operations-secondary-cell">into {pr.baseRefName}</span></td><td>{pr.reviewDecision || 'Not requested'}</td><td>{pr.mergeStateStatus || 'Unknown'} · {pr.checksSummary ? `${pr.checksSummary.failed} failed / ${pr.checksSummary.pending} pending` : 'checks unavailable'}</td></tr>)}{pullRequests.length === 0 ? <tr><td colSpan={5} className="empty-cell">No open pull requests match this filter.</td></tr> : null}</tbody></table></div>; }

export default function RepoOperationsView() {
  const state = useStoreValue(repoOperationsStore);
  const [drawerRepoId, setDrawerRepoId] = useState<string | null>(null);
  const [drawerEntityKey, setDrawerEntityKey] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [prPickerRepo, setPrPickerRepo] = useState<RepoOperationsRepository | null>(null);
  useEffect(() => { void repoOperationsStore.loadOverview(); }, []);
  const overview = state.overview;
  const allRepositories = overview?.repositories || [];
  const allEntities = useMemo(() => allRepositories.flatMap(entitiesForRepository), [allRepositories]);
  const repositories = useMemo(() => allRepositories.filter((repo) => {
    const query = state.searchQuery.trim().toLowerCase();
    const searchable = `${repo.repoLabel} ${repo.repoPath} ${repo.sync.branch} ${repo.issues.map((issue) => issue.code).join(' ')} ${entitiesForRepository(repo).map((entity) => `${entity.branch} ${entity.worktreePath || ''} ${entity.blockerCodes.join(' ')}`).join(' ')} ${repo.pullRequests.map((pr) => `${pr.title} ${pr.headRefName}`).join(' ')}`.toLowerCase();
    if (!searchable.includes(query)) return false;
    if (state.filter === 'attention') return !repo.available || repo.issues.length > 0 || repo.sync.issueCodes.length > 0 || entitiesForRepository(repo).some((entity) => !['strict-safe', 'analyzed-safe'].includes(entity.safety));
    if (state.filter === 'sync-eligible') return repo.sync.syncEligible;
    if (state.filter === 'branches') return entitiesForRepository(repo).some((entity) => ['strict-safe', 'analyzed-safe', 'analysis-required'].includes(entity.safety));
    if (state.filter === 'pull-requests' || state.filter === 'pr-action') return repo.pullRequests.length > 0;
    return true;
  }), [allRepositories, state.filter, state.searchQuery]);
  const entities = useMemo(() => {
    const query = state.searchQuery.trim().toLowerCase();
    return repositories.flatMap((repository) => {
      const repositoryMatches = `${repository.repoLabel} ${repository.repoPath} ${repository.sync.branch} ${repository.issues.map((issue) => issue.code).join(' ')}`.toLowerCase().includes(query);
      return entitiesForRepository(repository).filter((entity) => {
        if (state.filter === 'branches' && !['strict-safe', 'analyzed-safe', 'analysis-required'].includes(entity.safety)) return false;
        return !query || repositoryMatches || `${entity.branch} ${entity.worktreePath || ''} ${entity.blockerCodes.join(' ')}`.toLowerCase().includes(query);
      });
    });
  }, [repositories, state.filter, state.searchQuery]);
  const pullRequests = useMemo(() => {
    const query = state.searchQuery.trim().toLowerCase();
    return repositories.flatMap((repository) => {
      const repositoryMatches = `${repository.repoLabel} ${repository.repoPath} ${repository.sync.branch}`.toLowerCase().includes(query);
      return repository.pullRequests
        .filter((pullRequest) => !query || repositoryMatches || `${pullRequest.title} ${pullRequest.headRefName} ${pullRequest.baseRefName}`.toLowerCase().includes(query))
        .map((pullRequest) => ({ ...pullRequest, repoId: repository.repoId, repoLabel: repository.repoLabel }));
    });
  }, [repositories, state.searchQuery]);
  const selectedEntities = allEntities.filter((entity) => state.selectedEntityKeys.includes(entityKey(entity)));
  const drawerRepo = allRepositories.find((repo) => String(repo.repoId) === drawerRepoId) || null;
  const drawerEntity = allEntities.find((entity) => entityKey(entity) === drawerEntityKey) || null;
  if (state.loading && !overview) return <div className="view-shell repo-operations-view" data-testid="repo-operations-loading"><PageContainer><div className="state-message"><AppIcon name="refresh" size={20} /><p>Scanning tracked repositories…</p></div></PageContainer></div>;
  if (state.error && !overview) return <div className="view-shell repo-operations-view" data-testid="repo-operations-error"><PageContainer><div className="state-message state-message-error"><AppIcon name="error" size={20} /><h1>Repo Operations scan failed</h1><p>{state.error}</p><Button onClick={() => void repoOperationsStore.loadOverview()} variant="secondary">Retry</Button></div></PageContainer></div>;
  if (!overview) return null;
  const executePending = () => { const repoIds = Array.from(new Set(selectedEntities.map((entity) => entity.repoId))); if (pendingAction === 'fetch') void repoOperationsStore.fetchRemotes(repoIds); if (pendingAction === 'sync') void repoOperationsStore.syncEligibleRepositories(repoIds); if (pendingAction === 'analyze') void repoOperationsStore.analyzeSelected(selectedEntities.map((entity) => ({ repoId: entity.repoId, entityId: entity.id }))); if (pendingAction === 'strict-cleanup') void repoOperationsStore.cleanupSelectedEntities('strict', selectedEntities.map((entity) => ({ repoId: entity.repoId, entityId: entity.id, observedSha: entity.observedSha }))); if (pendingAction === 'analyzed-cleanup') void repoOperationsStore.cleanupSelectedEntities('analyzed', selectedEntities.map((entity) => ({ repoId: entity.repoId, entityId: entity.id, observedSha: entity.observedSha }))); setPendingAction(null); };
  return <div className="view-shell repo-operations-view" data-testid="repo-operations-view"><div className="view-scroll"><PageContainer><header className="repo-operations-command-header" data-testid="repo-operations-toolbar"><div><h1>Repo Operations</h1><p>Safe by default. We analyze before we act.</p></div><div><span>Last scan: {relativeTime(overview.generatedAt)}</span><Button loading={state.loading} onClick={() => void repoOperationsStore.loadOverview()} size="sm" testId="repo-operations-refresh" variant="secondary">Refresh all</Button><Button onClick={() => setPendingAction('fetch')} size="sm" variant="primary">Fetch all remotes</Button></div></header>
    <div className="repo-operations-controls" data-testid="repo-operations-sync-panel"><input aria-label="Filter repositories and operations" onChange={(event) => repoOperationsStore.setSearchQuery(event.target.value)} placeholder="Search repositories, branches, issues, or PRs" role="searchbox" type="search" value={state.searchQuery} /><select aria-label="Filter operation type" onChange={(event) => repoOperationsStore.setFilter(event.target.value as typeof state.filter)} value={state.filter}><option value="all">All operations</option><option value="attention">Needs attention</option><option value="sync-eligible">Sync eligible</option><option value="branches">Cleanup candidates</option><option value="pull-requests">Pull requests</option></select><span>Sort: Recent activity</span></div>
    <section aria-label="Repo Operations summary" className="repo-operations-summary-grid">{[['Up to date', overview.summary.trackedRepos - overview.summary.reposNeedingAttention], ['Needs attention', overview.summary.reposNeedingAttention], ['Cleanup candidates', overview.summary.cleanupCandidates || 0], ['Needs analysis', overview.summary.needsAnalysis || 0]].map(([label, value]) => <div className="repo-operations-summary-card" key={String(label)}><span>{label}</span><strong>{value}</strong></div>)}</section>
    {overview.warnings.length ? <div className="repo-operations-warning repo-operations-warning-scroll" role="status">{overview.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}{state.actionError ? <div className="repo-operations-warning" role="alert"><p>{state.actionError}</p></div> : null}{state.actionResult ? <ActionResultPanel result={state.actionResult} /> : null}
    <nav aria-label="Repo Operations views" className="repo-operations-tabs" data-testid="repo-operations-planned-actions">{([['repositories', 'Repositories'], ['entities', 'Branches & worktrees'], ['pull-requests', 'Pull requests'], ['agent-runs', 'Agent runs']] as const).map(([tab, label]) => <button className={state.activeTab === tab ? 'active' : ''} key={tab} onClick={() => repoOperationsStore.setActiveTab(tab)}>{label}</button>)}</nav>
    <section className="repo-operations-content"><div className="repo-operations-main">{state.activeTab === 'repositories' ? <RepositoryTable onDetail={(repo) => { setDrawerRepoId(String(repo.repoId)); setDrawerEntityKey(null); }} onPrepare={setPrPickerRepo} repositories={repositories} /> : null}{state.activeTab === 'entities' ? <EntityTable entities={entities} onDetail={(entity) => { setDrawerEntityKey(entityKey(entity)); setDrawerRepoId(entity.repoId); }} onSelect={(entity) => repoOperationsStore.toggleEntitySelection(entityKey(entity))} onSelectAll={(selected) => { const visibleKeys = new Set(entities.map(entityKey)); const retained = state.selectedEntityKeys.filter((key) => !visibleKeys.has(key)); repoOperationsStore.setEntitySelection(selected ? [...retained, ...visibleKeys] : retained); }} selectedKeys={state.selectedEntityKeys} /> : null}{state.activeTab === 'pull-requests' ? <PullRequestTable pullRequests={pullRequests} /> : null}{state.activeTab === 'agent-runs' ? <div className="repo-operations-run-list">{Object.values(state.agentRuns).map((run) => <article className="repo-operations-run-card" key={run.id}><strong>{run.repoLabel} · PR #{run.prNumber}</strong><Badge tone={run.status.includes('awaiting') ? 'accent' : run.status === 'completed' ? 'success' : 'danger'}>{run.status}</Badge><div><Button onClick={() => void repoOperationsStore.refreshAgentRun(run.id)} size="sm" variant="ghost">Refresh run</Button>{run.status.startsWith('awaiting') ? <Button onClick={() => void repoOperationsStore.approveAgentRun(run.id)} size="sm" variant="primary">Approve next step</Button> : null}</div></article>)}{Object.keys(state.agentRuns).length === 0 ? <p className="repo-operations-muted">No agent runs yet.</p> : null}</div> : null}</div><DetailDrawer entity={drawerEntity} onAnalyze={() => { if (!drawerEntity) return; const key = entityKey(drawerEntity); if (!state.selectedEntityKeys.includes(key)) repoOperationsStore.setEntitySelection([...state.selectedEntityKeys, key]); setPendingAction('analyze'); }} onClose={() => { setDrawerRepoId(null); setDrawerEntityKey(null); }} repo={drawerRepo} /></section>
    {selectedEntities.length ? <div className="repo-operations-batch-bar"><strong>{selectedEntities.length} selected</strong><Button onClick={() => setPendingAction('analyze')} size="sm" variant="secondary">Analyze selected</Button><Button onClick={() => setPendingAction('sync')} size="sm" variant="secondary">Fast-forward eligible</Button><Button onClick={() => setPendingAction('strict-cleanup')} size="sm" variant="secondary">Clean safe</Button><Button onClick={() => setPendingAction('analyzed-cleanup')} size="sm" variant="ghost">Delete analyzed</Button><Button onClick={() => repoOperationsStore.clearEntitySelection()} size="sm" variant="ghost">Clear</Button></div> : null}
  </PageContainer></div>{pendingAction ? <ConfirmationDialog action={pendingAction} count={pendingAction === 'fetch' ? selectedEntities.length || repositories.length : selectedEntities.length} onCancel={() => setPendingAction(null)} onConfirm={executePending} /> : null}{prPickerRepo ? <div className="repo-operations-dialog-backdrop" role="presentation"><div aria-label={`Choose a pull request for ${prPickerRepo.repoLabel}`} aria-modal="true" className="repo-operations-dialog" role="dialog"><div className="repo-operations-dialog-header"><h2>Choose a pull request</h2><Button onClick={() => setPrPickerRepo(null)} size="sm" variant="ghost">Close</Button></div>{prPickerRepo.pullRequests.map((pr) => { const canPrepare = Boolean(prPickerRepo.repoId && pr.number && pr.baseRefName && pr.headSha && pr.baseSha); const start = (kind: 'pr-analysis' | 'merge-repair') => { setPrPickerRepo(null); if (canPrepare) void repoOperationsStore.prepareAgentRun({ repoId: prPickerRepo.repoId!, prNumber: pr.number!, targetBranch: pr.baseRefName!, observedHeadSha: pr.headSha!, observedBaseSha: pr.baseSha!, kind, allowedOperationScope: { inspect: true, checks: true, dryRun: true, merge: false } }); }; return <div className="repo-operations-pr-picker-row" key={pr.number}><span>#{pr.number} · {pr.title}</span><div className="repo-operations-row-menu"><Button aria-label={`#${pr.number} · ${pr.title} — Prepare`} disabled={!canPrepare} onClick={() => start('pr-analysis')} size="sm" variant="secondary">Prepare</Button><Button aria-label={`#${pr.number} · ${pr.title} — Repair in isolated worktree`} disabled={!canPrepare} onClick={() => start('merge-repair')} size="sm" variant="ghost">Repair merge</Button></div></div>; })}</div></div> : null}</div>;
}
