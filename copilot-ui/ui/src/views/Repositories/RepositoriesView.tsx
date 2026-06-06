import { useEffect, useState } from 'react';
import { Button } from '../../components';
import { useStoreValue } from '../../lib/store';
import { navigationStore } from '../../stores/navigation';
import { repositoriesStore } from './repositoriesStore';
import SourcesConfigPanel from './SourcesConfigPanel';

export default function RepositoriesView() {
  const state = useStoreValue(repositoriesStore);
  const [manualPath, setManualPath] = useState('');

  useEffect(() => {
    void repositoriesStore.loadInventory();
    return () => {
      repositoriesStore.reset();
    };
  }, []);

  const filteredRepos = state.repos.filter((repo) => {
    if (!state.searchQuery) return true;
    const q = state.searchQuery.toLowerCase();
    return (
      (repo.repoLabel && repo.repoLabel.toLowerCase().includes(q)) ||
      repo.repoPath.toLowerCase().includes(q)
    );
  });

  function handleOpen(repoPath: string, repoLabel: string) {
    navigationStore.openWorkspace(repoPath, repoLabel || repoPath);
  }

  function handleFocus(repoPath: string, repoLabel: string, repoId?: string | null) {
    void repositoriesStore.selectRepo(repoPath, repoId || null);
    navigationStore.openWorkspace(repoPath, repoLabel || repoPath);
  }

  async function handleRegister() {
    if (!manualPath.trim()) return;
    await repositoriesStore.selectRepo(manualPath.trim());
    await repositoriesStore.loadInventory();
    setManualPath('');
  }

  return (
    <div className="repos-view" data-testid="repositories-view">
      <div className="repos-header">
        <h2>Repositories</h2>
        {state.repos.length > 0 && (
          <span className="repos-count-badge" data-testid="repos-count-badge">
            {state.repos.length}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          testId="repos-refresh"
          onClick={() => void repositoriesStore.loadInventory()}
          disabled={state.loading}
        >
          {state.loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <div className="repos-search">
        <input
          className="repos-search-input"
          type="text"
          placeholder="Search repositories…"
          value={state.searchQuery}
          onChange={(e) => repositoriesStore.setSearchQuery(e.target.value)}
          data-testid="repos-search-input"
        />
      </div>

      {state.loading && state.repos.length === 0 ? (
        <div className="repos-loading" data-testid="repos-loading">
          Loading repositories…
        </div>
      ) : state.repos.length === 0 ? (
        <div className="repos-empty" data-testid="repos-empty">
          No repositories found. Configure source folders below.
        </div>
      ) : filteredRepos.length === 0 ? (
        <div className="repos-empty" data-testid="repos-search-empty">
          No repositories match your search.
        </div>
      ) : (
        <div className="repos-list" data-testid="repos-list">
          {filteredRepos.map((repo) => (
            <div
              key={repo.repoPath}
              className="repos-list-item"
              data-testid="repos-list-item"
            >
              <span className="repos-list-item-label" title={repo.repoLabel || repo.repoPath}>
                {repo.repoLabel || repo.repoPath}
              </span>
              <span className="repos-list-item-path" title={repo.repoPath}>
                {repo.repoPath}
              </span>
              <div className="repos-list-item-badges">
                {repo.scanStatus && (
                  <span className="repos-badge">{repo.scanStatus}</span>
                )}
                {repo.registered && (
                  <span className="repos-badge repos-badge-registered">registered</span>
                )}
                {state.selectedRepo?.repoPath === repo.repoPath && (
                  <span className="repos-badge repos-badge-selected">selected</span>
                )}
              </div>
              <div className="repos-list-item-actions">
                <button
                  onClick={() => handleOpen(repo.repoPath, repo.repoLabel || repo.repoPath)}
                  data-testid="repos-open-btn"
                >
                  Open
                </button>
                <button
                  onClick={() => handleFocus(repo.repoPath, repo.repoLabel || repo.repoPath, repo.repoId)}
                  data-testid="repos-focus-btn"
                >
                  Focus
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SourcesConfigPanel />

      <div className="repos-manual-register" data-testid="repos-manual-register">
        <h3>Register Repository</h3>
        <input
          type="text"
          placeholder="Path to repository (e.g., C:\Users\you\Documents\GitHub\my-repo)"
          value={manualPath}
          onChange={(e) => setManualPath(e.target.value)}
          data-testid="repos-manual-path"
        />
        <Button
          variant="secondary"
          size="sm"
          testId="repos-manual-register-btn"
          onClick={handleRegister}
          disabled={!manualPath.trim() || state.loading}
        >
          Register
        </Button>
      </div>
    </div>
  );
}
