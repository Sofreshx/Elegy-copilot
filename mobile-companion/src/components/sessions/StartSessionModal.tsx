import { useState, useCallback, useEffect, useRef } from 'react';
import type { Client, Agent } from '../../services/relayApi';
import './StartSessionModal.css';

interface StartSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (clientId: string, agentName: string, prompt: string) => void;
  isStarting: boolean;
  clients: Client[];
  agents: Agent[];
  clientsLoading: boolean;
  agentsLoading: boolean;
}

/**
 * Get display name for a client
 */
function getClientDisplayName(client: Client): string {
  if (client.workspaceName) {
    return client.workspaceName;
  }
  if (client.workspacePath) {
    const parts = client.workspacePath.split(/[/\\]/);
    return parts[parts.length - 1] || 'Untitled';
  }
  return `VS Code (${client.githubLogin})`;
}

/**
 * Get agent icon
 */
function getAgentIcon(agentName: string): string {
  const iconMap: Record<string, string> = {
    debugger: '🔧',
    executive2: '📋',
    'code-reviewer': '🔍',
    'feature-creator': '✨',
    'code-explorer': '🗺️',
    'test-runner': '🧪',
    'task-runner': '▶️',
    'unit-test-gen': '🧬',
    default: '🤖',
  };
  return iconMap[agentName] ?? iconMap['default'] ?? '🤖';
}

export default function StartSessionModal({
  isOpen,
  onClose,
  onStart,
  isStarting,
  clients,
  agents,
  clientsLoading,
  agentsLoading,
}: StartSessionModalProps) {
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [prompt, setPrompt] = useState<string>('');
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // Filter online clients only
  const onlineClients = clients.filter((c) => c.isOnline);

  // Auto-select first client/agent if not selected
  useEffect(() => {
    if (!selectedClientId && onlineClients.length > 0 && onlineClients[0]) {
      setSelectedClientId(onlineClients[0].clientId);
    }
  }, [onlineClients, selectedClientId]);

  useEffect(() => {
    if (!selectedAgent && agents.length > 0 && agents[0]) {
      setSelectedAgent(agents[0].name);
    }
  }, [agents, selectedAgent]);

  // Focus prompt when modal opens
  useEffect(() => {
    if (isOpen && promptRef.current) {
      setTimeout(() => promptRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setPrompt('');
    }
  }, [isOpen]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedClientId || !selectedAgent || !prompt.trim()) {
        return;
      }
      onStart(selectedClientId, selectedAgent, prompt.trim());
    },
    [selectedClientId, selectedAgent, prompt, onStart]
  );

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !isStarting) {
        onClose();
      }
    },
    [onClose, isStarting]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !isStarting) {
        onClose();
      }
    },
    [onClose, isStarting]
  );

  const isValid = selectedClientId && selectedAgent && prompt.trim().length > 0;

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-session-title"
    >
      <div className="modal-content start-session-modal">
        <div className="modal-header">
          <h2 id="start-session-title">Start Session</h2>
          <button
            className="modal-close"
            onClick={onClose}
            disabled={isStarting}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="client-select">VS Code Client</label>
            {clientsLoading ? (
              <div className="select-loading">Loading clients...</div>
            ) : onlineClients.length === 0 ? (
              <div className="select-empty">
                <span className="empty-icon">⚠️</span>
                No clients connected. Open VS Code with the extension installed.
              </div>
            ) : (
              <select
                id="client-select"
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                disabled={isStarting}
              >
                {onlineClients.map((client) => (
                  <option key={client.clientId} value={client.clientId}>
                    {getClientDisplayName(client)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="agent-select">Agent</label>
            {agentsLoading ? (
              <div className="select-loading">Loading agents...</div>
            ) : agents.length === 0 ? (
              <div className="select-empty">No agents available</div>
            ) : (
              <div className="agent-select-grid">
                {agents.map((agent) => (
                  <button
                    key={agent.name}
                    type="button"
                    className={`agent-option ${selectedAgent === agent.name ? 'selected' : ''}`}
                    onClick={() => setSelectedAgent(agent.name)}
                    disabled={isStarting}
                  >
                    <span className="agent-option-icon">{getAgentIcon(agent.name)}</span>
                    <span className="agent-option-name">@{agent.displayName || agent.name}</span>
                    {agent.description && (
                      <span className="agent-option-desc">{agent.description}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="prompt-input">Prompt</label>
            <textarea
              ref={promptRef}
              id="prompt-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What would you like the agent to do?"
              rows={4}
              disabled={isStarting}
            />
            <div className="prompt-hint">
              Be specific about your request. Include relevant file paths or context.
            </div>
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isStarting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!isValid || isStarting}
            >
              {isStarting ? (
                <>
                  <span className="btn-spinner" />
                  Starting...
                </>
              ) : (
                <>
                  <PlayIcon />
                  Start Session
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}
