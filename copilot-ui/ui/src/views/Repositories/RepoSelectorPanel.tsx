import { useMemo } from 'react';
import { Button, Panel, StatusBadge } from '../../components';
import { useStoreValue } from '../../lib/store';
import { repositoriesStore } from './repositoriesStore';
import { navigationStore } from '../../stores/navigation';

export default function RepoSelectorPanel() {
  const state = useStoreValue(repositoriesStore);
  const query = state.searchQuery.trim().toLowerCase();

  const filtered = useMemo(() => {
    let list = state.repos;
    if (query) {
      list = list.filter(
        (r) =>
          (r.repoLabel || '').toLowerCase().includes(query) ||
          (r.repoPath || '').toLowerCase().includes(query)
      );
    }
    return list;
  }, [state.repos, query]);

  function handleSelect(repo: typeof state.repos[number]) {
    const repoPath = (repo.repoPath || '').trim();
    const repoId = (repo.repoId || '').trim();
    if (repoPath || repoId) {
      void repositoriesStore.selectRepo(repoPath, repoId);
    }
    // Open a workspace tab so the repo appears in the sidebar and survives navigation
    if (repoPath) {
      navigationStore.openWorkspace(repoPath, repo.repoLabel || repoPath);
    }
  }

  return (
    <Panel
      title="Repositories"
      subtitle={`${state.repos.length} known`}
      testId="repos-selector"
      actions={
        <Button
          variant="ghost"
          size="sm"
          testId="repos-refresh"
          disabled={state.loading}
          onClick={() => void repositoriesStore.loadInventory()}
        >
          {state.loading ? 'Loading\u2026' : 'Refresh'}
        </Button>
      }
    >
      <input
        className="form-input-field"
        type="text"
        placeholder="Search repositories\u2026"
        value={state.searchQuery}
        onChange={(e) => repositoriesStore.setSearchQuery(e.target.value)}
      />

      {state.error ? (
        <p className="state-message state-error" role="alert">
          {state.error}
        </p>
      ) : null}

      {state.loading && state.repos.length === 0 ? (
        <p className="state-message">Loading known repos\u2026</p>
      ) : null}

      {!state.loading && state.repos.length === 0 ? (
        <p className="state-message">
          No repositories found. Add scan roots above or register a repo from the Projects tab.
        </p>
      ) : null}

      {filtered.length === 0 && state.repos.length > 0 ? (
        <p className="state-message">No repositories match your search.</p>
      ) : null}

      <ul className="repos-selector-list">
        {filtered.map((repo) => {
          const isSelected = Boolean(
            (state.selectedRepo?.repoPath && repo.repoPath
              && state.selectedRepo.repoPath.replace(/\\/g, '/').toLowerCase()
                === repo.repoPath.replace(/\\/g, '/').toLowerCase())
            || (state.selectedRepo?.repoId && repo.repoId
              && state.selectedRepo.repoId === repo.repoId)
          );
          return (
            <li
              key={repo.repoId || repo.repoPath || ''}
              className={`repos-selector-item${isSelected ? ' is-selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => handleSelect(repo)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSelect(repo);
                }
              }}
            >
              <div className="repos-selector-item-header">
                <span className="repos-selector-item-label">
                  {repo.repoLabel || repo.repoPath || 'Unknown'}
                </span>
                <div className="catalog-badge-row">
                  <StatusBadge status={repo.scanStatus || 'unknown'} />
                  {repo.registered ? <StatusBadge status="registered" /> : null}
                  {repo.selected ? <StatusBadge status="selected" /> : null}
                </div>
              </div>
              {repo.repoPath ? (
                <p className="repos-selector-item-path">{repo.repoPath}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
