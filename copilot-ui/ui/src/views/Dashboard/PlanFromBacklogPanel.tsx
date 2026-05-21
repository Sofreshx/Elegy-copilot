import { useEffect, useState } from 'react';
import { sessionWizardStore } from '../Sessions/sessionWizardStore';
import { navigationStore } from '../../stores/navigation';
import type { CatalogRepoInventoryEntry } from '../../lib/types';

interface PlanFromBacklogPanelProps {
  onClose: () => void;
}

export default function PlanFromBacklogPanel({ onClose }: PlanFromBacklogPanelProps) {
  const [repos, setRepos] = useState<CatalogRepoInventoryEntry[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [selectedRepo, setSelectedRepo] = useState<CatalogRepoInventoryEntry | null>(null);

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

  async function handleLaunch() {
    if (!selectedRepo) return;

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
    sessionWizardStore.setObjective(`Create an implementation plan for ${selectedRepo.repoLabel || selectedRepo.repoId || 'the selected repository'}.`);
    sessionWizardStore.setAgentId('orchestrator-cli');
    sessionWizardStore.setModel('claude-sonnet-4.6');

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

      {selectedRepo ? (
        <div className="plan-from-backlog-empty" data-testid="plan-from-backlog-empty">
          Retired repo-file backlog bullets are no longer available here. Launch a planning session for the selected repository instead.
        </div>
      ) : null}

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
          Open Planning Workspace
        </button>
        <button
          type="button"
          className="button button-primary"
          data-testid="plan-from-backlog-launch"
          disabled={!selectedRepo}
          onClick={() => void handleLaunch()}
        >
          Launch Planning Session
        </button>
      </div>
    </div>
  );
}
