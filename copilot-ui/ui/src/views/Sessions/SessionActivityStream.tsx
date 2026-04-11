import { useEffect, useRef } from 'react';
import { Button, StatusBadge } from '../../components';
import { formatTimestampLabel } from '../../lib/stateDiagnostics';
import type { SessionDetailState } from './sessionDetailStore';

interface Props {
  state: SessionDetailState;
  onSend: (prompt: string) => void;
  onComposerChange: (value: string) => void;
}

function StreamStatusIndicator({ status }: { status: string }) {
  return (
    <span className="session-stream-status" data-testid="stream-status-indicator">
      <StatusBadge status={status} testId="stream-status-badge" />
    </span>
  );
}

function MessageItem({ message }: { message: SessionDetailState['sdkMessages'][number] }) {
  return (
    <div
      className={`session-message session-message-${message.role}`}
      data-testid="session-message-item"
    >
      <div className="session-message-header">
        <StatusBadge status={message.role} testId="message-role-badge" />
        <span className="session-message-time">
          {formatTimestampLabel(message.createdAtMs)}
        </span>
        {message.status === 'streaming' && (
          <span className="session-message-streaming">●</span>
        )}
      </div>
      {message.reasoning && (
        <div className="session-message-reasoning" data-testid="message-reasoning">
          {message.reasoning}
        </div>
      )}
      <div className="session-message-content" data-testid="message-content">
        {message.content}
      </div>
    </div>
  );
}

export default function SessionActivityStream({ state, onSend, onComposerChange }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.sdkMessages, state.sdkPendingContent]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (state.composerPrompt.trim()) {
        onSend(state.composerPrompt);
      }
    }
  }

  function handleSendClick() {
    if (state.composerPrompt.trim()) {
      onSend(state.composerPrompt);
    }
  }

  return (
    <div className="session-activity-stream" data-testid="session-activity-stream">
      <div className="session-activity-header">
        <StreamStatusIndicator status={state.sdkStreamStatus} />
        <span className="session-message-count">
          {state.sdkMessages.length} message{state.sdkMessages.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="session-messages-feed" ref={scrollRef} data-testid="session-messages-feed">
        {state.sdkMessages.length === 0 && !state.sdkPendingContent && (
          <div className="session-empty-state" data-testid="activity-empty-state">
            No messages yet. Send a prompt to start the conversation.
          </div>
        )}

        {state.sdkMessages.map((msg) => (
          <MessageItem key={msg.id} message={msg} />
        ))}

        {state.sdkPendingContent && (
          <div className="session-message session-message-pending" data-testid="pending-message">
            <div className="session-message-header">
              <StatusBadge status="assistant" testId="pending-role-badge" />
              <span className="session-message-streaming">●</span>
            </div>
            {state.sdkPendingReasoning && (
              <div className="session-message-reasoning">{state.sdkPendingReasoning}</div>
            )}
            <div className="session-message-content">{state.sdkPendingContent}</div>
          </div>
        )}
      </div>

      <div className="session-composer" data-testid="session-composer">
        <textarea
          className="session-composer-input"
          data-testid="composer-input"
          placeholder="Send a message…"
          rows={2}
          value={state.composerPrompt}
          onChange={(e) => onComposerChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button
          variant="primary"
          size="sm"
          testId="composer-send-button"
          disabled={!state.composerPrompt.trim()}
          onClick={handleSendClick}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
