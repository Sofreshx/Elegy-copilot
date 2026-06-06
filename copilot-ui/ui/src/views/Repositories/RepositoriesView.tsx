import { useEffect, useState, useMemo } from 'react';
import { Button, Panel, StatusBadge, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { notificationStore } from '../../stores/notificationStore';
import { navigationStore } from '../../stores/navigation';
import { repositoriesStore } from './repositoriesStore';
import SourcesConfigPanel from './SourcesConfigPanel';

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

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

  function handleOpen(repo: typeof state.repos[number]) {
    const repoPath = (repo.repoPath || '').trim();
    const repoLabel = repo.repoLabel || repoPath;
    if (repoPath) {
      navigationStore.openWorkspace(repoPath, repoLabel);
    }
  }

  async function handleRegister() {
    const repoPath = registerPath.trim();
    if (!repoPath) return;
    setRegistering(true);
    try {
      await repositoriesStore.registerRepo(repoPath, registerLabel.trim() || undefined);
      setRegisterPath('');
      setRegisterLabel('');
      notificationStore.success('Repository registered', { message: repoPath });
    } catch (err) {
      notificationStore.error('Registration failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setRegistering(false);
    }
  }

  const navState = useStoreValue(navigationStore);
  const openWorkspacePaths = useMemo(() => {
    return new Set(navState.openWorkspaces.map((w) => normalizePath(w.repoPath)));
  }, [navState.openWorkspaces]);

  return (
    <div className="repos-view" data-testid="repositories-view">
      <Toolbar testId="repos-toolbar">
        <h2>Repositories</h2>
        <span className="state-copy">
          {state.repos.length} known repo{state.repos.length !== 1 ? 's' : ''}
        </span>
      </Toolbar>

      <div className="repos-launcher-layout" data-testid="repos-launcher-layout">
        {/* Search */}
        <input
          className="form-input-field"
          type="text"
          placeholder="Search repositories\u2026"
          value={state.searchQuery}
          onChange={(e) => repositoriesStore.setSearchQuery(e.target.value)}
          data-testid="repos-search-input"
        />

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

        {/* Empty */}
        {!state.loading && state.repos.length === 0 ? (
          <p className="state-message">
            No repositories found. Add scan roots or register a repository below.
          </p>
        ) : null}

        {/* No results */}
        {filtered.length === 0 && state.repos.length > 0 ? (
          <p className="state-message">No repositories match your search.</p>
        ) : null}

        {/* Repo list */}
        <ul className="repos-selector-list" data-testid="repos-launcher-list">
          {filtered.map((repo) => {
            const repoPath = (repo.repoPath || '').trim();
            const isOpen = openWorkspacePaths.has(normalizePath(repoPath));
            return (
              <li
                key={repo.repoId || repo.repoPath || ''}
                className={`repos-selector-item${isOpen ? ' is-selected' : ''}`}
                data-testid={`repos-launcher-item-${repoPath}`}
              >
                <div className="repos-selector-item-header">
                  <span className="repos-selector-item-label">
                    {repo.repoLabel || repo.repoPath || 'Unknown'}
                  </span>
                  <div className="catalog-badge-row">
                    <StatusBadge status={repo.scanStatus || 'unknown'} />
                    {repo.registered ? <StatusBadge status="registered" /> : null}
                    {isOpen ? <StatusBadge status="open" /> : null}
                  </div>
                </div>
                {repo.repoPath ? (
                  <p className="repos-selector-item-path">{repo.repoPath}</p>
                ) : null}
                {repoPath ? (
                  <div className="repos-launcher-actions">
                    <Button
                      variant="primary"
                      size="sm"
                      testId={`repos-open-${repoPath}`}
                      onClick={() => handleOpen(repo)}
                    >
                      {isOpen ? 'Focus' : 'Open'}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        {/* Refresh */}
        <div className="repos-launcher-controls">
          <Button
            variant="ghost"
            size="sm"
            testId="repos-refresh"
            disabled={state.loading}
            onClick={() => void repositoriesStore.loadInventory()}
          >
            {state.loading ? 'Loading\u2026' : 'Refresh inventory'}
          </Button>
        </div>

        {/* Register section */}
        <Panel
          title="Register Repository"
          subtitle="Add a repository not discovered by scan"
          testId="repos-register-panel"
        >
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
          <div className="catalog-action-row">
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
        </Panel>

        {/* Scan roots config */}
        <SourcesConfigPanel />
      </div>
    </div>
  );
}
