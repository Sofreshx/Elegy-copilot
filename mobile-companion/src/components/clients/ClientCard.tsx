import { useState, useCallback } from 'react';
import type { Client } from '../../services/relayApi';
import './ClientCard.css';

interface ClientCardProps {
  client: Client;
  onDisconnect: (clientId: string) => void;
  isDisconnecting: boolean;
}

/**
 * Format relative time (e.g., "2 minutes ago", "just now")
 */
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 30) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds} seconds ago`;
  if (diffMinutes === 1) return '1 minute ago';
  if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
  if (diffHours === 1) return '1 hour ago';
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return 'yesterday';
  return `${diffDays} days ago`;
}

/**
 * Get display name for a client
 */
function getClientDisplayName(client: Client): string {
  if (client.workspaceName) {
    return client.workspaceName;
  }
  if (client.workspacePath) {
    // Extract folder name from path
    const parts = client.workspacePath.split(/[/\\]/);
    return parts[parts.length - 1] || 'Untitled';
  }
  return `VS Code (${client.githubLogin})`;
}

/**
 * Get platform icon/label
 */
function getPlatformLabel(platform?: string): string | null {
  if (!platform) return null;
  const lower = platform.toLowerCase();
  if (lower.includes('win')) return 'Windows';
  if (lower.includes('darwin') || lower.includes('mac')) return 'macOS';
  if (lower.includes('linux')) return 'Linux';
  return platform;
}

export default function ClientCard({ client, onDisconnect, isDisconnecting }: ClientCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showConfirmDisconnect, setShowConfirmDisconnect] = useState(false);

  const handleToggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const handleDisconnectClick = useCallback(() => {
    setShowConfirmDisconnect(true);
  }, []);

  const handleConfirmDisconnect = useCallback(() => {
    onDisconnect(client.clientId);
    setShowConfirmDisconnect(false);
  }, [client.clientId, onDisconnect]);

  const handleCancelDisconnect = useCallback(() => {
    setShowConfirmDisconnect(false);
  }, []);

  const displayName = getClientDisplayName(client);
  const platformLabel = getPlatformLabel(client.platform);
  const lastSeenText = formatRelativeTime(client.lastSeen);
  const connectedAtText = formatRelativeTime(client.connectedAt);

  return (
    <div 
      className={`client-card ${client.isOnline ? 'online' : 'offline'} ${isExpanded ? 'expanded' : ''}`}
      onClick={handleToggleExpand}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleToggleExpand();
        }
      }}
    >
      <div className="client-card-header">
        <div className="client-info">
          <div className="client-status-row">
            <span className={`status-indicator ${client.isOnline ? 'online' : 'offline'}`} />
            <span className="client-name">{displayName}</span>
          </div>
          <div className="client-meta">
            {client.isOnline ? (
              <span className="client-status-text">Online</span>
            ) : (
              <span className="client-status-text">Last seen {lastSeenText}</span>
            )}
            {client.clientType === 'extension' && (
              <span className="client-type-badge">VS Code</span>
            )}
          </div>
        </div>
        <div className="expand-icon" aria-hidden="true">
          <ChevronIcon expanded={isExpanded} />
        </div>
      </div>

      {isExpanded && (
        <div className="client-card-details">
          <div className="detail-section">
            <div className="detail-row">
              <span className="detail-label">Workspace</span>
              <span className="detail-value">{client.workspacePath || 'Not available'}</span>
            </div>
            {client.vscodeVersion && (
              <div className="detail-row">
                <span className="detail-label">VS Code Version</span>
                <span className="detail-value">{client.vscodeVersion}</span>
              </div>
            )}
            {client.extensionVersion && (
              <div className="detail-row">
                <span className="detail-label">Extension Version</span>
                <span className="detail-value">{client.extensionVersion}</span>
              </div>
            )}
            {platformLabel && (
              <div className="detail-row">
                <span className="detail-label">Platform</span>
                <span className="detail-value">{platformLabel}</span>
              </div>
            )}
            <div className="detail-row">
              <span className="detail-label">Connected</span>
              <span className="detail-value">{connectedAtText}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Client ID</span>
              <span className="detail-value client-id">{client.clientId}</span>
            </div>
          </div>

          {client.isOnline && (
            <div className="client-actions">
              {showConfirmDisconnect ? (
                <div className="disconnect-confirm">
                  <span className="confirm-text">Disconnect this client?</span>
                  <div className="confirm-buttons">
                    <button
                      className="btn btn-cancel"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCancelDisconnect();
                      }}
                      disabled={isDisconnecting}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleConfirmDisconnect();
                      }}
                      disabled={isDisconnecting}
                    >
                      {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="btn btn-outline-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDisconnectClick();
                  }}
                  disabled={isDisconnecting}
                >
                  Disconnect
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      className={`chevron-icon ${expanded ? 'expanded' : ''}`}
    >
      <path
        d="M6 8l4 4 4-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
