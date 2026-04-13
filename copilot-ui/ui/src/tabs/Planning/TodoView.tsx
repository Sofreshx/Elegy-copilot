import { useEffect, useState } from 'react';
import { navigationStore } from '../../stores/navigation';
import { sessionWizardStore } from '../../views/Sessions/sessionWizardStore';

/* ── Types ── */

interface CatalogRepo {
  repoId: string;
  repoPath: string;
  repoLabel: string;
}

interface BulletArtifact {
  id: string;
  title: string;
  state: string;          // 'idea' | 'research' | 'pre-plan'
  repoId: string;
  summary: string;
  notes: string[];
}

type FilterMode = 'all' | 'active' | 'done';

/* ── Helpers ── */

/** The backend supports idea / research / pre-plan.  We treat "pre-plan" as "done". */
function isDone(state: string): boolean {
  return state === 'pre-plan';
}

/* ── Component ── */

export default function TodoView() {
  /* ── Repo list state ── */
  const [repos, setRepos] = useState<CatalogRepo[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [reposLoading, setReposLoading] = useState(true);

  /* ── Bullets state ── */
  const [bullets, setBullets] = useState<BulletArtifact[]>([]);
  const [bulletsLoading, setBulletsLoading] = useState(false);

  /* ── Input + filter ── */
  const [newTitle, setNewTitle] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');

  /* ── Error state ── */
  const [error, setError] = useState<string | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);

  /* ── Fetch repos on mount ── */
  useEffect(() => {
    let cancelled = false;

    async function loadRepos() {
      try {
        const res = await fetch('/api/catalog/repos');
        if (!res.ok) {
          if (!cancelled) setRepoError(`Failed to load repositories (HTTP ${res.status})`);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        const list: CatalogRepo[] = Array.isArray(data.repos) ? data.repos : [];
        setRepos(list);
        setRepoError(null);
        // Auto-select the first repo if nothing selected yet
        if (list.length > 0 && !selectedRepoId) {
          setSelectedRepoId(list[0].repoId);
        }
      } catch (err) {
        if (!cancelled) setRepoError(`Could not connect to the server. Is the engine running?`);
      } finally {
        if (!cancelled) setReposLoading(false);
      }
    }

    void loadRepos();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Fetch bullets when repo changes ── */
  useEffect(() => {
    if (!selectedRepoId) {
      setBullets([]);
      return;
    }

    let cancelled = false;
    setBulletsLoading(true);

    async function loadBullets() {
      try {
        const res = await fetch(
          `/api/planning/artifacts/bullets?repoId=${encodeURIComponent(selectedRepoId!)}`,
        );
        if (!res.ok) {
          if (!cancelled) {
            setBullets([]);
            setError(`Failed to load todos (HTTP ${res.status})`);
          }
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        const items: BulletArtifact[] = Array.isArray(data.artifacts) ? data.artifacts : [];
        setBullets(items);
        setError(null);
      } catch {
        if (!cancelled) {
          setBullets([]);
          setError('Failed to load todos. Check your connection.');
        }
      } finally {
        if (!cancelled) setBulletsLoading(false);
      }
    }

    void loadBullets();
    return () => { cancelled = true; };
  }, [selectedRepoId]);

  /* ── Actions ── */

  async function refetchBullets() {
    if (!selectedRepoId) return;
    try {
      const res = await fetch(
        `/api/planning/artifacts/bullets?repoId=${encodeURIComponent(selectedRepoId)}`,
      );
      if (!res.ok) {
        setError(`Failed to refresh todos (HTTP ${res.status})`);
        return;
      }
      const data = await res.json();
      const items: BulletArtifact[] = Array.isArray(data.artifacts) ? data.artifacts : [];
      setBullets(items);
      setError(null);
    } catch {
      setError('Failed to refresh todos. Check your connection.');
    }
  }

  async function addBullet() {
    const title = newTitle.trim();
    if (!title || !selectedRepoId) return;

    try {
      const res = await fetch('/api/planning/artifacts/bullets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoId: selectedRepoId,
          bullet: {
            title,
            repoId: selectedRepoId,
            state: 'idea',
          },
        }),
      });
      if (res.ok) {
        setNewTitle('');
        setError(null);
        await refetchBullets();
      } else {
        setError(`Failed to add todo (HTTP ${res.status})`);
      }
    } catch {
      setError('Failed to add todo. Check your connection.');
    }
  }

  async function toggleDone(bullet: BulletArtifact) {
    if (!selectedRepoId) return;
    const nextState = isDone(bullet.state) ? 'idea' : 'pre-plan';

    try {
      const res = await fetch(
        `/api/planning/artifacts/bullets/${encodeURIComponent(bullet.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repoId: selectedRepoId,
            bullet: { state: nextState },
          }),
        },
      );
      if (res.ok) {
        setError(null);
        await refetchBullets();
      } else {
        setError(`Failed to update todo (HTTP ${res.status})`);
      }
    } catch {
      setError('Failed to update todo. Check your connection.');
    }
  }

  async function deleteBullet(bullet: BulletArtifact) {
    // The backend has no DELETE endpoint.  We mark the bullet as "pre-plan"
    // (done) so it can be filtered out.  This is the closest safe equivalent.
    if (!selectedRepoId) return;

    try {
      const res = await fetch(
        `/api/planning/artifacts/bullets/${encodeURIComponent(bullet.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repoId: selectedRepoId,
            bullet: { state: 'pre-plan' },
          }),
        },
      );
      if (res.ok) {
        setError(null);
        await refetchBullets();
      } else {
        setError(`Failed to delete todo (HTTP ${res.status})`);
      }
    } catch {
      setError('Failed to delete todo. Check your connection.');
    }
  }

  /* ── Inline editing state ── */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  async function startSessionFromBullet(bullet: BulletArtifact) {
    // 1. Reset wizard state first
    sessionWizardStore.reset();

    // 2. Select project first (this clears bullets, which is fine since we haven't set them yet)
    if (bullet.repoId) {
      await sessionWizardStore.loadProjects();
      const projects = sessionWizardStore.getState().projects;
      const match = projects.find(p => p.repoId === bullet.repoId);
      if (match) {
        sessionWizardStore.selectProject(match);
      }
    }

    // 3. Now set objective and bullet selection (AFTER selectProject so they aren't wiped)
    const objectiveText = bullet.summary
      ? `${bullet.title}\n\n${bullet.summary}`
      : bullet.title;
    sessionWizardStore.setObjective(objectiveText);
    sessionWizardStore.toggleBullet(bullet.id);

    // 4. Open wizard — skip to Objective step only if project was successfully selected
    const hasProject = sessionWizardStore.getState().selectedProject !== null;
    sessionWizardStore.setStep(hasProject ? 1 : 0);
    navigationStore.openWizard('session');
  }

  function startEdit(bullet: BulletArtifact) {
    setEditingId(bullet.id);
    setEditingTitle(bullet.title);
  }

  async function saveEdit(bulletId: string) {
    if (!selectedRepoId || !editingTitle.trim()) {
      setEditingId(null);
      return;
    }

    try {
      const res = await fetch(
        `/api/planning/artifacts/bullets/${encodeURIComponent(bulletId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repoId: selectedRepoId,
            bullet: { title: editingTitle.trim() },
          }),
        },
      );
      if (res.ok) {
        setError(null);
        await refetchBullets();
      } else {
        setError(`Failed to save edit (HTTP ${res.status})`);
      }
    } catch {
      setError('Failed to save edit. Check your connection.');
    } finally {
      setEditingId(null);
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingTitle('');
  }

  /* ── Derived data ── */

  const filteredBullets = bullets.filter((b) => {
    if (filter === 'active') return !isDone(b.state);
    if (filter === 'done') return isDone(b.state);
    return true;
  });

  /* ── Render ── */

  return (
    <div className="todo-view" data-testid="todo-view">
      {/* ── Error banner ── */}
      {(error || repoError) && (
        <div className="todo-error-banner" data-testid="todo-error-banner" role="alert">
          <span className="todo-error-message">{error || repoError}</span>
          <button
            type="button"
            className="todo-error-dismiss"
            data-testid="todo-error-dismiss"
            onClick={() => { setError(null); setRepoError(null); }}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Header ── */}
      <div className="todo-header" data-testid="todo-header">
        <h2 className="todo-title">Todo</h2>

        <select
          className="todo-repo-selector"
          data-testid="todo-repo-selector"
          value={selectedRepoId ?? ''}
          onChange={(e) => setSelectedRepoId(e.target.value || null)}
          disabled={reposLoading}
        >
          <option value="">— Select repository —</option>
          {repos.map((repo) => (
            <option key={repo.repoId} value={repo.repoId}>
              {repo.repoLabel || repo.repoId}
            </option>
          ))}
        </select>
      </div>

      {/* ── Repos loading ── */}
      {reposLoading && (
        <p className="todo-empty-state" data-testid="todo-repos-loading">
          Loading repositories…
        </p>
      )}

      {/* ── No repos registered ── */}
      {!reposLoading && repos.length === 0 && !repoError && (
        <p className="todo-empty-state" data-testid="todo-empty-no-repos">
          No repositories registered yet. Register a repository in the Catalog to start tracking todos.
        </p>
      )}

      {/* ── No repo selected (repos exist but none picked) ── */}
      {!reposLoading && repos.length > 0 && !selectedRepoId && (
        <p className="todo-empty-state" data-testid="todo-empty-no-repo">
          Select a repository to see its work queue
        </p>
      )}

      {/* ── Repo selected: show content ── */}
      {selectedRepoId && (
        <>
          {/* ── Add input ── */}
          <div className="todo-add-bar" data-testid="todo-add-bar">
            <input
              className="todo-add-input"
              data-testid="todo-add-input"
              type="text"
              placeholder="Add a todo…"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void addBullet();
                }
              }}
            />
            <button
              type="button"
              className="todo-add-button"
              data-testid="todo-add-button"
              disabled={!newTitle.trim()}
              onClick={() => void addBullet()}
            >
              + Add
            </button>
          </div>

          {/* ── Filter pills ── */}
          <div className="todo-filters" data-testid="todo-filters">
            {(['all', 'active', 'done'] as FilterMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`todo-filter-pill${filter === mode ? ' todo-filter-pill-active' : ''}`}
                data-testid={`todo-filter-${mode}`}
                onClick={() => setFilter(mode)}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>

          {/* ── Bullet list ── */}
          {bulletsLoading ? (
            <p className="todo-empty-state" data-testid="todo-loading">Loading…</p>
          ) : filteredBullets.length === 0 ? (
            <p className="todo-empty-state" data-testid="todo-empty-no-items">
              {bullets.length === 0
                ? 'No items yet. Add your first todo above.'
                : 'No items match the current filter.'}
            </p>
          ) : (
            <ul className="todo-list" data-testid="todo-list">
              {filteredBullets.map((bullet) => {
                const done = isDone(bullet.state);
                return (
                  <li
                    key={bullet.id}
                    className={`todo-item${done ? ' todo-item-done' : ''}`}
                    data-testid={`todo-item-${bullet.id}`}
                  >
                    <input
                      type="checkbox"
                      className="todo-item-checkbox"
                      data-testid={`todo-check-${bullet.id}`}
                      checked={done}
                      onChange={() => void toggleDone(bullet)}
                    />

                    {editingId === bullet.id ? (
                      <input
                        className="todo-item-edit-input"
                        data-testid={`todo-edit-${bullet.id}`}
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            void saveEdit(bullet.id);
                          } else if (e.key === 'Escape') {
                            cancelEdit();
                          }
                        }}
                        onBlur={() => void saveEdit(bullet.id)}
                        autoFocus
                      />
                    ) : (
                      <span
                        className="todo-item-text"
                        data-testid={`todo-text-${bullet.id}`}
                        onDoubleClick={() => startEdit(bullet)}
                        title="Double-click to edit"
                      >
                        {bullet.title}
                      </span>
                    )}

                    <button
                      type="button"
                      className="todo-item-start"
                      data-testid={`todo-start-${bullet.id}`}
                      title="Start session"
                      onClick={() => void startSessionFromBullet(bullet)}
                    >
                      ▶ Start session
                    </button>

                    <button
                      type="button"
                      className="todo-item-delete"
                      data-testid={`todo-delete-${bullet.id}`}
                      title="Delete"
                      onClick={() => void deleteBullet(bullet)}
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
