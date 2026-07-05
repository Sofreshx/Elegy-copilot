import { useEffect, useState, useMemo } from 'react';
import { Button, IconButton, PageContainer, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { navigationStore } from '../../stores/navigation';
import { repositoriesStore } from './repositoriesStore';
import SourcesConfigPanel from './SourcesConfigPanel';

export default function RepositoriesView() {
  const state = useStoreValue(repositoriesStore);
  const [registerPath, setRegisterPath] = useState('');
  const [registerLabel, setRegisterLabel] = useState('');
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    void repositoriesStore.loadInventory();
    return () => {
      repositoriesStore.reset();
    };
  }, []);

  const query = state.searchQuery?.toLowerCase() || '';
  const filtered = useMemo(() => {
    let list = state.repos;
    if (query) {
      list = list.filter(
        (r) =>
          (r.repoLabel || '').toLowerCase().includes(query) ||
          (r.repoPath || '').toLowerCase().includes(query) ||
          (r.repoId || '').toLowerCase().includes(query) ||
          (r.scanStatus || '').toLowerCase().includes(query)
      );
    }
    return list;
  }, [state.repos, query]);

  function handleOpen(repoPath: string, repoLabel: string) {
    navigationStore.openWorkspace(repoPath, repoLabel || repoPath);
  }

  function handleFocus(repoPath: string, repoLabel: string, repoId?: string | null) {
    void repositoriesStore.selectRepo(repoPath, repoId || null);
    navigationStore.openWorkspace(repoPath, repoLabel || repoPath);
  }

  async function handleRegister() {
    if (!registerPath.trim()) return;
    setRegistering(true);
    try {
      await repositoriesStore.selectRepo(registerPath.trim());
      await repositoriesStore.loadInventory();
      setRegisterPath('');
      setRegisterLabel('');
    } finally {
      setRegistering(false);
    }
  }

  const navState = useStoreValue(navigationStore);
  const openWorkspacePaths = useMemo(() => {
    return new Set(navState.openWorkspaces.map((w) => w.repoPath));
  }, [navState.openWorkspaces]);
  const localRepoReaderRoots = useMemo(() => {
    return new Set(
      (state.localRepoReaderAccess?.repos || [])
        .filter((repo) => repo.enabled)
        .map((repo) => String(repo.root || '').replace(/\//g, '\\').toLowerCase())
    );
  }, [state.localRepoReaderAccess?.repos]);

  const repoCount = filtered.length;

  return (
    <div className="view-shell repos-view" data-testid="repositories-view">
      <div className="view-static">
      {/* Header toolbar */}
      <Toolbar testId="repos-toolbar">
        <h2>Repositories</h2>
        <span className="state-copy">
          {repoCount} repositor{repoCount !== 1 ? 'ies' : 'y'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          testId="repos-refresh"
          disabled={state.loading}
          onClick={() => void repositoriesStore.loadInventory()}
        >
          {state.loading ? 'Loading\u2026' : 'Refresh'}
        </Button>
      </Toolbar>

      {/* Search */}
      <input
        className="form-input-field"
        type="text"
        placeholder="Search repositories\u2026"
        value={state.searchQuery}
        onChange={(e) => repositoriesStore.setSearchQuery(e.target.value)}
        data-testid="repos-search-input"
      />
      </div>

      <div className="view-scroll">
        <PageContainer>
      {/* Error */}
      {state.error ? (
        <p className="state-message state-error" role="alert" data-testid="repos-error">
          {state.error}
        </p>
      ) : null}

      {/* Loading */}
      {state.loading && state.repos.length === 0 ? (
        <p className="state-message">Loading known repos\u2026</p>
      ) : null}

      {/* Empty: no repos at all */}
      {!state.loading && state.repos.length === 0 ? (
        <p className="state-message repos-empty-msg" data-testid="repos-empty">
          No repositories found. Configure source folders below.
        </p>
      ) : null}

      {/* No search results */}
      {!state.loading && filtered.length === 0 && state.repos.length > 0 ? (
        <p className="state-message repos-empty-msg" data-testid="repos-no-results">
          No repositories match your search.
        </p>
      ) : null}

      {/* Dense repo list */}
      {filtered.length > 0 ? (
        <div className="repos-launcher-layout" data-testid="repos-launcher-layout">
          <ul className="repos-launcher-list" data-testid="repos-launcher-list">
            {filtered.map((repo, idx) => {
              const repoPath = (repo.repoPath || '').trim();
              const isOpen = openWorkspacePaths.has(repoPath);
              const readerEnabled = repoPath
                ? localRepoReaderRoots.has(repoPath.replace(/\//g, '\\').toLowerCase())
                : false;
              const stableKey = repo.repoId || repo.repoPath || `repo-${idx}`;
              return (
                <li
                  key={stableKey}
                  className={`repos-launcher-row${isOpen ? ' is-selected' : ''}`}
                  data-testid={`repos-launcher-item-${repoPath || repo.repoId || 'unknown'}`}
                >
                  <div className="repos-launcher-row-info">
                    <span className="repos-launcher-row-label" title={repo.repoLabel || repo.repoPath || 'Unknown'}>
                      {repo.repoLabel || repo.repoPath || 'Unknown'}
                    </span>
                    {repo.repoPath ? (
                      <span className="repos-launcher-row-path" title={repo.repoPath}>
                        {repo.repoPath}
                      </span>
                    ) : null}
                  </div>
                  {repoPath ? (
                    <div className="repos-launcher-row-actions">
                      <button
                        className={`button button-sm ${readerEnabled ? 'button-primary' : ''}`}
                        disabled={state.localRepoReaderMutating}
                        onClick={() => void repositoriesStore.setLocalRepoReaderEnabled(repo, !readerEnabled)}
                        data-testid={`repos-local-reader-${repoPath}`}
                      >
                        {readerEnabled ? 'Reader On' : 'Reader Off'}
                      </button>
                      <IconButton
                        icon="external-link"
                        size={18}
                        label={isOpen ? 'Focus' : 'Open'}
                        onClick={() => handleOpen(repoPath, repo.repoLabel || repoPath)}
                        testId={`repos-open-${repoPath}`}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* Visual separator before sources config */}
      <hr className="repos-section-divider" />

      {/* Register section */}
      <div className="repos-register-section" data-testid="repos-register-panel">
        <h3 className="repos-section-title">Register Repository</h3>
        <p className="repos-section-subtitle">Add a repository not discovered by scan</p>
        <label className="form-label" htmlFor="repos-register-path">
          Repository path
        </label>
        <input
          id="repos-register-path"
          className="form-input-field"
          type="text"
          placeholder="C:\Users\you\Documents\GitHub\my-project"
          value={registerPath}
          onChange={(e) => setRegisterPath(e.target.value)}
          data-testid="repos-register-path-input"
        />
        <label className="form-label" htmlFor="repos-register-label">
          Display label (optional)
        </label>
        <input
          id="repos-register-label"
          className="form-input-field"
          type="text"
          placeholder="My Project"
          value={registerLabel}
          onChange={(e) => setRegisterLabel(e.target.value)}
          data-testid="repos-register-label-input"
        />
        <Button
          variant="secondary"
          size="sm"
          testId="repos-register-btn"
          disabled={registering || !registerPath.trim()}
          onClick={handleRegister}
        >
          {registering ? 'Registering\u2026' : 'Register'}
        </Button>
      </div>

      {/* Scan roots config */}
      <SourcesConfigPanel />
        </PageContainer>
      </div>
    </div>
  );
}
