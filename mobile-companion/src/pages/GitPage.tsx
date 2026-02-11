import { useState, useEffect } from "react";
import { getApiClient, ApiError } from "../services/apiClient";

export interface GitSnapshot {
  repo: string;
  branch: string;
  ahead: number;
  behind: number;
  modified: number;
  untracked: number;
  lastChecked: string;
}

export default function GitPage() {
  const [snapshots, setSnapshots] = useState<GitSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGitStatus = async () => {
    try {
      setError(null);
      const api = getApiClient();
      const data = await api.get<{ repos: GitSnapshot[] }>("/api/git-status");
      setSnapshots(data.repos);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // API not yet available — show placeholder
        setError(null);
        setSnapshots([]);
      } else {
        setError(err instanceof Error ? err.message : "Failed to load git status");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGitStatus();
    const interval = setInterval(fetchGitStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="git-page">
      <header className="page-header">
        <h1>Git Status</h1>
        <button onClick={fetchGitStatus} className="btn-secondary" disabled={loading}>
          Refresh
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading">Loading git status...</div>
      ) : snapshots.length === 0 ? (
        <div className="empty-state">
          <p>No repositories being monitored.</p>
          <p className="muted">Start the local tracker to see git status here.</p>
        </div>
      ) : (
        <div className="repo-list">
          {snapshots.map((snapshot) => (
            <div key={snapshot.repo} className="card repo-card">
              <div className="repo-header">
                <h3 className="repo-name">{snapshot.repo}</h3>
                <span className="branch-badge">{snapshot.branch}</span>
              </div>

              <div className="repo-stats">
                {snapshot.modified > 0 && (
                  <span className="stat stat-modified" title="Modified files">
                    M {snapshot.modified}
                  </span>
                )}
                {snapshot.untracked > 0 && (
                  <span className="stat stat-untracked" title="Untracked files">
                    ? {snapshot.untracked}
                  </span>
                )}
                {snapshot.ahead > 0 && (
                  <span className="stat stat-ahead" title="Commits ahead">
                    ↑ {snapshot.ahead}
                  </span>
                )}
                {snapshot.behind > 0 && (
                  <span className="stat stat-behind" title="Commits behind">
                    ↓ {snapshot.behind}
                  </span>
                )}
                {snapshot.modified === 0 && snapshot.untracked === 0 && snapshot.ahead === 0 && snapshot.behind === 0 && (
                  <span className="stat stat-clean">Clean</span>
                )}
              </div>

              <time className="last-checked">
                Last checked: {new Date(snapshot.lastChecked).toLocaleTimeString()}
              </time>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
