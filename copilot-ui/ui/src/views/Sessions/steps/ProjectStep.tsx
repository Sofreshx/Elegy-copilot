import { useEffect, useState } from 'react';
import { FormInput } from '../../../components';
import type { SessionWizardState } from '../sessionWizardStore';
import { sessionWizardStore } from '../sessionWizardStore';
import type { CatalogRepoInventoryEntry } from '../../../lib/types';

interface ProjectStepProps {
  state: SessionWizardState;
}

function matchesFilter(repo: CatalogRepoInventoryEntry, filter: string): boolean {
  const lower = filter.toLowerCase();
  const label = (repo.repoLabel ?? '').toLowerCase();
  const path = (repo.repoPath ?? '').toLowerCase();
  return label.includes(lower) || path.includes(lower);
}

function sortProjects(repos: CatalogRepoInventoryEntry[]): CatalogRepoInventoryEntry[] {
  return [...repos].sort((a, b) => {
    const aSel = a.selected ? 1 : 0;
    const bSel = b.selected ? 1 : 0;
    if (aSel !== bSel) return bSel - aSel;

    const aTime = typeof a.lastSeenAt === 'string' ? new Date(a.lastSeenAt).getTime() : 0;
    const bTime = typeof b.lastSeenAt === 'string' ? new Date(b.lastSeenAt).getTime() : 0;
    return bTime - aTime;
  });
}

function truncatePath(path: string, maxLen = 60): string {
  if (path.length <= maxLen) return path;
  return '…' + path.slice(path.length - maxLen + 1);
}

export default function ProjectStep({ state }: ProjectStepProps) {
  const [filter, setFilter] = useState('');

  useEffect(() => {
    sessionWizardStore.loadProjects();
  }, []);

  const filtered = sortProjects(
    state.projects.filter((r) => matchesFilter(r, filter)),
  );

  const selectedId = state.selectedProject?.repoId ?? null;

  return (
    <div className="session-wizard-project-step" data-testid="session-wizard-project-step">
      <FormInput
        label="Search projects"
        type="search"
        placeholder="Filter by name or path…"
        value={filter}
        onValueChange={setFilter}
        testId="session-wizard-project-filter"
      />

      {state.projectsLoading ? (
        <p className="session-wizard-loading">Loading projects…</p>
      ) : (
        <div className="session-wizard-project-list" data-testid="session-wizard-project-list">
          {filtered.map((repo) => {
            const id = repo.repoId ?? repo.repoPath ?? '';
            const isSelected = id === selectedId;
            let cardClass = 'session-wizard-project-card';
            if (isSelected && !state.useCustomRepo) cardClass += ' session-wizard-project-card-selected';
            if (repo.selected) cardClass += ' session-wizard-project-card-pinned';

            return (
              <button
                key={id}
                type="button"
                className={cardClass}
                data-testid={`session-wizard-project-card-${id}`}
                onClick={() => sessionWizardStore.selectProject(repo)}
              >
                <span className="session-wizard-project-label">
                  {repo.repoLabel ?? repo.repoId ?? 'Unknown'}
                </span>
                <span className="session-wizard-project-path">
                  {truncatePath(repo.repoPath ?? '')}
                </span>
                {repo.lastSeenAt ? (
                  <span className="session-wizard-project-activity">
                    {new Date(repo.lastSeenAt).toLocaleDateString()}
                  </span>
                ) : null}
              </button>
            );
          })}

          {filtered.length === 0 && !state.projectsLoading ? (
            <p className="session-wizard-empty">No projects found.</p>
          ) : null}
        </div>
      )}

      <div className="session-wizard-custom-repo">
        <button
          type="button"
          className={`session-wizard-custom-repo-toggle ${state.useCustomRepo ? 'session-wizard-custom-repo-toggle-active' : ''}`}
          data-testid="session-wizard-custom-repo-toggle"
          onClick={() => {
            if (!state.useCustomRepo) {
              sessionWizardStore.setCustomRepoPath(state.customRepoPath);
            } else {
              sessionWizardStore.selectProject(state.selectedProject);
            }
          }}
        >
          Other repository…
        </button>

        {state.useCustomRepo ? (
          <FormInput
            label="Repository path"
            placeholder="/path/to/repo"
            value={state.customRepoPath}
            onValueChange={(v) => sessionWizardStore.setCustomRepoPath(v)}
            testId="session-wizard-custom-repo-path"
          />
        ) : null}
      </div>
    </div>
  );
}
