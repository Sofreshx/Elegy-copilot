import { useStoreValue } from '../lib/store';
import { navigationStore, type OpenWorkspace } from '../stores/navigation';

export default function WorkspaceFloatingCard() {
  const store = useStoreValue(navigationStore);

  if (store.openWorkspaces.length === 0) return null;

  return (
    <div className="workspace-floating-card" data-testid="workspace-floating-card">
      <div className="workspace-floating-card-header">
        <span className="workspace-floating-card-title">Workspaces</span>
        <span className="workspace-floating-card-count">{store.openWorkspaces.length}</span>
      </div>
      <ul className="workspace-floating-card-list">
        {store.openWorkspaces.map((ws: OpenWorkspace) => (
          <li key={ws.repoPath} className="workspace-floating-card-item">
            <button
              type="button"
              className={`workspace-floating-card-btn${store.activeWorkspaceId === ws.repoPath ? ' workspace-floating-card-btn-active' : ''}`}
              onClick={() => navigationStore.focusWorkspace(ws.repoPath)}
              title={ws.repoPath}
            >
              <span className="workspace-floating-card-icon">📂</span>
              <span className="workspace-floating-card-label">{ws.repoLabel}</span>
            </button>
            <button
              type="button"
              className="workspace-floating-card-close"
              onClick={(e) => { e.stopPropagation(); navigationStore.closeWorkspace(ws.repoPath); }}
              aria-label={`Close ${ws.repoLabel}`}
              title="Close workspace"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
