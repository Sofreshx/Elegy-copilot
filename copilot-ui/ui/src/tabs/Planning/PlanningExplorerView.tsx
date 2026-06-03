import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Panel } from '../../components';
import { listPlanningLiveRoadmaps } from '../../lib/api';
import { humanizeToken } from '../../lib/stateDiagnostics';
import { useStoreValue } from '../../lib/store';
import { catalogWorkspaceStore } from '../Assets/catalogWorkspaceStore';
import {
  type AugmentedRoadmap,
  type RepoChoice,
  normalizeRepoEntries,
  resolveRepoLabel,
  mergeRepoRoadmaps,
  filterBySelectedRepos,
  sortRoadmaps,
} from './planningExplorerContracts';
import PlanningGraphView from './PlanningGraphView';

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Unknown error';
}

export default function PlanningExplorerView() {
  const catalogState = useStoreValue(catalogWorkspaceStore);

  // ---- State ----
  const [roadmaps, setRoadmaps] = useState<AugmentedRoadmap[]>([]);
  const [failedRepos, setFailedRepos] = useState<RepoChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'updated' | 'created'>('updated');
  // Compound key: `${repoPath}|${repoId}`
  const [selectedRepoKeys, setSelectedRepoKeys] = useState<Set<string>>(new Set());

  // ---- Inline graph state ----
  const [selectedRoadmap, setSelectedRoadmap] = useState<AugmentedRoadmap | null>(null);

  // ---- Derived: normalised repos ----
  const repos = useMemo(() => {
    const raw = Array.isArray(catalogState.repoInventory?.repos)
      ? catalogState.repoInventory.repos
      : [];
    return normalizeRepoEntries(raw);
  }, [catalogState.repoInventory?.repos]);

  // ---- Derived: visible roadmaps ----
  const visibleRoadmaps = useMemo(() => {
    let filtered = selectedRepoKeys.size > 0
      ? filterBySelectedRepos(roadmaps, selectedRepoKeys)
      : roadmaps;
    return sortRoadmaps(filtered, sortBy);
  }, [roadmaps, selectedRepoKeys, sortBy]);

  // ---- Auto-load workspace ----
  useEffect(() => {
    if (catalogState.repoInventory || catalogState.repoInventoryLoading || catalogState.loading) return;
    void catalogWorkspaceStore.loadWorkspace();
  }, [catalogState.repoInventory, catalogState.repoInventoryLoading, catalogState.loading]);

  // ---- Fetch roadmaps from all repos ----
  const fetchRoadmaps = useCallback(async () => {
    if (repos.length === 0) {
      setRoadmaps([]);
      setFailedRepos([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const promises = repos.map((repo) =>
        listPlanningLiveRoadmaps({
          repoId: repo.repoId || undefined,
          repoPath: repo.repoPath || undefined,
          repoLabel: repo.repoLabel || undefined,
        }),
      );
      // Also query globally (no repo params) to catch roadmaps without repo tags
      promises.push(listPlanningLiveRoadmaps());
      const results = await Promise.allSettled(promises);

      // Merge per-repo results normally (last result is the global query)
      const perRepoResults = results.slice(0, repos.length);
      const globalResult = results[repos.length];
      const merged = mergeRepoRoadmaps(perRepoResults, repos);

      // Add global (unscoped) roadmaps that didn't appear in any per-repo result
      if (globalResult.status === 'fulfilled' && Array.isArray(globalResult.value?.roadmaps)) {
        const existingIds = new Set(merged.roadmaps.map((r: AugmentedRoadmap) => r.id));
        for (const roadmap of globalResult.value.roadmaps) {
          if (!existingIds.has(roadmap.id)) {
            merged.roadmaps.push({ ...roadmap, _repoSource: { repoId: '', repoPath: '', repoLabel: '(unscoped)' } });
          }
        }
      }

      setRoadmaps(merged.roadmaps);
      setFailedRepos(merged.failedRepos);

      // Auto-select all repos on first load
      if (selectedRepoKeys.size === 0) {
        setSelectedRepoKeys(new Set(repos.map((r) => `${r.repoPath}|${r.repoId}`)));
      }
    } catch (err) {
      setError(toErrorMessage(err));
      setRoadmaps([]);
      setFailedRepos([]);
    } finally {
      setLoading(false);
    }
  }, [repos, selectedRepoKeys.size]);

  useEffect(() => {
    void fetchRoadmaps();
  }, [fetchRoadmaps]);

  // ---- Open inline graph ----
  function selectRoadmap(roadmap: AugmentedRoadmap) {
    setSelectedRoadmap(roadmap);
  }

  function closeRoadmap() {
    setSelectedRoadmap(null);
  }

  // ---- Open in separate window ----
  function openInSeparateWindow(roadmap: AugmentedRoadmap) {
    const params = new URLSearchParams();
    params.set('roadmapId', roadmap.id);
    if (roadmap._repoSource.repoId) params.set('repoId', roadmap._repoSource.repoId);
    if (roadmap._repoSource.repoPath) params.set('repoPath', roadmap._repoSource.repoPath);
    if (roadmap._repoSource.repoLabel) params.set('repoLabel', roadmap._repoSource.repoLabel);

    // In Tauri: try creating a proper OS window via WebviewWindow
    if (window.instructionEngineDesktop?.shell === 'tauri') {
      const currentParams = new URLSearchParams(window.location.search);
      const token = currentParams.get('desktop-ui-token');
      if (token) params.set('desktop-ui-token', token);

      if (window.__TAURI__) {
        const label = `roadmap-detail-${roadmap.id}-${Date.now()}`;
        try {
          const ww = new window.__TAURI__.webviewWindow.WebviewWindow(label, {
            url: `${window.location.origin}/?${params.toString()}`,
            title: roadmap.title || roadmap.id,
            width: 1200,
            height: 800,
            visible: true,
          });
          ww.once('tauri://error', () => {
            window.open(`${window.location.origin}/?${params.toString()}`);
          });
          return;
        } catch {
          // fall through to fallback
        }
      }
      // Fallback: open in browser
      window.open(`${window.location.origin}/?${params.toString()}`);
      return;
    }

    // Browser context
    window.open(`${window.location.origin}/?${params.toString()}`);
  }

  // ---- Filter toggle ----
  function toggleRepo(key: string) {
    setSelectedRepoKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  // ---- Compound key for a repo ----
  function repoKey(repo: RepoChoice): string {
    return `${repo.repoPath}|${repo.repoId}`;
  }

  // ---- Build repo query for PlanningGraphView ----
  const selectedRepoQuery = useMemo(() => {
    if (!selectedRoadmap) return undefined;
    return {
      repoId: selectedRoadmap._repoSource.repoId || undefined,
      repoPath: selectedRoadmap._repoSource.repoPath || undefined,
      repoLabel: selectedRoadmap._repoSource.repoLabel || undefined,
    };
  }, [selectedRoadmap]);

  // ---- Render: Inline Graph View ----
  if (selectedRoadmap) {
    return (
      <section className="planning-explorer-view" data-testid="planning-explorer-view">
        <div className="planning-explorer-header">
          <h2>Planning Explorer</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button
              onClick={closeRoadmap}
              testId="planning-explorer-back-to-list"
              variant="secondary"
              size="sm"
            >
              ← Back to roadmaps
            </Button>
            <Button
              onClick={() => openInSeparateWindow(selectedRoadmap)}
              testId="planning-explorer-open-window"
              variant="secondary"
              size="sm"
            >
              ▢ Open in window
            </Button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <PlanningGraphView
            roadmapId={selectedRoadmap.id}
            repoQuery={selectedRepoQuery ?? {}}
            onBack={closeRoadmap}
            onRefreshNeeded={() => void fetchRoadmaps()}
          />
        </div>
      </section>
    );
  }

  // ---- Render: Roadmap List ----
  return (
    <section className="planning-explorer-view" data-testid="planning-explorer-view">
      {/* ---- Header ---- */}
      <div className="planning-explorer-header">
        <h2>Planning Explorer</h2>
        <Button
          disabled={loading}
          onClick={() => void fetchRoadmaps()}
          testId="planning-explorer-refresh"
          variant="secondary"
          size="sm"
        >
          Refresh
        </Button>
      </div>

      {/* ---- Filter bar ---- */}
      {repos.length > 1 && (
        <div className="planning-explorer-filter-bar">
          <span className="planning-explorer-filter-label">Repos:</span>
          {repos.map((repo) => {
            const key = repoKey(repo);
            const isSelected = selectedRepoKeys.has(key);
            return (
              <Button
                key={key}
                onClick={() => toggleRepo(key)}
                testId={`planning-explorer-filter-${repo.repoId || repo.repoPath}`}
                variant={isSelected ? 'primary' : 'secondary'}
                size="sm"
              >
                {resolveRepoLabel(repo)}
              </Button>
            );
          })}
        </div>
      )}

      {/* ---- Sort control ---- */}
      <div className="planning-explorer-sort">
        <label className="form-label" htmlFor="planning-explorer-sort-select">Sort:</label>
        <select
          id="planning-explorer-sort-select"
          className="planning-explorer-sort-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'updated' | 'created')}
          data-testid="planning-explorer-sort-select"
        >
          <option value="updated">Last updated (newest first)</option>
          <option value="created">Created (newest first)</option>
        </select>
      </div>

      {/* ---- Warning banner for partial failures ---- */}
      {failedRepos.length > 0 && (
        <div className="planning-explorer-warning" role="alert">
          Failed to load roadmaps from: {failedRepos.map((r) => resolveRepoLabel(r)).join(', ')}
        </div>
      )}

      {/* ---- Content ---- */}
      <Panel
        title="Roadmaps"
        subtitle={
          loading
            ? 'Loading roadmaps across tracked repositories...'
            : `${visibleRoadmaps.length} roadmap${visibleRoadmaps.length !== 1 ? 's' : ''} shown`
        }
        testId="planning-explorer-roadmaps-panel"
      >
        {error ? (
          <p className="planning-explorer-error" role="alert">{error}</p>
        ) : loading ? (
          <p className="state-message">Loading roadmaps across tracked repositories...</p>
        ) : visibleRoadmaps.length === 0 ? (
          <p className="planning-explorer-empty state-message">
            {roadmaps.length === 0
              ? 'No roadmaps found across tracked repositories.'
              : 'No roadmaps match the selected repository filters.'}
          </p>
        ) : (
          <div className="planning-explorer-list">
            {visibleRoadmaps.map((roadmap) => (
              <button
                key={`${roadmap._repoSource.repoPath}|${roadmap._repoSource.repoId}|${roadmap.id}`}
                className="planning-explorer-card"
                data-testid={`planning-explorer-roadmap-${roadmap.id}`}
                onClick={() => selectRoadmap(roadmap)}
                type="button"
              >
                <div className="planning-explorer-card-heading">
                  <p className="planning-explorer-card-title">{roadmap.title || roadmap.id}</p>
                  <span className="planning-chip">{humanizeToken(roadmap.status)}</span>
                </div>
                <p className="planning-explorer-card-repo">{resolveRepoLabel(roadmap._repoSource)}</p>
                {roadmap.summary ? (
                  <p className="planning-explorer-card-summary">{roadmap.summary}</p>
                ) : null}
                <p className="planning-explorer-card-date">{formatTimestamp(roadmap.updatedAt)}</p>
              </button>
            ))}
          </div>
        )}
      </Panel>
    </section>
  );
}
