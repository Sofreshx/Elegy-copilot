import { useState, useEffect } from 'react';
import { offlineSyncService, SyncState } from '../../services/offlineSyncService';
import './OfflineIndicator.css';

export function OfflineIndicator() {
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const unsubscribe = offlineSyncService.subscribe(state => {
      setSyncState(state);
    });
    return unsubscribe;
  }, []);

  if (!syncState) return null;

  // Only show if offline, syncing, or has pending/conflicts
  const shouldShow = !syncState.isOnline || 
                     syncState.isSyncing || 
                     syncState.pendingCount > 0 || 
                     syncState.conflictCount > 0;

  if (!shouldShow) return null;

  const handleSync = async () => {
    if (!syncState.isOnline || syncState.isSyncing) return;
    try {
      await offlineSyncService.forceSync();
    } catch (err) {
      console.error('Sync failed:', err);
    }
  };

  const formatLastSync = (timestamp: number) => {
    if (!timestamp) return 'Never';
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <>
      <div 
        className={`offline-indicator ${!syncState.isOnline ? 'offline' : ''} ${
          syncState.isSyncing ? 'syncing' : ''
        } ${syncState.conflictCount > 0 ? 'has-conflicts' : ''}`}
        onClick={() => setShowDetails(!showDetails)}
      >
        <span className="status-icon">
          {!syncState.isOnline ? '📴' : syncState.isSyncing ? '🔄' : 
           syncState.conflictCount > 0 ? '⚠️' : '☁️'}
        </span>
        <span className="status-text">
          {!syncState.isOnline ? 'Offline' : 
           syncState.isSyncing ? 'Syncing...' :
           syncState.conflictCount > 0 ? `${syncState.conflictCount} conflicts` :
           syncState.pendingCount > 0 ? `${syncState.pendingCount} pending` : 
           'Online'}
        </span>
      </div>

      {showDetails && (
        <div className="sync-details-overlay" onClick={() => setShowDetails(false)}>
          <div className="sync-details" onClick={e => e.stopPropagation()}>
            <header className="sync-details-header">
              <h3>Sync Status</h3>
              <button className="close-btn" onClick={() => setShowDetails(false)}>×</button>
            </header>
            
            <div className="sync-info">
              <div className="info-row">
                <span className="info-label">Connection</span>
                <span className={`info-value ${syncState.isOnline ? 'online' : 'offline'}`}>
                  {syncState.isOnline ? '🟢 Online' : '🔴 Offline'}
                </span>
              </div>
              
              <div className="info-row">
                <span className="info-label">Last Sync</span>
                <span className="info-value">{formatLastSync(syncState.lastSyncTime)}</span>
              </div>
              
              <div className="info-row">
                <span className="info-label">Pending Changes</span>
                <span className="info-value">{syncState.pendingCount}</span>
              </div>
              
              {syncState.conflictCount > 0 && (
                <div className="info-row conflicts">
                  <span className="info-label">Conflicts</span>
                  <span className="info-value">{syncState.conflictCount}</span>
                </div>
              )}
            </div>

            <div className="sync-actions">
              <button 
                className="sync-button"
                onClick={handleSync}
                disabled={!syncState.isOnline || syncState.isSyncing}
              >
                {syncState.isSyncing ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>

            {!syncState.isOnline && (
              <p className="offline-message">
                Changes will sync automatically when you're back online.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
