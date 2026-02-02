import type { Client } from '../../services/relayApi';
import ClientCard from './ClientCard';
import './ClientList.css';

interface ClientListProps {
  clients: Client[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onDisconnect: (clientId: string) => void;
  disconnectingClientId: string | null;
  onRetry: () => void;
}

export default function ClientList({
  clients,
  isLoading,
  isError,
  error,
  onDisconnect,
  disconnectingClientId,
  onRetry,
}: ClientListProps) {
  // Loading state
  if (isLoading && clients.length === 0) {
    return (
      <div className="client-list-state">
        <div className="spinner" />
        <p className="state-text">Loading clients...</p>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="client-list-state error">
        <ErrorIcon />
        <p className="state-title">Failed to load clients</p>
        <p className="state-text">{error?.message || 'An unexpected error occurred'}</p>
        <button className="btn btn-primary" onClick={onRetry}>
          Try Again
        </button>
      </div>
    );
  }

  // Empty state
  if (clients.length === 0) {
    return (
      <div className="client-list-state empty">
        <NoClientsIcon />
        <p className="state-title">No clients connected</p>
        <p className="state-text">
          Open VS Code with the Instruction Engine extension to connect.
        </p>
        <div className="setup-hint">
          <h4>Quick Setup</h4>
          <ol>
            <li>Install the Instruction Engine extension in VS Code</li>
            <li>Sign in with GitHub</li>
            <li>Your VS Code instance will appear here automatically</li>
          </ol>
        </div>
      </div>
    );
  }

  // Sort: online clients first, then by lastSeen
  const sortedClients = [...clients].sort((a, b) => {
    if (a.isOnline && !b.isOnline) return -1;
    if (!a.isOnline && b.isOnline) return 1;
    return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
  });

  const onlineCount = clients.filter((c) => c.isOnline).length;
  const offlineCount = clients.length - onlineCount;

  return (
    <div className="client-list">
      <div className="client-list-summary">
        <span className="summary-item">
          <span className="status-indicator online" />
          {onlineCount} online
        </span>
        {offlineCount > 0 && (
          <span className="summary-item">
            <span className="status-indicator offline" />
            {offlineCount} offline
          </span>
        )}
      </div>
      <div className="client-list-items">
        {sortedClients.map((client) => (
          <ClientCard
            key={client.clientId}
            client={client}
            onDisconnect={onDisconnect}
            isDisconnecting={disconnectingClientId === client.clientId}
          />
        ))}
      </div>
    </div>
  );
}

function NoClientsIcon() {
  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="state-icon"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="state-icon error"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
