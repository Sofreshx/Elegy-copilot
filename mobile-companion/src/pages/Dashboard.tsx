import { useState, useCallback, useRef, useEffect } from 'react';
import { useClients, useDisconnectClient } from '../hooks/useClients';
import { getRelayConnection, type ConnectionStatus } from '../services/relayConnection';
import ClientList from '../components/clients/ClientList';
import './Dashboard.css';

export default function Dashboard() {
  const { clients, isLoading, isError, error, refetch, isRefetching } = useClients();
  const disconnectMutation = useDisconnectClient();
  const [disconnectingClientId, setDisconnectingClientId] = useState<string | null>(null);
  const [relayStatus, setRelayStatus] = useState<ConnectionStatus>('disconnected');

  // Pull-to-refresh state
  const [isPulling, setIsPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number>(0);
  const PULL_THRESHOLD = 80;

  // Subscribe to relay connection status
  useEffect(() => {
    const relay = getRelayConnection();
    const unsubscribe = relay.onStatusChange(setRelayStatus);
    return () => unsubscribe();
  }, []);

  // Handle client disconnect
  const handleDisconnect = useCallback(
    async (clientId: string) => {
      setDisconnectingClientId(clientId);
      try {
        await disconnectMutation.mutateAsync(clientId);
      } finally {
        setDisconnectingClientId(null);
      }
    },
    [disconnectMutation]
  );

  // Handle retry on error
  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  // Pull-to-refresh handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (containerRef.current?.scrollTop === 0 && e.touches[0]) {
      touchStartY.current = e.touches[0].clientY;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (containerRef.current?.scrollTop !== 0 || touchStartY.current === 0 || !e.touches[0]) {
      return;
    }

    const touchY = e.touches[0].clientY;
    const distance = Math.max(0, touchY - touchStartY.current);
    
    if (distance > 0) {
      setIsPulling(true);
      // Apply resistance to the pull
      setPullDistance(Math.min(distance * 0.5, PULL_THRESHOLD * 1.5));
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (pullDistance >= PULL_THRESHOLD && !isRefetching) {
      refetch();
    }
    setIsPulling(false);
    setPullDistance(0);
    touchStartY.current = 0;
  }, [pullDistance, isRefetching, refetch]);

  // Get relay status display
  const getRelayStatusDisplay = () => {
    switch (relayStatus) {
      case 'connected':
        return { className: 'online', text: 'Connected to Relay' };
      case 'connecting':
        return { className: 'pending', text: 'Connecting to Relay...' };
      case 'reconnecting':
        return { className: 'pending', text: 'Reconnecting...' };
      case 'disconnected':
      default:
        return { className: 'offline', text: 'Disconnected from Relay' };
    }
  };

  const relayStatusDisplay = getRelayStatusDisplay();
  const onlineClientsCount = clients.filter((c) => c.isOnline).length;

  return (
    <div
      ref={containerRef}
      className="page dashboard"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      {isPulling && (
        <div
          className="pull-to-refresh-indicator"
          style={{ height: pullDistance }}
        >
          <div className={`pull-spinner ${pullDistance >= PULL_THRESHOLD ? 'ready' : ''}`}>
            {pullDistance >= PULL_THRESHOLD ? (
              <span className="pull-text">Release to refresh</span>
            ) : (
              <span className="pull-text">Pull to refresh</span>
            )}
          </div>
        </div>
      )}

      {isRefetching && (
        <div className="refresh-indicator">
          <div className="spinner spinner-sm" />
          <span>Refreshing...</span>
        </div>
      )}

      <header className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">
          {onlineClientsCount > 0
            ? `${onlineClientsCount} client${onlineClientsCount > 1 ? 's' : ''} connected`
            : 'Overview of your connected clients'}
        </p>
      </header>

      <section className="dashboard-section">
        <h2 className="section-title">Connection Status</h2>
        <div className="card connection-card">
          <div className="connection-info">
            <span className={`status-badge ${relayStatusDisplay.className}`}>
              <span className="status-dot" />
              {relayStatusDisplay.text}
            </span>
          </div>
          {relayStatus === 'disconnected' && (
            <p className="connection-hint">
              Sign in again to reconnect to the relay server.
            </p>
          )}
        </div>
      </section>

      <section className="dashboard-section">
        <h2 className="section-title">VS Code Clients</h2>
        <ClientList
          clients={clients}
          isLoading={isLoading}
          isError={isError}
          error={error}
          onDisconnect={handleDisconnect}
          disconnectingClientId={disconnectingClientId}
          onRetry={handleRetry}
        />
      </section>
    </div>
  );
}
