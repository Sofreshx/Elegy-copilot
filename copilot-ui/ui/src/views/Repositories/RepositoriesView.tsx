import { useEffect, useMemo, useState } from 'react';
import { Button, PageContainer, Toolbar } from '../../components';
import type { CatalogRepoInventoryEntry } from '../../lib/types';
import { useStoreValue } from '../../lib/store';
import { navigationStore } from '../../stores/navigation';
import { repositoriesStore } from './repositoriesStore';
import SourcesConfigPanel from './SourcesConfigPanel';

type RepositoryDialog = 'add' | 'discovery' | null;

function pathKey(value: string | null | undefined): string {
  return String(value || '').replace(/\\/g, '/').toLowerCase();
}

function repoTime(repo: CatalogRepoInventoryEntry, openTimes: Map<string, number>): number {
  return openTimes.get(pathKey(repo.repoPath)) || Number(repo.lastActivityMs) || 0;
}

function sortRepos(repos: CatalogRepoInventoryEntry[], openTimes: Map<string, number>) {
  return [...repos].sort((left, right) => {
    const activityDelta = repoTime(right, openTimes) - repoTime(left, openTimes);
    if (activityDelta) return activityDelta;
    return String(left.repoLabel || left.repoPath).localeCompare(String(right.repoLabel || right.repoPath));
  });
}

