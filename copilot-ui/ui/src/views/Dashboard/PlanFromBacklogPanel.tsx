import { useEffect, useState, useCallback } from 'react';
import { sessionWizardStore } from '../Sessions/sessionWizardStore';
import { navigationStore } from '../../stores/navigation';
import type { CatalogRepoInventoryEntry } from '../../lib/types';

interface BulletItem {
  id: string;
  title: string;
  state: string;
  summary: string;
}

interface PlanFromBacklogPanelProps {
  onClose: () => void;
}

export default function PlanFromBacklogPanel({ onClose }: PlanFromBacklogPanelProps) {
  const [repos, setRepos] = useState<CatalogRepoInventoryEntry[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [selectedRepo, setSelectedRepo] = useState<CatalogRepoInventoryEntry | null>(null);

  const [bullets, setBullets] = useState<BulletItem[]>([]);
  const [bulletsLoading, setBulletsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [error, setError] = useState<string | null>(null);

  // Load repos on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/catalog/repos');
        if (!res.ok) {
          if (!cancelled) setError(`Failed to load repos (HTTP ${res.status})`);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        const list = Array.isArray(data.repos) ? data.repos : [];
        setRepos(list);
        if (list.length > 0) setSelectedRepo(list[0]);
      } catch {
        if (!cancelled) setError('Could not connect to the server.');
      } finally {
        if (!cancelled) setReposLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  // Load bullets when repo changes
  useEffect(() => {
    if (!selectedRepo) {
      setBullets([]);
      return;
    }
    let cancelled = false;
    setBulletsLoading(true);
    async function load() {
      try {
        const res = await fetch(
          `/api/planning/artifacts/bullets?repoId=${encodeURIComponent(selectedRepo!.repoId ?? '')}`
        );
        if (!res.ok) {
          if (!cancelled) setError(`Failed to load bullets (HTTP ${res.status})`);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        const items: BulletItem[] = (Array.isArray(data.artifacts) ? data.artifacts : [])
          .filter((b: any) => b.state !== 'pre-plan') // Only show active bullets
          .map((b: any) => ({
            id: b.id,
            title: b.title || '',
            state: b.state || 'idea',
            summary: b.summary || '',
          }));
        setBullets(items);
        setSelectedIds([]);
        setError(null);
      } catch {
        if (!cancelled) setError('Failed to load backlog items.');
      } finally {
        if (!cancelled) setBulletsLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [selectedRepo]);

  const toggleBullet = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(bullets.map((b) => b.id));
  }, [bullets]);

  const clearAll = useCallback(() => {
    setSelectedIds([]);
  }, []);

  // Build objective from selected bullets
  const selectedBullets = bullets.filter((b) => selectedIds.includes(b.id));
  const objectivePreview = selectedBullets.length > 0
    ? `Create an implementation plan addressing the following backlog items:\n\n${selectedBullets.map((b) => `- ${b.title}${b.summary ? `: ${b.summary}` : ''}`).join('\n')}`
    : '';

  async function handleLaunch() {
    if (!selectedRepo || selectedIds.length === 0) return;

    // Hydrate the session wizard store
    sessionWizardStore.reset();
    await sessionWizardStore.loadProjects();

    // Find and select the matching project
    const projects = sessionWizardStore.getState().projects;
    const match = projects.find((p) => p.repoId === selectedRepo.repoId);
    if (match) {
      sessionWizardStore.selectProject(match);
    }

    // Set objective and agent
    sessionWizardStore.setObjective(objectivePreview);
    sessionWizardStore.setAgentId('orchestrator-cli');
    sessionWizardStore.setModel('claude-sonnet-4.6');

    // Select the bullets
    for (const id of selectedIds) {
      sessionWizardStore.toggleBullet(id);
    }

    // Open wizard at the Objective step (step 1) if project was set, else step 0
    const hasProject = sessionWizardStore.getState().selectedProject !== null;
    sessionWizardStore.setStep(hasProject ? 1 : 0);
    navigationStore.openWizard('session');
    onClose();
  }

  return (
    <div className="plan-from-backlog-panel" data-testid="plan-from-backlog-panel">
      <div className="plan-from-backlog-header">
        <h3 className="plan-from-backlog-title">📋 Plan from Backlog</h3>
        <button
          type="button"
          className="plan-from-backlog-close"
          data-testid="plan-from-backlog-close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {error && (
        <div className="plan-from-backlog-error" data-testid="plan-from-backlog-error" role="alert">
          {error}
        </div>
      )}

      {/* Repo selector */}
      <div className="plan-from-backlog-repo-section">
        <label className="plan-from-backlog-label" htmlFor="backlog-repo-select">Repository</label>
        {reposLoading ? (
          <p className="plan-from-backlog-loading">Loading repositories…</p>
        ) : (
          <select
            id="backlog-repo-select"
            className="plan-from-backlog-select"
            data-testid="plan-from-backlog-repo-select"
            value={selectedRepo?.repoId ?? ''}
            onChange={(e) => {
              const repo = repos.find((r) => r.repoId === e.target.value) ?? null;
              setSelectedRepo(repo);
            }}
          >
            <option value="">— Select repository —</option>
            {repos.map((r) => (
              <option key={r.repoId ?? r.repoPath ?? ''} value={r.repoId ?? ''}>
                {r.repoLabel || r.repoId || r.repoPath || '(unknown)'}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Bullets list */}
      {selectedRepo && (
        <div className="plan-from-backlog-bullets-section">
          <div className="plan-from-backlog-bullets-header">
            <span className="plan-from-backlog-label">
              Backlog Items {bullets.length > 0 ? `(${selectedIds.length}/${bullets.length})` : ''}
            </span>
            {bullets.length > 0 && (
              <div className="plan-from-backlog-bulk-actions">
                <button
                  type="button"
                  className="plan-from-backlog-bulk-btn"
                  data-testid="plan-from-backlog-select-all"
                  onClick={selectAll}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="plan-from-backlog-bulk-btn"
                  data-testid="plan-from-backlog-clear-all"
                  onClick={clearAll}
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {bulletsLoading ? (
            <p className="plan-from-backlog-loading" data-testid="plan-from-backlog-loading">Loading backlog…</p>
          ) : bullets.length === 0 ? (
            <p className="plan-from-backlog-empty" data-testid="plan-from-backlog-empty">
              No active backlog items for this repository.
            </p>
          ) : (
            <ul className="plan-from-backlog-list" data-testid="plan-from-backlog-list">
              {bullets.map((b) => (
                <li key={b.id} className={`plan-from-backlog-item ${selectedIds.includes(b.id) ? 'plan-from-backlog-item-selected' : ''}`}>
                  <label className="plan-from-backlog-item-label" data-testid={`plan-from-backlog-item-${b.id}`}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(b.id)}
                      onChange={() => toggleBullet(b.id)}
                    />
                    <span className="plan-from-backlog-item-title">{b.title}</span>
                    <span className={`plan-from-backlog-item-state plan-from-backlog-state-${b.state}`}>{b.state}</span>
                  </label>
                  {b.summary && (
                    <p className="plan-from-backlog-item-summary">{b.summary}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Objective preview */}
      {selectedIds.length > 0 && (
        <div className="plan-from-backlog-objective" data-testid="plan-from-backlog-objective">
          <span className="plan-from-backlog-label">Objective preview</span>
          <pre className="plan-from-backlog-objective-text">{objectivePreview}</pre>
        </div>
      )}

      {/* Launch button */}
      <div className="plan-from-backlog-actions">
        <button
          type="button"
          className="button button-secondary"
          data-testid="plan-from-backlog-todo-link"
          onClick={() => {
            navigationStore.navigate('planning');
            onClose();
          }}
        >
          View all in Todo
        </button>
        <button
          type="button"
          className="button button-primary"
          data-testid="plan-from-backlog-launch"
          disabled={selectedIds.length === 0 || !selectedRepo}
          onClick={() => void handleLaunch()}
        >
          Launch Planning Session ({selectedIds.length})
        </button>
      </div>
    </div>
  );
}
