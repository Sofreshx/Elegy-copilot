import { useEffect, useRef, useState, useCallback } from 'react';
import type { Session, SessionMessage, ToolCall } from '../../services/relayApi';
import './SessionProgress.css';

interface SessionProgressProps {
  session: Session;
  isOpen: boolean;
  onClose: () => void;
  onCancel: (sessionId: string) => void;
  isCancelling: boolean;
}

/**
 * Format elapsed time
 */
function formatElapsedTime(startedAt: string, completedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const diffMs = end - start;
  
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Format timestamp
 */
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function SessionProgress({
  session,
  isOpen,
  onClose,
  onCancel,
  isCancelling,
}: SessionProgressProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [elapsedTime, setElapsedTime] = useState('0s');
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set());

  const isActive = session.status === 'running' || session.status === 'pending';

  // Update elapsed time
  useEffect(() => {
    if (!isActive) {
      setElapsedTime(formatElapsedTime(session.startedAt, session.completedAt));
      return;
    }

    const interval = setInterval(() => {
      setElapsedTime(formatElapsedTime(session.startedAt));
    }, 1000);

    return () => clearInterval(interval);
  }, [session.startedAt, session.completedAt, isActive]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [session.messages, session.toolCalls, autoScroll]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    setAutoScroll(isNearBottom);
  }, []);

  // Re-enable auto-scroll
  const handleScrollToBottom = useCallback(() => {
    setAutoScroll(true);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Toggle tool call expansion
  const toggleToolCall = useCallback((toolCallId: string) => {
    setExpandedToolCalls((prev) => {
      const next = new Set(prev);
      if (next.has(toolCallId)) {
        next.delete(toolCallId);
      } else {
        next.add(toolCallId);
      }
      return next;
    });
  }, []);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  const handleCancelClick = useCallback(() => {
    onCancel(session.sessionId);
  }, [session.sessionId, onCancel]);

  // Merge messages and tool calls into a timeline
  const timeline = buildTimeline(session.messages, session.toolCalls);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay session-progress-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-content session-progress-modal">
        <div className="progress-header">
          <div className="progress-header-info">
            <h2>@{session.agentName}</h2>
            <span className={`status-badge ${session.status}`}>
              {isActive && <span className="status-dot pulse" />}
              {session.status}
            </span>
          </div>
          <div className="progress-header-time">
            <ClockIcon />
            <span>{elapsedTime}</span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="progress-prompt">
          <strong>Prompt:</strong> {session.prompt}
        </div>

        <div
          className="progress-messages"
          ref={containerRef}
          onScroll={handleScroll}
        >
          {timeline.length === 0 ? (
            <div className="progress-empty">
              {isActive ? (
                <>
                  <div className="typing-indicator">
                    <span></span><span></span><span></span>
                  </div>
                  <p>Waiting for agent response...</p>
                </>
              ) : (
                <p>No messages in this session</p>
              )}
            </div>
          ) : (
            timeline.map((item) => (
              item.type === 'message' ? (
                <MessageItem key={item.id} message={item.data as SessionMessage} />
              ) : (
                <ToolCallItem
                  key={item.id}
                  toolCall={item.data as ToolCall}
                  isExpanded={expandedToolCalls.has(item.id)}
                  onToggle={() => toggleToolCall(item.id)}
                />
              )
            ))
          )}
          
          {isActive && timeline.length > 0 && (
            <div className="typing-indicator active">
              <span></span><span></span><span></span>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {!autoScroll && (
          <button className="scroll-to-bottom" onClick={handleScrollToBottom}>
            <ChevronDownIcon />
            Scroll to bottom
          </button>
        )}

        {session.error && (
          <div className="progress-error">
            <ErrorIcon />
            <span>{session.error}</span>
          </div>
        )}

        <div className="progress-actions">
          {isActive ? (
            <button
              className="btn btn-danger"
              onClick={handleCancelClick}
              disabled={isCancelling}
            >
              {isCancelling ? (
                <>
                  <span className="btn-spinner" />
                  Cancelling...
                </>
              ) : (
                <>
                  <StopIcon />
                  Cancel Session
                </>
              )}
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Timeline item type
interface TimelineItem {
  id: string;
  type: 'message' | 'toolCall';
  timestamp: string;
  data: SessionMessage | ToolCall;
}

// Build timeline from messages and tool calls
function buildTimeline(messages: SessionMessage[], toolCalls: ToolCall[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...messages.map((m) => ({
      id: m.id,
      type: 'message' as const,
      timestamp: m.timestamp,
      data: m,
    })),
    ...toolCalls.map((tc) => ({
      id: tc.id,
      type: 'toolCall' as const,
      timestamp: tc.startedAt,
      data: tc,
    })),
  ];
  
  return items.sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

// Message item component
function MessageItem({ message }: { message: SessionMessage }) {
  return (
    <div className={`message-item message-${message.type}`}>
      <div className="message-header">
        <span className="message-role">{message.type}</span>
        <span className="message-time">{formatTime(message.timestamp)}</span>
      </div>
      <div className="message-content">{message.content}</div>
    </div>
  );
}

// Tool call item component
function ToolCallItem({
  toolCall,
  isExpanded,
  onToggle,
}: {
  toolCall: ToolCall;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`tool-call-item status-${toolCall.status}`}>
      <button className="tool-call-header" onClick={onToggle}>
        <div className="tool-call-info">
          <ToolIcon />
          <span className="tool-name">{toolCall.name}</span>
          <span className={`tool-status ${toolCall.status}`}>
            {toolCall.status === 'running' && <span className="status-dot pulse" />}
            {toolCall.status}
          </span>
        </div>
        <ChevronIcon expanded={isExpanded} />
      </button>
      
      {isExpanded && (
        <div className="tool-call-details">
          <div className="tool-section">
            <span className="tool-section-title">Arguments</span>
            <pre className="tool-json">{JSON.stringify(toolCall.arguments, null, 2)}</pre>
          </div>
          {toolCall.result !== undefined && (
            <div className="tool-section">
              <span className="tool-section-title">Result</span>
              <pre className="tool-json">
                {typeof toolCall.result === 'string'
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Icons
function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function ToolIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={`chevron ${expanded ? 'expanded' : ''}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