export default function RepositoriesView() {
  const state = useStoreValue(repositoriesStore);
  const navState = useStoreValue(navigationStore);
  const [dialog, setDialog] = useState<RepositoryDialog>(null);
  const [registerPath, setRegisterPath] = useState('');
  const [registerLabel, setRegisterLabel] = useState('');
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    void repositoriesStore.loadInventory();
    return () => repositoriesStore.reset();
  }, []);

  useEffect(() => {
    if (!state.workspaceScan || state.loading) return;
    navigationStore.reconcileOpenWorkspaces(
      state.repos.map((repo) => String(repo.repoPath || '')).filter(Boolean),
    );
  }, [state.workspaceScan, state.loading, state.repos]);

  const openTimes = useMemo(
    () => new Map(navState.openWorkspaces.map((workspace) => [pathKey(workspace.repoPath), workspace.openedAt])),
    [navState.openWorkspaces],
  );
  const openWorkspacePaths = useMemo(
    () => new Set(navState.openWorkspaces.map((workspace) => pathKey(workspace.repoPath))),
    [navState.openWorkspaces],
  );
  const query = state.searchQuery.trim().toLowerCase();
  const filtered = useMemo(() => state.repos.filter((repo) => {
    if (!query) return true;
    return [repo.repoLabel, repo.repoPath, repo.repoId, repo.canonicalRemote]
      .some((value) => String(value || '').toLowerCase().includes(query));
  }), [state.repos, query]);
  const groups = useMemo(() => {
    const pinned = sortRepos(filtered.filter((repo) => Boolean(repo.pinned)), openTimes);
    const recent = sortRepos(
      filtered.filter((repo) => !repo.pinned && openTimes.has(pathKey(repo.repoPath))),
      openTimes,
    );
    const recentPaths = new Set(recent.map((repo) => pathKey(repo.repoPath)));
    const all = [...filtered]
      .filter((repo) => !repo.pinned && !recentPaths.has(pathKey(repo.repoPath)))
      .sort((left, right) => String(left.repoLabel || left.repoPath).localeCompare(String(right.repoLabel || right.repoPath)));
    return [
      { id: 'pinned', title: 'Pinned', repos: pinned },
      { id: 'recent', title: 'Recent', repos: recent },
      { id: 'all', title: 'All repositories', repos: all },
    ].filter((group) => group.id === 'all' || group.repos.length > 0);
  }, [filtered, openTimes]);

  function openRepository(repo: CatalogRepoInventoryEntry) {
    const repoPath = String(repo.repoPath || '').trim();
    if (!repoPath) return;
    void repositoriesStore.selectRepo(repoPath, repo.repoId || null);
    navigationStore.openWorkspace(repoPath, String(repo.repoLabel || repoPath));
  }

  async function registerRepository() {
    if (!registerPath.trim()) return;
    setRegistering(true);
    try {
      await repositoriesStore.registerRepo(registerPath.trim(), registerLabel.trim() || undefined);
      setRegisterPath('');
      setRegisterLabel('');
      setDialog(null);
    } finally {
      setRegistering(false);
    }
  }

  function renderRepository(repo: CatalogRepoInventoryEntry, index: number) {
    const repoPath = String(repo.repoPath || '').trim();
    const isOpen = openWorkspacePaths.has(pathKey(repoPath));
    const stableKey = repo.repoId || repoPath || `repo-${index}`;
    return (
      <li className={`repos-launcher-row${isOpen ? ' is-selected' : ''}`} key={stableKey}>
        <button className="repos-launcher-row-main" disabled={!repoPath} onClick={() => openRepository(repo)} type="button">
          <span className="repos-launcher-row-label">{repo.repoLabel || repoPath || 'Unknown repository'}</span>
          <span className="repos-launcher-row-meta">
            {repo.canonicalRemote ? <span>{String(repo.canonicalRemote)}</span> : <span>No remote</span>}
            {repoPath ? <span className="repos-launcher-row-path" title={repoPath}>{repoPath}</span> : null}
          </span>
        </button>
        <Button variant={isOpen ? 'secondary' : 'ghost'} size="sm" onClick={() => openRepository(repo)}>
          {isOpen ? 'Focus' : 'Open'}
        </Button>
      </li>
    );
  }

  return (
    <div className="view-shell repos-view" data-testid="repositories-view">
      <div className="view-static repos-view-header">
        <Toolbar testId="repos-toolbar">
          <div>
            <h2>Repositories</h2>
            <p className="state-copy">Canonical Git repositories managed by Elegy Copilot</p>
          </div>
          <div className="repos-toolbar-actions">
            <span className="state-copy">{filtered.length} repositor{filtered.length === 1 ? 'y' : 'ies'}</span>
            <Button testId="repos-refresh" variant="ghost" size="sm" disabled={state.loading} onClick={() => void repositoriesStore.loadInventory()}>
              {state.loading ? 'Refreshing…' : 'Refresh'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDialog('discovery')}>Discovery settings</Button>
            <Button variant="primary" size="sm" onClick={() => setDialog('add')}>Add repository</Button>
          </div>
        </Toolbar>
        <input
          aria-label="Search repositories"
          className="form-input-field repos-search-input"
          type="search"
          placeholder="Search by name, path, or remote…"
          value={state.searchQuery}
          onChange={(event) => repositoriesStore.setSearchQuery(event.target.value)}
          data-testid="repos-search-input"
        />
      </div>

      <div className="view-scroll">
        <PageContainer>
          {state.error ? <p className="state-message state-error" role="alert">{state.error}</p> : null}
          {state.loading && state.repos.length === 0 ? <p className="state-message">Loading repositories…</p> : null}
          {!state.loading && state.repos.length === 0 ? (
            <div className="repos-empty-msg" data-testid="repos-empty">
              <h3>No repositories found</h3>
              <p>Add a Git repository or configure another discovery folder.</p>
              <Button variant="primary" size="sm" onClick={() => setDialog('add')}>Add repository</Button>
            </div>
          ) : null}
          {!state.loading && filtered.length === 0 && state.repos.length > 0 ? (
            <p className="state-message repos-empty-msg" data-testid="repos-no-results">No repositories match “{state.searchQuery}”.</p>
          ) : null}
          {filtered.length > 0 ? (
            <div className="repos-group-list" data-testid="repos-launcher-layout">
              {groups.map((group) => (
                <section className="repos-group" key={group.id}>
                  <div className="repos-group-heading">
                    <h3>{group.title}</h3>
                    <span>{group.repos.length}</span>
                  </div>
                  {group.repos.length > 0 ? <ul className="repos-launcher-list">{group.repos.map(renderRepository)}</ul> : (
                    <p className="repos-group-empty">Repositories you have not pinned or opened recently appear here.</p>
                  )}
                </section>
              ))}
            </div>
          ) : null}
        </PageContainer>
      </div>

      {dialog ? (
        <div className="resource-dialog-backdrop" onMouseDown={() => setDialog(null)}>
          <section
            aria-labelledby={`repos-${dialog}-dialog-title`}
            className="resource-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="resource-dialog-header">
              <div>
                <h2 id={`repos-${dialog}-dialog-title`}>{dialog === 'add' ? 'Add repository' : 'Discovery settings'}</h2>
                <p>{dialog === 'add' ? 'Register an existing canonical Git checkout.' : 'Choose folders Elegy scans for repositories.'}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setDialog(null)}>Cancel</Button>
            </div>
            {dialog === 'add' ? (
              <div className="resource-dialog-body" data-testid="repos-register-dialog">
                <label className="form-label" htmlFor="repos-register-path">Repository path</label>
                <input id="repos-register-path" className="form-input-field" autoFocus value={registerPath} onChange={(event) => setRegisterPath(event.target.value)} placeholder="C:\Users\you\Documents\GitHub\my-project" />
                <label className="form-label" htmlFor="repos-register-label">Display label (optional)</label>
                <input id="repos-register-label" className="form-input-field" value={registerLabel} onChange={(event) => setRegisterLabel(event.target.value)} placeholder="My project" />
                <p className="state-copy">Linked worktrees are managed from the canonical repository’s Git view.</p>
                <div className="resource-dialog-actions">
                  <Button variant="primary" size="sm" disabled={registering || !registerPath.trim()} onClick={() => void registerRepository()}>
                    {registering ? 'Validating…' : 'Add repository'}
                  </Button>
                </div>
              </div>
            ) : <div className="resource-dialog-body"><SourcesConfigPanel /></div>}
          </section>
        </div>
      ) : null}
    </div>
  );
}
