import { useState, useEffect } from 'react';
import { 
  offlineSyncService, 
  SyncQueueItem, 
  ConflictResolution 
} from '../../services/offlineSyncService';
import './ConflictResolver.css';

interface ConflictResolverProps {
  onClose: () => void;
}

interface ConflictDisplay {
  item: SyncQueueItem;
  localPreview: string;
  serverPreview?: string;
}

export function ConflictResolver({ onClose }: ConflictResolverProps) {
  const [conflicts, setConflicts] = useState<ConflictDisplay[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isResolving, setIsResolving] = useState(false);

  const loadConflicts = async () => {
    const items = await offlineSyncService.getConflicts();
    const displays: ConflictDisplay[] = items.map(item => ({
      item,
      localPreview: formatPreview(item.data),
      serverPreview: formatPreview(item.data), // Would come from server in real impl
    }));
    setConflicts(displays);
  };

  useEffect(() => {
    loadConflicts();
  }, []);

  const formatPreview = (data: unknown): string => {
    if (typeof data === 'string') return data;
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      // Try to find a title or name field
      if ('title' in obj) return String(obj.title);
      if ('name' in obj) return String(obj.name);
      if ('content' in obj) return String(obj.content).slice(0, 100);
      return JSON.stringify(data, null, 2).slice(0, 200);
    }
    return String(data);
  };

  const handleResolve = async (resolution: ConflictResolution) => {
    const current = conflicts[selectedIndex];
    if (!current || isResolving) return;

    setIsResolving(true);
    try {
      await offlineSyncService.resolveConflict(
        current.item.id,
        resolution
      );
      
      // Reload conflicts
      await loadConflicts();
      
      // Move to next conflict or close if none left
      if (conflicts.length <= 1) {
        onClose();
      } else if (selectedIndex >= conflicts.length - 1) {
        setSelectedIndex(Math.max(0, conflicts.length - 2));
      }
    } finally {
      setIsResolving(false);
    }
  };

  const handleResolveAll = async (resolution: ConflictResolution) => {
    setIsResolving(true);
    try {
      for (const conflict of conflicts) {
        await offlineSyncService.resolveConflict(conflict.item.id, resolution);
      }
      onClose();
    } finally {
      setIsResolving(false);
    }
  };

  const current = conflicts[selectedIndex];

  if (conflicts.length === 0) {
    return (
      <div className="conflict-resolver-overlay" onClick={onClose}>
        <div className="conflict-resolver" onClick={e => e.stopPropagation()}>
          <header className="resolver-header">
            <h2>Sync Conflicts</h2>
            <button className="close-btn" onClick={onClose}>×</button>
          </header>
          <div className="no-conflicts">
            <p className="check-icon">✅</p>
            <p>No conflicts to resolve</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="conflict-resolver-overlay" onClick={onClose}>
      <div className="conflict-resolver" onClick={e => e.stopPropagation()}>
        <header className="resolver-header">
          <h2>Sync Conflicts ({conflicts.length})</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </header>

        <div className="conflict-nav">
          <button 
            onClick={() => setSelectedIndex(i => Math.max(0, i - 1))}
            disabled={selectedIndex === 0}
          >
            ←
          </button>
          <span>{selectedIndex + 1} of {conflicts.length}</span>
          <button 
            onClick={() => setSelectedIndex(i => Math.min(conflicts.length - 1, i + 1))}
            disabled={selectedIndex === conflicts.length - 1}
          >
            →
          </button>
        </div>

        {current && (
          <div className="conflict-content">
            <div className="conflict-info">
              <span className="entity-type">{current.item.entityType}</span>
              <span className="operation">{current.item.operation}</span>
            </div>

            <div className="version-comparison">
              <div className="version local">
                <h4>Your Version</h4>
                <div className="version-preview">{current.localPreview}</div>
                <p className="version-meta">
                  Modified {new Date(current.item.timestamp).toLocaleString()}
                </p>
              </div>

              <div className="version-separator">
                <span>VS</span>
              </div>

              <div className="version server">
                <h4>Server Version</h4>
                <div className="version-preview">{current.serverPreview || 'Unknown'}</div>
                <p className="version-meta">
                  Latest from server
                </p>
              </div>
            </div>

            <div className="resolution-actions">
              <button 
                className="resolve-btn local"
                onClick={() => handleResolve('keep-local')}
                disabled={isResolving}
              >
                Keep Mine
              </button>
              <button 
                className="resolve-btn server"
                onClick={() => handleResolve('keep-server')}
                disabled={isResolving}
              >
                Keep Theirs
              </button>
              <button 
                className="resolve-btn merge"
                onClick={() => handleResolve('merge')}
                disabled={isResolving}
              >
                Merge Both
              </button>
            </div>
          </div>
        )}

        {conflicts.length > 1 && (
          <div className="bulk-actions">
            <p>Resolve all {conflicts.length} conflicts:</p>
            <div className="bulk-buttons">
              <button 
                onClick={() => handleResolveAll('keep-local')}
                disabled={isResolving}
              >
                Keep All Mine
              </button>
              <button 
                onClick={() => handleResolveAll('keep-server')}
                disabled={isResolving}
              >
                Keep All Theirs
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
